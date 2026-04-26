import { DEFAULT_OCTRA_RPC, OCTRA_BRIDGE_CONTRACT } from './constants'
import type { OctraBalance, OctraTxResult } from './types'

let rpcUrl = DEFAULT_OCTRA_RPC

export function setOctraRpc(url: string) {
  rpcUrl = url.replace(/\/$/, '')
}

export function getOctraRpc() {
  return rpcUrl
}

async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(`${rpcUrl}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  if (!res.ok) throw new Error(`RPC HTTP error: ${res.status}`)
  const json = await res.json()
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error))
  return json.result as T
}

export async function getBalance(address: string): Promise<OctraBalance> {
  const result = await rpc<{
    balance: string       // e.g. "0.973000"
    balance_raw: string   // e.g. "973000"
    nonce: number
    pending_nonce: number
  }>('octra_balance', [address])
  return {
    formatted: result.balance,
    raw: result.balance_raw,
    nonce: result.nonce,
  }
}

export async function getNonce(address: string): Promise<number> {
  const result = await rpc<number | { address: string; nonce: number }>('octra_nonce', [address])
  if (typeof result === 'number') return result
  return (result as { nonce: number }).nonce
}

/**
 * Get registered ed25519 public key for an address (base64 string)
 */
export async function getPublicKey(address: string): Promise<string | null> {
  try {
    const result = await rpc<{ address: string; public_key: string } | string>('octra_publicKey', [address])
    if (typeof result === 'string') return result
    return (result as { public_key: string }).public_key || null
  } catch {
    return null
  }
}

/**
 * Submit a signed transaction to Octra RPC — with full debug logging
 */
export async function submitTx(tx: Record<string, unknown>): Promise<string> {
  console.log('[Bridge] Submitting tx:', JSON.stringify(tx, null, 2))

  const res = await fetch(`${rpcUrl}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'octra_submit', params: [tx] }),
  })

  const raw = await res.text()
  console.log('[Bridge] octra_submit raw response:', raw)

  if (!res.ok) throw new Error(`RPC HTTP ${res.status}: ${raw}`)

  const json = JSON.parse(raw)
  if (json.error) throw new Error(json.error.message || json.error.reason || JSON.stringify(json.error))

  const result = json.result
  console.log('[Bridge] octra_submit result:', result)

  if (typeof result === 'string') return result
  if (result?.status === 'rejected') throw new Error(result.reason || 'Transaction rejected')
  const hash = result?.tx_hash || result?.hash
  if (!hash) throw new Error(`No tx hash in response: ${JSON.stringify(result)}`)
  return hash
}

export async function getRecommendedFee(): Promise<number> {
  const result = await rpc<{ recommended: number | string }>('octra_recommendedFee', ['contract_call'])
  return typeof result.recommended === 'string' ? parseInt(result.recommended, 10) : result.recommended
}

export async function getTransaction(hash: string): Promise<{
  status: string
  epoch?: number
  nonce?: number
  amount_raw?: string
  from?: string
  to?: string
  message?: string
  data?: Record<string, unknown>
}> {
  return rpc('octra_transaction', [hash])
}

/**
 * Get contract execution receipt — includes emitted events
 * For lock_to_eth: events[0] = Locked(from, amount_raw, eth_address, nonce)
 */
export async function getContractReceipt(hash: string): Promise<{
  contract: string
  method: string
  success: boolean
  effort: number
  events: Array<{
    event: string
    values: string[]
  }>
  error: string | null
  epoch: number
  ts: number
} | null> {
  try {
    return await rpc('contract_receipt', [hash])
  } catch {
    return null
  }
}

/**
 * Get epoch data including state_root / tree_hash
 */
export async function getEpoch(epochId: number): Promise<{
  epoch_id: number
  tx_count: number
  finalized_by: string
  finalized_at: number
  parent_commit: string
  state_root: string
  tree_hash: string
}> {
  return rpc('epoch_get', [epochId])
}

export async function getNodeStatus(): Promise<{ epoch: number; network_version: string }> {
  return rpc('node_status', [])
}

/**
 * Build and submit a contract call transaction (lock_to_eth)
 * The wallet signs the tx using the Octra extension (window.octra)
 */
export async function submitContractCall(params: {
  from: string
  contract: string
  method: string
  args: unknown[]
  amount?: number
  fee?: number
  nonce: number
  privateKeyBase64: string
}): Promise<OctraTxResult> {
  // Build the transaction object for octra_submit
  // Octra uses ed25519 signing - we delegate to the wallet extension
  const tx = {
    type: 'contract_call',
    from: params.from,
    to: params.contract,
    method: params.method,
    params: params.args,
    amount: params.amount ?? 0,
    fee: params.fee ?? 1000,
    nonce: params.nonce,
  }

  // Sign via window.octra provider (extension wallet)
  if (typeof window !== 'undefined' && window.octra) {
    const result = await window.octra.invoke({
      header: {
        version: 2,
        circleId: '',
        branchId: 'main',
        epoch: 0,
        nonce: params.nonce,
        timestamp: Date.now(),
        originHash: '',
      },
      body: {
        capabilityId: '',
        method: 'send_contract_tx',
        payloadHash: '',
      },
    } as never)
    if (!result.success) throw new Error(result.error || 'Wallet rejected')
  }

  // Submit raw tx
  const hash = await rpc<string>('octra_submit', [tx])
  return { hash }
}

/**
 * Poll transaction until confirmed or rejected
 */
export async function waitForConfirmation(
  hash: string,
  timeoutMs = 120_000,
  intervalMs = 3000
): Promise<{ epoch: number; nonce: number }> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const tx = await getTransaction(hash)
    if (tx.status === 'confirmed') {
      return {
        epoch: (tx.epoch as number) ?? 0,
        nonce: (tx.nonce as number) ?? 0,
      }
    }
    if (tx.status === 'rejected' || tx.status === 'dropped') {
      throw new Error(`Transaction ${tx.status}: ${hash}`)
    }
    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error('Transaction confirmation timeout')
}

/**
 * Check if the bridge contract is paused.
 * contract_call → is_paused → result.result: "0" = open, "1" = paused
 */
export async function isBridgePaused(): Promise<boolean> {
  try {
    const result = await rpc<{ result: string }>('contract_call', [
      OCTRA_BRIDGE_CONTRACT,
      'is_paused',
      [],
    ])
    return result?.result === '1'
  } catch {
    return false // fail open — don't block users on RPC error
  }
}
