export {}

interface OctraProvider {
  isOctra: boolean
  version: string
  connect(request: {
    circle: string
    appOrigin: string
    appName?: string
    appIcon?: string
  }): Promise<{
    circle: string
    sessionId: string
    walletPubKey: string
    evmAddress?: string
    network: 'testnet' | 'mainnet'
    epoch?: number
    branchId?: string
    address?: string
  }>
  disconnect(): Promise<void>
  requestCapability(request: {
    circle: string
    appOrigin?: string
    methods: string[]
    scope: 'read' | 'write' | 'compute'
    encrypted: boolean
    ttlSeconds?: number
  }): Promise<{
    id: string
    methods: string[]
    scope: string
    nonceBase: number
    expiresAt: number
  }>
  invoke(call: {
    header: {
      version: number
      circleId: string
      branchId: string
      epoch: number
      nonce: number
      timestamp: number
      originHash: string
    }
    payload?: Uint8Array | { _type: string; data: number[] }
    body: {
      capabilityId: string
      method: string
      payloadHash: string
    }
  }): Promise<{
    success: boolean
    data?: Uint8Array | string | Record<string, unknown>
    error?: string
  }>
  signMessage(message: string): Promise<string>
  on(event: string, callback: (...args: unknown[]) => void): void
  off(event: string, callback: (...args: unknown[]) => void): void
}

declare global {
  interface Window {
    octra?: OctraProvider
    ethereum?: unknown
  }
}
