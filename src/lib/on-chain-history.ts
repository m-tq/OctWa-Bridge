/**
 * On-chain bridge history — no localStorage.
 *
 * OCT → wOCT (Octra side):
 *   octra_transactionsByAddress → filter lock_to_eth calls
 *   contract_receipt → Locked event → check processedMessages on ETH
 *
 * wOCT → OCT (Ethereum side):
 *   eth_getLogs → BurnInitiated(burnId, burner, octraRecipient, amount, nonce)
 *   where burner == evmAddress
 *   Status: tx confirmed = burn done, OCT unlock is automatic by relayer
 */

import { ethers } from 'ethers'
import {
  OCTRA_BRIDGE_CONTRACT,
  WOCT_CONTRACT_ADDRESS,
  OCTRA_CHAIN_ID,
  ETH_CHAIN_ID,
  BRIDGE_MSG_VERSION,
  BRIDGE_MSG_DIRECTION,
  BRIDGE_SRC_BRIDGE_ID,
  BRIDGE_DST_BRIDGE_ID,
  BRIDGE_TOKEN_ID,
  OCT_DECIMALS,
} from './constants'
import { getContractReceipt } from './octra-rpc'

const INFURA_KEY = import.meta.env.VITE_INFURA_API_KEY || '121cf128273c4f0cb73770b391070d3b'
const ETH_RPC = `https://mainnet.infura.io/v3/${INFURA_KEY}`

// Selectors (pre-computed)
const HASH_BRIDGE_MSG_SEL = '0x93cf0d23'  // hashBridgeMessage(tuple)
const PROCESSED_MSGS_SEL  = '0x88ba16ab'  // processedMessages(bytes32)

export interface BridgeTxRecord {
  octraTxHash: string
  epoch: number
  timestamp: number
  amountOct: string       // human-readable, e.g. "1.000000"
  amountRaw: string       // raw units string
  ethAddress: string
  srcNonce: number
  // ETH side
  msgHash?: string
  claimed: boolean
  claimStatus: 'claimed' | 'unclaimed' | 'epoch_pending' | 'unknown'
  ethBlock?: number | null
}

async function ethCall(data: string): Promise<string> {
  const res = await fetch(ETH_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'eth_call',
      params: [{ to: WOCT_CONTRACT_ADDRESS, data }, 'latest'],
    }),
  })
  const json = await res.json()
  return json.result as string
}

async function getLightClientLatestEpoch(): Promise<number> {
  const LC = '0xc01ca57dc7f7c4b6f1b6b87b85d79e5ddf0df55d'
  const res = await fetch(ETH_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'eth_call',
      params: [{ to: LC, data: '0x9cb118bf' }, 'latest'],
    }),
  })
  const json = await res.json()
  return json.result ? parseInt(json.result, 16) : 0
}

/**
 * Compute hashBridgeMessage for a Locked event
 */
function buildMsgCalldata(
  epoch: number,
  ethAddress: string,
  amountRaw: string,
  srcNonce: number
): string {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder()
  const tupleType = '(uint8,uint8,uint64,uint64,bytes32,bytes32,bytes32,address,uint128,uint64)'
  const encoded = abiCoder.encode([tupleType], [[
    BRIDGE_MSG_VERSION,
    BRIDGE_MSG_DIRECTION,
    BigInt(OCTRA_CHAIN_ID),
    BigInt(ETH_CHAIN_ID),
    BRIDGE_SRC_BRIDGE_ID,
    BRIDGE_DST_BRIDGE_ID,
    BRIDGE_TOKEN_ID,
    ethAddress,
    BigInt(amountRaw),
    BigInt(srcNonce),
  ]])
  return HASH_BRIDGE_MSG_SEL + encoded.slice(2)
}

/**
 * Check if a message hash has been claimed on Ethereum
 */
async function isMessageClaimed(msgHash: string): Promise<boolean> {
  const calldata = PROCESSED_MSGS_SEL + msgHash.slice(2).padStart(64, '0')
  const result = await ethCall(calldata)
  return result !== '0x0000000000000000000000000000000000000000000000000000000000000000'
}

/**
 * Fetch last N lock_to_eth transactions for an address from Octra RPC
 */
async function fetchLockTxs(
  octraAddress: string,
  rpcUrl: string,
  limit = 20
): Promise<Array<{
  hash: string
  epoch: number
  timestamp: number
  amount: string
}>> {
  const res = await fetch(`${rpcUrl}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'octra_transactionsByAddress',
      params: [octraAddress, 50, 0],  // fetch 50, filter down to 20 lock_to_eth
    }),
  })
  const json = await res.json()
  const txs: Array<Record<string, unknown>> = json.result?.transactions ?? []

  return txs
    .filter(tx =>
      tx.to === OCTRA_BRIDGE_CONTRACT &&
      tx.op_type === 'call'
      // Note: encrypted_data field is not always present — method validated via contract_receipt
    )
    .slice(0, limit)
    .map(tx => ({
      hash:      tx.hash as string,
      epoch:     tx.epoch as number,
      timestamp: tx.timestamp as number,
      amount:    tx.amount as string,
    }))
}

/**
 * Main function: fetch on-chain bridge history for an address
 */
export async function fetchBridgeHistory(
  octraAddress: string,
  rpcUrl: string
): Promise<BridgeTxRecord[]> {
  const [lockTxs, latestEpoch] = await Promise.all([
    fetchLockTxs(octraAddress, rpcUrl),
    getLightClientLatestEpoch(),
  ])

  const records = await Promise.all(lockTxs.map(async tx => {
    const record: BridgeTxRecord = {
      octraTxHash: tx.hash,
      epoch:       tx.epoch,
      timestamp:   tx.timestamp * 1000,
      amountOct:   (parseInt(tx.amount) / Math.pow(10, OCT_DECIMALS)).toFixed(6),
      amountRaw:   tx.amount,
      ethAddress:  '',
      srcNonce:    0,
      claimed:     false,
      claimStatus: 'unknown',
    }

    try {
      // Get Locked event data from contract_receipt
      const receipt = await getContractReceipt(tx.hash)
      if (!receipt?.success || receipt.method !== 'lock_to_eth') return record

      const lockedEvent = receipt.events.find(e => e.event === 'Locked')
      if (!lockedEvent || lockedEvent.values.length < 4) return record

      const [, amountRaw, ethAddress, nonceStr] = lockedEvent.values
      record.ethAddress = ethAddress
      record.srcNonce   = parseInt(nonceStr, 10)
      record.amountRaw  = amountRaw
      record.amountOct  = (parseInt(amountRaw) / Math.pow(10, OCT_DECIMALS)).toFixed(6)

      // Check if epoch is available on ETH lightClient
      if (tx.epoch > latestEpoch) {
        record.claimStatus = 'epoch_pending'
        return record
      }

      // Compute message hash and check processedMessages
      const msgCalldata = buildMsgCalldata(tx.epoch, ethAddress, amountRaw, record.srcNonce)
      const msgHashResult = await ethCall(msgCalldata)
      record.msgHash = msgHashResult

      const claimed = await isMessageClaimed(msgHashResult)
      record.claimed     = claimed
      record.claimStatus = claimed ? 'claimed' : 'unclaimed'
    } catch {
      record.claimStatus = 'unknown'
    }

    return record
  }))

  return records
}

/**
 * Look up a single tx hash — check if it's a valid lock_to_eth and whether it's claimed
 */
export async function lookupTxHash(
  txHash: string,
  rpcUrl: string
): Promise<BridgeTxRecord | null> {
  // Get tx details — only check it goes to bridge contract
  const res = await fetch(`${rpcUrl}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'octra_transaction',
      params: [txHash],
    }),
  })
  const json = await res.json()
  const tx = json.result
  if (!tx || tx.to !== OCTRA_BRIDGE_CONTRACT) {
    return null  // not to bridge contract
  }

  const [latestEpoch, receipt] = await Promise.all([
    getLightClientLatestEpoch(),
    getContractReceipt(txHash),
  ])

  // Validate via contract_receipt.method (more reliable than tx.encrypted_data)
  if (!receipt?.success || receipt.method !== 'lock_to_eth') return null

  const lockedEvent = receipt.events.find((e: { event: string }) => e.event === 'Locked')
  if (!lockedEvent || lockedEvent.values.length < 4) return null

  const [, amountRaw, ethAddress, nonceStr] = lockedEvent.values
  const srcNonce = parseInt(nonceStr, 10)
  const epoch    = receipt.epoch

  const record: BridgeTxRecord = {
    octraTxHash: txHash,
    epoch,
    timestamp:   (tx.timestamp as number) * 1000,
    amountOct:   (parseInt(amountRaw) / Math.pow(10, OCT_DECIMALS)).toFixed(6),
    amountRaw,
    ethAddress,
    srcNonce,
    claimed:     false,
    claimStatus: 'unknown',
  }

  if (epoch > latestEpoch) {
    record.claimStatus = 'epoch_pending'
    return record
  }

  const msgCalldata = buildMsgCalldata(epoch, ethAddress, amountRaw, srcNonce)
  const msgHash     = await ethCall(msgCalldata)
  record.msgHash    = msgHash

  const claimed      = await isMessageClaimed(msgHash)
  record.claimed     = claimed
  record.claimStatus = claimed ? 'claimed' : 'unclaimed'

  return record
}

// ─── wOCT → OCT history (Ethereum side) ──────────────────────────────────────

/**
 * BurnInitiated event:
 *   topic0: 0xfaa9b3e2244d80066df764926dce8b97fa7077d982b97f52195a39950fc100b4
 *   topic1: burnId (bytes32, indexed)
 *   topic2: burner (address, indexed)
 *   data:   octraRecipient (string), amount (uint256), nonce (uint64)
 */
const BURN_INITIATED_TOPIC0 = '0xfaa9b3e2244d80066df764926dce8b97fa7077d982b97f52195a39950fc100b4'

export interface BurnRecord {
  direction: 'woct-to-oct'
  ethTxHash: string
  blockNumber: number
  timestamp: number
  amountWoct: string    // human-readable
  amountRaw: string     // raw units
  octraRecipient: string
  burnNonce: number
  burnId: string
  status: 'confirmed'   // burn is always confirmed if in logs
}

async function getBlockTimestamp(blockHex: string): Promise<number> {
  const res = await fetch(ETH_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'eth_getBlockByNumber',
      params: [blockHex, false],
    }),
  })
  const json = await res.json()
  return json.result?.timestamp ? parseInt(json.result.timestamp, 16) * 1000 : Date.now()
}

/**
 * Fetch wOCT→OCT burn history for an EVM address.
 * Uses eth_getLogs to find BurnInitiated events where burner == evmAddress.
 * Looks back ~100,000 blocks (~2 weeks).
 */
export async function fetchBurnHistory(evmAddress: string): Promise<BurnRecord[]> {
  // Get current block
  const blockRes = await fetch(ETH_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
  })
  const blockJson = await blockRes.json()
  const latestBlock = parseInt(blockJson.result, 16)
  const fromBlock = Math.max(0, latestBlock - 100_000)

  // burner is topic2 (index 1 in topics array after topic0)
  const burnerTopic = '0x' + evmAddress.slice(2).toLowerCase().padStart(64, '0')

  const logsRes = await fetch(ETH_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'eth_getLogs',
      params: [{
        address:   WOCT_CONTRACT_ADDRESS,
        topics:    [BURN_INITIATED_TOPIC0, null, burnerTopic],
        fromBlock: '0x' + fromBlock.toString(16),
        toBlock:   'latest',
      }],
    }),
  })
  const logsJson = await logsRes.json()
  const logs: Array<Record<string, unknown>> = logsJson.result ?? []

  // Take last 20
  const recent = logs.slice(-20).reverse()

  const abiCoder = ethers.AbiCoder.defaultAbiCoder()

  const records = await Promise.all(recent.map(async log => {
    const topics = log.topics as string[]
    const data   = log.data as string
    const blockHex = log.blockNumber as string
    const txHash   = log.transactionHash as string

    // Decode non-indexed data: (string octraRecipient, uint256 amount, uint64 nonce)
    let octraRecipient = ''
    let amountRaw = '0'
    let burnNonce = 0
    try {
      const decoded = abiCoder.decode(['string', 'uint256', 'uint64'], data)
      octraRecipient = decoded[0] as string
      amountRaw      = (decoded[1] as bigint).toString()
      burnNonce      = Number(decoded[2] as bigint)
    } catch { /* ignore decode errors */ }

    const blockNumber = parseInt(blockHex, 16)
    const timestamp   = await getBlockTimestamp(blockHex)

    return {
      direction:      'woct-to-oct' as const,
      ethTxHash:      txHash,
      blockNumber,
      timestamp,
      amountWoct:     (parseInt(amountRaw) / Math.pow(10, OCT_DECIMALS)).toFixed(6),
      amountRaw,
      octraRecipient,
      burnNonce,
      burnId:         topics[1] ?? '',
      status:         'confirmed' as const,
    }
  }))

  return records
}
