/**
 * Bridge Service — OCT (Octra) ↔ wOCT (Ethereum)
 *
 * OCT → wOCT flow:
 *   1. lockOctOnOctra()       — send_transaction via SDK sendContractCall
 *   2. waitForLockedEvent()   — poll Octra RPC for contract_receipt
 *   3. waitForEpochOnEth()    — wait for ETH lightClient to index epoch
 *   4. claimWoctOnEthereum()  — send_evm_transaction via SDK sendEvmTransaction
 *
 * wOCT → OCT flow:
 *   1. burnWoctToOctra()      — send_evm_transaction via SDK sendEvmTransaction
 *   2. Bridge relayer auto-unlocks OCT on Octra (~2 min)
 *
 * All signing happens inside the OctWa extension — private keys never leave.
 */

import { ethers } from 'ethers'
import {
  OCTRA_BRIDGE_CONTRACT,
  OCTRA_LOCK_METHOD,
  WOCT_CONTRACT_ADDRESS,
  WOCT_TOKEN_ADDRESS,
  WOCT_ABI,
  WOCT_TOKEN_ABI,
  OCT_DECIMALS,
  OCTRA_CHAIN_ID,
  ETH_CHAIN_ID,
  BRIDGE_MSG_VERSION,
  BRIDGE_MSG_DIRECTION,
  BRIDGE_SRC_BRIDGE_ID,
  BRIDGE_DST_BRIDGE_ID,
  BRIDGE_TOKEN_ID,
} from './constants'
import { OctraSDK } from '@octwa/sdk'
import {
  getBalance,
  waitForConfirmation,
  getContractReceipt,
} from './octra-rpc'
import type { LockedEventData, OctraTxResult } from './types'
import { toRawUnits } from './utils'

const INFURA_KEY = import.meta.env.VITE_INFURA_API_KEY || '121cf128273c4f0cb73770b391070d3b'

// ─── Shared helper ────────────────────────────────────────────────────────────

/**
 * Extract txHash from an invoke result.data which can be:
 *   - Uint8Array (JSON-encoded)
 *   - string (JSON or raw hash)
 *   - object with numeric keys {0:123,...} (serialized Uint8Array)
 *   - plain object { txHash, hash }
 */
function extractTxHash(raw: unknown): string | null {
  let jsonStr: string | null = null

  if (raw instanceof Uint8Array) {
    jsonStr = new TextDecoder().decode(raw)
  } else if (typeof raw === 'string') {
    jsonStr = raw
  } else if (raw && typeof raw === 'object') {
    const keys = Object.keys(raw as Record<string, unknown>)
    if (keys.length > 0 && keys.every(k => /^\d+$/.test(k))) {
      const obj = raw as Record<string, number>
      const bytes = new Uint8Array(keys.length)
      keys.sort((a, b) => Number(a) - Number(b)).forEach((k, i) => { bytes[i] = obj[k] })
      jsonStr = new TextDecoder().decode(bytes)
    } else {
      const d = raw as Record<string, unknown>
      return (d?.txHash as string) || (d?.hash as string) || null
    }
  }

  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr)
      return parsed.txHash || parsed.hash || null
    } catch {
      return jsonStr.trim() || null
    }
  }

  return null
}

// ─── SDK instance (lazy) ──────────────────────────────────────────────────────

let _sdk: OctraSDK | null = null

async function getSDK(): Promise<OctraSDK> {
  if (_sdk) return _sdk
  _sdk = await OctraSDK.init({ timeout: 3000 })
  return _sdk
}

// ─── OCT → wOCT ──────────────────────────────────────────────────────────────

/**
 * Step 1: Lock OCT on Octra via SDK sendContractCall.
 * Opens popup for user approval.
 */
export async function lockOctOnOctra(params: {
  octraAddress: string
  ethRecipient: string
  amountOct: string
  capabilityId: string
  nonce: number
}): Promise<OctraTxResult> {
  const { ethRecipient, amountOct, capabilityId } = params

  if (!ethers.isAddress(ethRecipient)) throw new Error('Invalid Ethereum address')

  const rawAmount = toRawUnits(amountOct, OCT_DECIMALS)
  if (rawAmount <= 0n) throw new Error('Amount must be greater than 0')

  const sdk = await getSDK()

  const result = await sdk.sendContractCall(capabilityId, {
    contract: OCTRA_BRIDGE_CONTRACT,
    method:   OCTRA_LOCK_METHOD,
    params:   [ethRecipient],
    amount:   parseFloat(amountOct),
  })

  return { hash: result.txHash }
}

/**
 * Step 2: Wait for confirmation + extract Locked event from contract_receipt.
 */
export async function waitForLockedEvent(
  octraTxHash: string,
  onProgress?: (msg: string) => void
): Promise<LockedEventData> {
  onProgress?.('Waiting for Octra transaction confirmation...')

  const { epoch } = await waitForConfirmation(octraTxHash, 180_000, 3000)
  onProgress?.(`Confirmed in epoch ${epoch}. Reading Locked event...`)

  const receipt = await getContractReceipt(octraTxHash)
  if (!receipt) throw new Error('Could not fetch contract receipt from Octra RPC')
  if (!receipt.success) throw new Error(`lock_to_eth failed on-chain: ${receipt.error}`)

  const lockedEvent = receipt.events.find(e => e.event === 'Locked')
  if (!lockedEvent || lockedEvent.values.length < 4) {
    throw new Error('Locked event not found in contract receipt')
  }

  const [from, amountRawStr, ethAddress, nonceStr] = lockedEvent.values

  return {
    from,
    amountRaw: BigInt(amountRawStr),
    ethAddress,
    srcNonce: parseInt(nonceStr, 10),
    epoch: receipt.epoch,
    txHash: octraTxHash,
  }
}

/**
 * Step 3: Call verifyAndMint on Ethereum via SDK sendEvmTransaction.
 * Encodes calldata locally, sends via extension (wallet's secp256k1 key).
 */
export async function claimWoctOnEthereum(
  lockedData: LockedEventData,
  capabilityId: string,
  _nonce: number
): Promise<string> {
  const iface = new ethers.Interface(WOCT_ABI as ethers.InterfaceAbi)

  const calldata = iface.encodeFunctionData('verifyAndMint', [
    BigInt(lockedData.epoch),
    {
      version:     BRIDGE_MSG_VERSION,
      direction:   BRIDGE_MSG_DIRECTION,
      srcChainId:  BigInt(OCTRA_CHAIN_ID),
      dstChainId:  BigInt(ETH_CHAIN_ID),
      srcBridgeId: BRIDGE_SRC_BRIDGE_ID,
      dstBridgeId: BRIDGE_DST_BRIDGE_ID,
      tokenId:     BRIDGE_TOKEN_ID,
      recipient:   lockedData.ethAddress,
      amount:      lockedData.amountRaw,
      srcNonce:    BigInt(lockedData.srcNonce),
    },
    [],
    0,
  ])

  const sdk = await getSDK()
  const result = await sdk.sendEvmTransaction(capabilityId, {
    to:   WOCT_CONTRACT_ADDRESS,
    data: calldata,
  })

  return result.txHash
}

/**
 * Step 2b: Wait until the ETH lightClient has indexed our lock epoch.
 */
export async function waitForEpochOnEth(
  lockEpoch: number,
  onProgress?: (msg: string) => void
): Promise<void> {
  const LC_ADDR       = '0xc01ca57dc7f7c4b6f1b6b87b85d79e5ddf0df55d'
  const LATEST_EPOCH_SEL = '0x9cb118bf'
  const maxWaitMs = 60 * 60 * 1000
  const pollMs    = 30_000
  const start     = Date.now()

  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(`https://mainnet.infura.io/v3/${INFURA_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'eth_call',
          params: [{ to: LC_ADDR, data: LATEST_EPOCH_SEL }, 'latest'],
        }),
      })
      const json = await res.json()
      if (json.result && json.result !== '0x') {
        const latestEpoch = parseInt(json.result, 16)
        if (latestEpoch >= lockEpoch) {
          onProgress?.(`Epoch ${lockEpoch} confirmed on Ethereum. Ready to claim.`)
          return
        }
        const remaining = lockEpoch - latestEpoch
        const estMin = Math.ceil(remaining * 10 / 60)
        onProgress?.(
          `Waiting for epoch ${lockEpoch} on Ethereum... ` +
          `(current: ${latestEpoch}, ~${estMin} min remaining)`
        )
      }
    } catch { /* keep polling */ }

    await new Promise(r => setTimeout(r, pollMs))
  }

  throw new Error(
    `Timeout: epoch ${lockEpoch} not yet available on Ethereum after 1 hour. ` +
    'You can retry the claim from Bridge History later.'
  )
}

/**
 * Refetch LockedEventData from Octra RPC using a known tx hash.
 */
export async function refetchLockedEvent(octraTxHash: string): Promise<LockedEventData> {
  const receipt = await getContractReceipt(octraTxHash)
  if (!receipt) throw new Error('Could not fetch contract receipt')
  if (!receipt.success) throw new Error(`lock_to_eth failed: ${receipt.error}`)

  const lockedEvent = receipt.events.find(e => e.event === 'Locked')
  if (!lockedEvent || lockedEvent.values.length < 4) {
    throw new Error('Locked event not found in receipt')
  }

  const [from, amountRawStr, ethAddress, nonceStr] = lockedEvent.values
  return {
    from,
    amountRaw: BigInt(amountRawStr),
    ethAddress,
    srcNonce:  parseInt(nonceStr, 10),
    epoch:     receipt.epoch,
    txHash:    octraTxHash,
  }
}

// ─── wOCT → OCT ──────────────────────────────────────────────────────────────

/**
 * Burn wOCT on Ethereum to receive OCT on Octra.
 * Uses SDK sendEvmTransaction — no approve needed (burnToOctra is single call).
 */
export async function burnWoctToOctra(params: {
  octraRecipient: string
  amountWoct: string
  capabilityId: string
  nonce: number
}): Promise<string> {
  const { octraRecipient, amountWoct, capabilityId } = params

  const rawAmount = toRawUnits(amountWoct, OCT_DECIMALS)
  if (rawAmount <= 0n) throw new Error('Amount must be greater than 0')

  const iface = new ethers.Interface(WOCT_ABI as ethers.InterfaceAbi)
  const calldata = iface.encodeFunctionData('burnToOctra', [octraRecipient, rawAmount])

  const sdk = await getSDK()
  const result = await sdk.sendEvmTransaction(capabilityId, {
    to:   WOCT_CONTRACT_ADDRESS,
    data: calldata,
  })

  return result.txHash
}

/**
 * Get wOCT burn caps from the contract.
 */
export async function getWoctBurnCaps(provider: ethers.Provider): Promise<{
  perTx: string
  daily: string
}> {
  const contract = new ethers.Contract(WOCT_CONTRACT_ADDRESS, WOCT_ABI, provider)
  const [perTx, daily] = await Promise.all([
    contract.burnCapPerTx() as Promise<bigint>,
    contract.burnCapDaily() as Promise<bigint>,
  ])
  return {
    perTx: (Number(perTx)  / Math.pow(10, OCT_DECIMALS)).toFixed(0),
    daily: (Number(daily) / Math.pow(10, OCT_DECIMALS)).toFixed(0),
  }
}

// ─── Balance helpers ──────────────────────────────────────────────────────────

export async function getWoctBalance(ethAddress: string, provider: ethers.Provider): Promise<string> {
  const contract = new ethers.Contract(WOCT_TOKEN_ADDRESS, WOCT_TOKEN_ABI, provider)
  const raw: bigint = await contract.balanceOf(ethAddress)
  return (Number(raw) / Math.pow(10, OCT_DECIMALS)).toFixed(6)
}

export async function getOctBalance(octraAddress: string): Promise<string> {
  const bal = await getBalance(octraAddress)
  return bal.formatted
}
