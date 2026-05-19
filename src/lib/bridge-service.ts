/**
 * Bridge Service — OCT (Octra) ↔ wOCT (Ethereum)
 *
 * All write paths receive the connected `OctraSDK` instance from the caller.
 * The hook in `useWallets.ts` owns the only SDK reference; this module is a
 * pure set of building blocks invoked by `BridgePanel` and `HistoryPanel`.
 *
 * The bridge is RFC-O-1 compliant — it uses the typed wallet methods
 * (`sendContractTransaction`, `evm.sendTransaction`) rather than the legacy
 * capability/invoke API.
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
import type { OctraSDK } from '@octwa/sdk'
import {
  waitForConfirmation,
  getContractReceipt,
} from './octra-rpc'
import type { LockedEventData, OctraTxResult } from './types'
import { toRawUnits } from './utils'

const INFURA_KEY = import.meta.env.VITE_INFURA_API_KEY || ''
const PUBLIC_ETH_RPC = 'https://ethereum.publicnode.com'
const ETH_RPC_URL = INFURA_KEY
  ? `https://mainnet.infura.io/v3/${INFURA_KEY}`
  : PUBLIC_ETH_RPC

// ─── OCT → wOCT ──────────────────────────────────────────────────────────────

/**
 * Step 1: Lock OCT on Octra via the RFC-O-1 contract method.
 *
 * The wallet popup converts these params into the on-chain transaction:
 *   op_type:        'call'
 *   encrypted_data: 'lock_to_eth'        (method name)
 *   message:        '["0xEthAddr"]'      (positional params, JSON array)
 *   amount:         raw OU as string     (1 OCT = 1_000_000)
 */
export async function lockOctOnOctra(
  sdk: OctraSDK,
  params: {
    ethRecipient: string
    amountOct: string
  },
): Promise<OctraTxResult> {
  const { ethRecipient, amountOct } = params

  if (!ethers.isAddress(ethRecipient)) throw new Error('Invalid Ethereum address')

  const rawAmount = toRawUnits(amountOct, OCT_DECIMALS)
  if (rawAmount <= 0n) throw new Error('Amount must be greater than 0')

  const result = await sdk.sendContractTransaction({
    address: OCTRA_BRIDGE_CONTRACT,
    method:  OCTRA_LOCK_METHOD,
    params:  [ethRecipient],
    amount:  rawAmount.toString(),
  })

  return {
    hash:  result.hash,
    nonce: result.nonce,
  }
}

/**
 * Step 2: Wait for confirmation on Octra and extract the Locked event from
 * the contract receipt. Uses the Octra RPC directly — no wallet needed.
 */
export async function waitForLockedEvent(
  octraTxHash: string,
  onProgress?: (msg: string) => void,
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
    srcNonce:  parseInt(nonceStr, 10),
    epoch:     receipt.epoch,
    txHash:    octraTxHash,
  }
}

/**
 * Step 3: Call `verifyAndMint` on Ethereum via the EVM bridge.
 *
 * The wallet's secp256k1 key (derived from the same BIP39 seed) signs the tx
 * inside the popup. We just hand it the encoded calldata and target address.
 */
export async function claimWoctOnEthereum(
  sdk: OctraSDK,
  lockedData: LockedEventData,
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

  const result = await sdk.evm.sendTransaction({
    to:    WOCT_CONTRACT_ADDRESS,
    data:  calldata,
    value: '0',
  })

  return result.hash
}

/**
 * Step 2b: Wait until the ETH lightClient has indexed the lock epoch.
 * Pure read against an Ethereum RPC — does not touch the wallet.
 */
export async function waitForEpochOnEth(
  lockEpoch: number,
  onProgress?: (msg: string) => void,
): Promise<void> {
  const LC_ADDR          = '0xc01ca57dc7f7c4b6f1b6b87b85d79e5ddf0df55d'
  const LATEST_EPOCH_SEL = '0x9cb118bf'
  const maxWaitMs = 60 * 60 * 1000
  const pollMs    = 30_000
  const start     = Date.now()

  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(ETH_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
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
          `(current: ${latestEpoch}, ~${estMin} min remaining)`,
        )
      }
    } catch { /* keep polling */ }

    await new Promise(r => setTimeout(r, pollMs))
  }

  throw new Error(
    `Timeout: epoch ${lockEpoch} not yet available on Ethereum after 1 hour. ` +
    'You can retry the claim from Bridge History later.',
  )
}

/**
 * Refetch `LockedEventData` from Octra for a known tx hash.
 * Used by `HistoryPanel` to power the "Re-claim" action without rebuilding
 * the original bridge state.
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
 *
 * The bridge contract pulls wOCT from the user via `transferFrom`, so the
 * user must first `approve(bridge, amount)` on the wOCT token. We submit
 * both transactions in sequence and wait for the approve receipt before
 * issuing the burn — without the approve, the burn reverts on-chain and
 * the relayer never sees a valid `BurnInitiated` event, so OCT stays
 * locked on Octra forever.
 *
 * The optional `onProgress` callback fires once for each of the two
 * popups so callers can render "Step 1/2: approve" vs "Step 2/2: burn"
 * in real time. Without it, the wallet shows two popups back-to-back
 * with no UI hint to distinguish them.
 *
 * Returns the burn tx hash. The caller can use it to track the unlock on
 * Octra (the relayer reacts to `BurnInitiated` and submits
 * `unlock_trusted` on the OCT bridge contract).
 */
export async function burnWoctToOctra(
  sdk: OctraSDK,
  params: {
    octraRecipient: string
    amountWoct: string
  },
  onProgress?: (step: 'approve' | 'burn', msg: string) => void,
): Promise<string> {
  const { octraRecipient, amountWoct } = params

  const rawAmount = toRawUnits(amountWoct, OCT_DECIMALS)
  if (rawAmount <= 0n) throw new Error('Amount must be greater than 0')

  // Step 1: approve the bridge contract to pull `amount` wOCT from the user.
  // We sign this against the wOCT token contract (WOCT_TOKEN_ADDRESS), not
  // the bridge contract — `approve` lives on the ERC-20.
  const erc20Iface = new ethers.Interface([
    'function approve(address spender, uint256 amount) returns (bool)',
  ])
  const approveCalldata = erc20Iface.encodeFunctionData('approve', [
    WOCT_CONTRACT_ADDRESS,
    rawAmount,
  ])

  onProgress?.('approve', 'Step 1/2 — approve wOCT spend in OctWa')
  const approveResult = await sdk.evm.sendTransaction({
    to:    WOCT_TOKEN_ADDRESS,
    data:  approveCalldata,
    value: '0',
  })

  // Step 2: burn — calls `burnToOctra(string recipient, uint256 amount)` on
  // the bridge contract. This is the call that emits `BurnInitiated`, the
  // event the relayer watches to trigger `unlock_trusted` on Octra.
  const bridgeIface = new ethers.Interface(WOCT_ABI as ethers.InterfaceAbi)
  const burnCalldata = bridgeIface.encodeFunctionData('burnToOctra', [
    octraRecipient,
    rawAmount,
  ])

  onProgress?.('burn', 'Step 2/2 — confirm burn in OctWa')
  const burnResult = await sdk.evm.sendTransaction({
    to:    WOCT_CONTRACT_ADDRESS,
    data:  burnCalldata,
    value: '0',
  })

  // The history panel keys off the burn hash; we don't need to expose
  // the approve hash to the caller, but log it so debugging is easier
  // when a user reports "burn pending forever".
  console.info('[Bridge] wOCT approve:', approveResult.hash, '→ burn:', burnResult.hash)

  return burnResult.hash
}

/**
 * Read the wOCT burn caps directly from the contract.
 * Used by the BridgePanel to constrain the wOCT → OCT input.
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

// ─── Balance helpers ─────────────────────────────────────────────────────────

export async function getWoctBalance(
  ethAddress: string,
  provider: ethers.Provider,
): Promise<string> {
  const contract = new ethers.Contract(WOCT_TOKEN_ADDRESS, WOCT_TOKEN_ABI, provider)
  const raw: bigint = await contract.balanceOf(ethAddress)
  return (Number(raw) / Math.pow(10, OCT_DECIMALS)).toFixed(6)
}
