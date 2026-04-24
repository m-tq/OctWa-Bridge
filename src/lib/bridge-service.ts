/**
 * Bridge Service — OCT (Octra) ↔ wOCT (Ethereum)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * COMPLETE DATA MAP FOR verifyAndMint — 100% from Octra RPC, no external API:
 *
 * FIXED (hardcoded, same for every tx):
 *   version     = 1
 *   direction   = 0
 *   srcChainId  = 7777
 *   dstChainId  = 1
 *   srcBridgeId = 0x381ab73c...
 *   dstBridgeId = 0xab33480e...
 *   tokenId     = 0x412ec112...
 *   siblings    = []          ← EMPTY, verified from sample ETH tx
 *   leafIndex   = 0           ← ZERO, verified from sample ETH tx
 *
 * DYNAMIC (from contract_receipt → Locked event after lock_to_eth confirms):
 *   epochId   ← receipt.epoch
 *   recipient ← Locked.values[2]
 *   amount    ← Locked.values[1]
 *   srcNonce  ← Locked.values[3]
 *
 * FLOW: lock_to_eth → wait confirmed → contract_receipt → verifyAndMint
 * No bridge API, no relayer, no polling external endpoints.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { ethers } from 'ethers'
import {
  OCTRA_BRIDGE_CONTRACT,
  OCTRA_LOCK_METHOD,
  WOCT_CONTRACT_ADDRESS,
  WOCT_TOKEN_ADDRESS,
  WOCT_ABI,
  OCT_DECIMALS,
  OCTRA_CHAIN_ID,
  ETH_CHAIN_ID,
  BRIDGE_MSG_VERSION,
  BRIDGE_MSG_DIRECTION,
  BRIDGE_SRC_BRIDGE_ID,
  BRIDGE_DST_BRIDGE_ID,
  BRIDGE_TOKEN_ID,
} from './constants'
import {
  getBalance,
  getNonce,
  getRecommendedFee,
  waitForConfirmation,
  getContractReceipt,
  getPublicKey,
  submitTx,
} from './octra-rpc'
import type { LockedEventData, OctraTxResult } from './types'
import { toRawUnits } from './utils'

// ─── OCT → wOCT ──────────────────────────────────────────────────────────────

/**
 * Step 1: Lock OCT on Octra
 *
 * Contract call tx format (verified from sample tx 5c6712...):
 *   from:           sender address
 *   to_:            bridge contract address
 *   amount:         raw units string (e.g. "1992000000")
 *   nonce:          int
 *   ou:             fee string
 *   timestamp:      float (seconds)
 *   op_type:        "call"
 *   encrypted_data: "lock_to_eth"          ← method name goes here
 *   message:        "[\"0xETH_ADDRESS\"]"  ← params as JSON array string
 *   signature:      base64 ed25519
 *   public_key:     base64
 *
 * Canonical JSON for signing (from tx_builder.hpp):
 *   { from, to_, amount, nonce, ou, timestamp, op_type, encrypted_data, message }
 *   NOTE: encrypted_data IS included in canonical signing when non-empty
 */
export async function lockOctOnOctra(params: {
  octraAddress: string
  ethRecipient: string
  amountOct: string
}): Promise<OctraTxResult> {
  const { octraAddress, ethRecipient, amountOct } = params

  if (!window.octra) throw new Error('Octra wallet extension not found')
  if (!ethers.isAddress(ethRecipient)) throw new Error('Invalid Ethereum address')

  const rawAmount = toRawUnits(amountOct, OCT_DECIMALS)
  if (rawAmount <= 0n) throw new Error('Amount must be greater than 0')

  const [nonce, fee] = await Promise.all([
    getNonce(octraAddress),
    getRecommendedFee(),
  ])

  const txNonce = nonce + 1
  const timestamp = Date.now() / 1000

  // Canonical fields for signing — exact order from tx_builder.hpp canonical_json()
  const canonicalTx: Record<string, unknown> = {
    from:           octraAddress,
    to_:            OCTRA_BRIDGE_CONTRACT,
    amount:         rawAmount.toString(),
    nonce:          txNonce,
    ou:             fee.toString(),
    timestamp,
    op_type:        'call',
    encrypted_data: OCTRA_LOCK_METHOD,          // method name
    message:        JSON.stringify([ethRecipient]), // params as JSON array string
  }

  // Sign canonical JSON via wallet extension (opens popup for user approval)
  const signingData = JSON.stringify(canonicalTx)
  console.log('[Bridge] nonce:', nonce, '→ txNonce:', txNonce)
  console.log('[Bridge] fee:', fee)
  console.log('[Bridge] rawAmount:', rawAmount.toString())
  console.log('[Bridge] signingData:', signingData)

  const signature = await window.octra.signMessage(signingData)
  if (!signature) throw new Error('Wallet rejected signing')
  console.log('[Bridge] signature:', signature)

  // Get public key
  const pubKey = await getPublicKey(octraAddress)
  console.log('[Bridge] pubKey:', pubKey)
  if (!pubKey) throw new Error('Could not fetch public key for address')

  // Full tx object to submit (includes signature + public_key)
  const signedTx = {
    ...canonicalTx,
    signature,
    public_key: pubKey,
  }

  const hash = await submitTx(signedTx)
  return { hash }
}

/**
 * Step 2: Wait for confirmation + extract Locked event from contract_receipt
 *
 * contract_receipt(tx_hash) returns:
 *   events[0].event  = "Locked"
 *   events[0].values = [from, amount_raw, eth_address, bridge_nonce]
 *   epoch            = epochId for verifyAndMint
 *
 * Verified from sample tx 5c6712...:
 *   values[0] = "octGimzkC5ZDgbX3zMZ4M3iLkuA23C3bYi1sZY1fx4EVMiM"
 *   values[1] = "1992000000"
 *   values[2] = "0x25Bccdd8950cA238909513f63834dF3d7aA8bFCC"
 *   values[3] = "400"
 *   epoch     = 676316
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

  // event Locked(from, amount_raw, eth_address, bridge_nonce)
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
 * Step 3: Call verifyAndMint on Ethereum
 *
 * All data is now available — no external API needed.
 *
 * siblings = []  (empty — verified from all sample ETH txs)
 * leafIndex = 0  (zero  — verified from all sample ETH txs)
 *
 * Contract: 0xE7eD69b852fd2a1406080B26A37e8E04e7dA4caE
 * Function: verifyAndMint(uint64 epochId, tuple m, bytes32[] siblings, uint32 leafIndex)
 */
/**
 * Step 3: Call verifyAndMint on Ethereum via extension send_evm_transaction.
 *
 * Encodes calldata locally, sends via extension invoke (which uses the wallet's
 * secp256k1 private key to sign and broadcast the ETH tx).
 */
export async function claimWoctOnEthereum(
  lockedData: LockedEventData,
  capabilityId: string,
  nonce: number
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

  console.log('[Bridge] verifyAndMint calldata:', calldata.slice(0, 60) + '...')

  return sendEvmContractCall({
    capabilityId,
    to:       WOCT_CONTRACT_ADDRESS,
    calldata,
    nonce,
  })
}

/**
 * Step 2b: Wait until the ETH lightClient has indexed our lock epoch.
 *
 * The lightClient on Ethereum lags ~231 epochs (~39 min) behind Octra.
 * verifyAndMint will revert with UnknownHeader if called before the epoch
 * header is available on the ETH side.
 *
 * Polls lightClient.latestEpoch() until latestEpoch >= lockEpoch.
 */
export async function waitForEpochOnEth(
  lockEpoch: number,
  onProgress?: (msg: string) => void
): Promise<void> {
  const INFURA_KEY = import.meta.env.VITE_INFURA_API_KEY || '121cf128273c4f0cb73770b391070d3b'
  const LC_ADDR = '0xc01ca57dc7f7c4b6f1b6b87b85d79e5ddf0df55d'
  // latestEpoch() selector
  const LATEST_EPOCH_SEL = '0x9cb118bf'

  const maxWaitMs = 60 * 60 * 1000  // 1 hour max
  const pollMs    = 30_000           // poll every 30s
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
        const remaining = lockEpoch - latestEpoch

        if (latestEpoch >= lockEpoch) {
          onProgress?.(`Epoch ${lockEpoch} confirmed on Ethereum. Ready to claim.`)
          return
        }

        // Estimate wait: ~10s per epoch
        const estSec = Math.round(remaining * 10)
        const estMin = Math.ceil(estSec / 60)
        onProgress?.(
          `Waiting for epoch ${lockEpoch} on Ethereum... ` +
          `(current: ${latestEpoch}, need: ${lockEpoch}, ~${estMin} min remaining)`
        )
      }
    } catch {
      // network error — keep polling
    }

    await new Promise(r => setTimeout(r, pollMs))
  }

  throw new Error(
    `Timeout: epoch ${lockEpoch} not yet available on Ethereum after 1 hour. ` +
    'You can retry the claim from Bridge History later.'
  )
}

/**
 * Refetch LockedEventData from Octra RPC using a known tx hash.
 * Used by HistoryPanel to re-derive claim data without storing BigInt.
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

// ─── EVM contract call via extension invoke ───────────────────────────────────

/**
 * Call an EVM contract via the extension's send_evm_transaction invoke method.
 *
 * The extension's DAppRequestHandler handles send_evm_transaction by:
 *   1. Getting evmPrivateKey from WalletManager
 *   2. Calling sendEVMTransaction(privateKey, to, amount, network, data)
 *   3. Returning txHash
 *
 * Payload format: { to, amount, data, network }
 *   - to:      contract address
 *   - amount:  "0" (no ETH value)
 *   - data:    hex-encoded calldata
 *   - network: "eth-mainnet"
 */
export async function sendEvmContractCall(params: {
  capabilityId: string
  to: string
  calldata: string   // hex-encoded
  nonce: number
}): Promise<string> {
  if (!window.octra) throw new Error('Octra extension not found')

  // Payload must be in call.payload (not payloadHash) — provider sends it as data.payload
  // DAppRequestHandler parses it as: { to, amount, value, data, network }
  const payloadBytes = new TextEncoder().encode(JSON.stringify({
    to:      params.to,
    amount:  '0',
    value:   '0',
    data:    params.calldata,
    network: 'eth-mainnet',
  }))

  const result = await window.octra.invoke({
    header: {
      version:    2,
      circleId:   'oct-bridge',
      branchId:   'main',
      epoch:      0,
      nonce:      params.nonce,
      timestamp:  Date.now(),
      originHash: '',
    },
    // payload goes here — provider picks it up from call.payload
    payload: payloadBytes,
    body: {
      capabilityId: params.capabilityId,
      method:       'send_evm_transaction',
      payloadHash:  '',
    },
  } as never)

  if (!result.success) throw new Error(result.error || 'EVM tx rejected by wallet')

  // Extract txHash — result.data can be:
  //   Uint8Array, string, or object with numeric keys {0:123, 1:34, ...} (serialized Uint8Array)
  let txHash: string
  const raw = result.data

  let jsonStr: string | null = null

  if (raw instanceof Uint8Array) {
    jsonStr = new TextDecoder().decode(raw)
  } else if (typeof raw === 'string') {
    jsonStr = raw
  } else if (raw && typeof raw === 'object') {
    // Numeric-keyed object {0: 123, 1: 34, ...} — convert to Uint8Array
    const keys = Object.keys(raw as Record<string, unknown>)
    if (keys.length > 0 && keys.every(k => /^\d+$/.test(k))) {
      const obj = raw as Record<string, number>
      const bytes = new Uint8Array(keys.length)
      keys.sort((a, b) => Number(a) - Number(b)).forEach((k, i) => { bytes[i] = obj[k] })
      jsonStr = new TextDecoder().decode(bytes)
    } else {
      // Already parsed object
      const d = raw as Record<string, unknown>
      txHash = (d?.txHash as string) || (d?.hash as string) || ''
    }
  }

  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr)
      txHash = parsed.txHash || parsed.hash || ''
    } catch {
      txHash = jsonStr.trim()
    }
  }

  if (!txHash!) throw new Error('No txHash returned from EVM transaction')
  return txHash!
}

export async function approveWoct(amount: string, signer: ethers.Signer): Promise<string> {
  const rawAmount = toRawUnits(amount, OCT_DECIMALS)
  const contract = new ethers.Contract(WOCT_TOKEN_ADDRESS, WOCT_ABI, signer)
  const tx = await contract.approve(WOCT_CONTRACT_ADDRESS, rawAmount)
  const receipt = await tx.wait()
  return receipt.hash as string
}

export async function burnWoct(amount: string, signer: ethers.Signer): Promise<string> {
  const rawAmount = toRawUnits(amount, OCT_DECIMALS)
  const contract = new ethers.Contract(WOCT_TOKEN_ADDRESS, WOCT_ABI, signer)
  const tx = await contract.burn(rawAmount)
  const receipt = await tx.wait()
  return receipt.hash as string
}

// ─── Balance helpers ──────────────────────────────────────────────────────────

export async function getWoctBalance(ethAddress: string, provider: ethers.Provider): Promise<string> {
  const contract = new ethers.Contract(WOCT_TOKEN_ADDRESS, WOCT_ABI, provider)
  const raw: bigint = await contract.balanceOf(ethAddress)
  return (Number(raw) / Math.pow(10, OCT_DECIMALS)).toFixed(6)
}

export async function getOctBalance(octraAddress: string): Promise<string> {
  const bal = await getBalance(octraAddress)
  return bal.formatted
}
