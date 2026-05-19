/**
 * Octra JSON-RPC helpers — read-only.
 *
 * These functions hit the Octra node directly via fetch. They never sign
 * anything: every state-changing operation goes through the wallet via the
 * `@octwa/sdk` provider.
 *
 * The bridge UI uses these helpers for:
 *   - Confirming `lock_to_eth` transactions
 *   - Reading `contract_receipt` to extract the `Locked` event
 *   - Polling `is_paused` to gate the UI when the bridge is in maintenance
 */

import { DEFAULT_OCTRA_RPC, OCTRA_BRIDGE_CONTRACT } from './constants'
import type { OctraBalance } from './types'

let rpcUrl = DEFAULT_OCTRA_RPC

export function setOctraRpc(url: string) {
  rpcUrl = url.replace(/\/$/, '')
}

export function getOctraRpc(): string {
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
    raw:       result.balance_raw,
    nonce:     result.nonce,
  }
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
 * Get the contract execution receipt for a transaction. For `lock_to_eth` the
 * receipt contains a single event:
 *
 *   Locked(from, amount_raw, eth_address, nonce)
 *
 * which carries everything `verifyAndMint` needs on the Ethereum side.
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
 * Poll `octra_transaction` until the tx reaches a terminal status.
 * Throws when the tx is rejected or dropped, or when the timeout elapses.
 */
export async function waitForConfirmation(
  hash: string,
  timeoutMs = 120_000,
  intervalMs = 3000,
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
 * Check if the Octra bridge contract is paused. The contract exposes
 * `is_paused()` as a view function returning a stringified bigint —
 * "1" means paused, "0" means open.
 *
 * Fails open: any RPC error returns `false` so a node hiccup doesn't
 * lock users out of the bridge UI.
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
    return false
  }
}

/**
 * Check whether a wOCT burn (identified by its on-chain `burnId` from the
 * `BurnInitiated` event) has been processed on the Octra side via
 * `unlock_trusted`. The bridge contract tracks each processed burn under
 * the storage key `processed_unlocks:<burnId>` with value `"1"`.
 *
 * Direct storage lookup is much cheaper than `contract_call` for this —
 * we know the exact key and don't need the contract to execute anything.
 *
 * Returns:
 *   true  → relayer has called `unlock_trusted` and OCT was released
 *   false → still pending (or unknown — we don't distinguish)
 */
export async function isBurnUnlocked(burnId: string): Promise<boolean> {
  try {
    const result = await rpc<{ key: string; value: string } | null>(
      'octra_contractStorage',
      [OCTRA_BRIDGE_CONTRACT, `processed_unlocks:${burnId}`],
    )
    return result?.value === '1'
  } catch {
    return false
  }
}
