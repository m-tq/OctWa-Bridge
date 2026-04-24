/**
 * Pending ETH claim tx tracker — localStorage only.
 * Key: octraTxHash → { ethTxHash, submittedAt, status }
 * Used to prevent double-claiming and show pending/failed status.
 */

const KEY = 'oct-bridge-eth-claims'

export type ClaimTxStatus = 'pending' | 'confirmed' | 'failed'

export interface ClaimTxEntry {
  octraTxHash: string
  ethTxHash: string
  submittedAt: number
  status: ClaimTxStatus
}

function load(): Record<string, ClaimTxEntry> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }
}

function save(data: Record<string, ClaimTxEntry>) {
  localStorage.setItem(KEY, JSON.stringify(data))
}

export function storePendingClaim(octraTxHash: string, ethTxHash: string) {
  const data = load()
  data[octraTxHash] = { octraTxHash, ethTxHash, submittedAt: Date.now(), status: 'pending' }
  save(data)
}

export function getPendingClaim(octraTxHash: string): ClaimTxEntry | null {
  return load()[octraTxHash] ?? null
}

export function updateClaimStatus(octraTxHash: string, status: ClaimTxStatus) {
  const data = load()
  if (data[octraTxHash]) {
    data[octraTxHash].status = status
    save(data)
  }
}

export function removeClaim(octraTxHash: string) {
  const data = load()
  delete data[octraTxHash]
  save(data)
}

const INFURA_KEY = import.meta.env.VITE_INFURA_API_KEY || '121cf128273c4f0cb73770b391070d3b'

/**
 * Check ETH tx status via Infura
 * Returns: 'pending' | 'confirmed' | 'failed' | null (not found)
 */
export async function checkEthTxStatus(ethTxHash: string): Promise<ClaimTxStatus | null> {
  try {
    const res = await fetch(`https://mainnet.infura.io/v3/${INFURA_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'eth_getTransactionReceipt',
        params: [ethTxHash],
      }),
    })
    const json = await res.json()
    if (!json.result) return 'pending'  // not yet mined
    const status = parseInt(json.result.status, 16)
    return status === 1 ? 'confirmed' : 'failed'
  } catch {
    return null
  }
}
