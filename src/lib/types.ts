export type BridgeDirection = 'oct-to-woct' | 'woct-to-oct'

export type BridgeStep =
  | 'idle'
  | 'locking'
  | 'waiting_epoch'
  | 'claiming'
  | 'approving'
  | 'burning'
  | 'unlocking'
  | 'done'
  | 'error'

export interface BridgeState {
  direction: BridgeDirection
  step: BridgeStep
  amount: string
  octraAddress: string
  ethAddress: string
  octraTxHash?: string
  ethTxHash?: string
  epochId?: number
  srcNonce?: number
  error?: string
}

/**
 * Data extracted from Locked event via contract_receipt.
 * Contains everything needed to call verifyAndMint.
 */
export interface LockedEventData {
  from: string
  amountRaw: bigint
  ethAddress: string
  srcNonce: number
  epoch: number
  txHash: string
}

export interface OctraTxResult {
  hash: string
  epoch?: number
  nonce?: number
}

export interface OctraBalance {
  formatted: string
  raw: string
  nonce: number
}
