export {}

// ─── Capability returned by requestCapability ─────────────────────────────────
interface OctraCapability {
  id: string
  version: number
  circle: string
  methods: string[]
  scope: 'read' | 'write' | 'compute'
  encrypted: boolean
  appOrigin: string
  branchId: string
  epoch: number
  issuedAt: number
  expiresAt: number
  nonceBase: number
  walletPubKey: string
  signature: string
  state: 'ACTIVE' | 'EXPIRED' | 'REVOKED'
  lastNonce: number
}

// ─── Connection result ────────────────────────────────────────────────────────
interface OctraConnection {
  circle: string
  sessionId: string
  walletPubKey: string
  evmAddress: string          // always present — derived from same key
  network: 'devnet' | 'mainnet'
  epoch: number               // current epoch at connect time
  branchId: string
}

// ─── Invoke call structure ────────────────────────────────────────────────────
interface OctraInvokeCall {
  header: {
    version: number
    circleId: string
    branchId: string
    epoch: number
    nonce: number
    timestamp: number
    originHash: string
  }
  payload?: Uint8Array | { _type: 'Uint8Array'; data: number[] }
  body: {
    capabilityId: string
    method: string
    payloadHash: string
  }
}

// ─── Invoke result ────────────────────────────────────────────────────────────
interface OctraInvokeResult {
  success: boolean
  data?: Uint8Array | string | Record<string, unknown>
  error?: string
}

// ─── Disconnect result ────────────────────────────────────────────────────────
interface OctraDisconnectResult {
  disconnected: boolean
}

// ─── Provider discovery (analog EIP-6963) ────────────────────────────────────
interface OctraProviderInfo {
  uuid: string
  name: string
  rdns: string          // 'network.octra.octwa'
  version: string
}

interface OctraProviderDetail {
  info: OctraProviderInfo
  provider: OctraProvider
}

// ─── Main provider interface ──────────────────────────────────────────────────
interface OctraProvider {
  isOctra: true
  version: string

  /** Establish a session with the wallet. */
  connect(request: {
    circle: string
    appOrigin?: string
    appName?: string
    appIcon?: string
    requestedCapabilities?: Array<{
      methods: string[]
      scope: 'read' | 'write' | 'compute'
      encrypted: boolean
    }>
  }): Promise<OctraConnection>

  /** Disconnect and clear the session. Returns confirmation. */
  disconnect(): Promise<OctraDisconnectResult>

  /** Request a scoped capability (permission token). */
  requestCapability(request: {
    circle: string
    appOrigin?: string
    methods: string[]
    scope: 'read' | 'write' | 'compute'
    encrypted: boolean
    ttlSeconds?: number
    branchId?: string
  }): Promise<OctraCapability>

  /** Invoke a method using a previously granted capability. */
  invoke(call: OctraInvokeCall): Promise<OctraInvokeResult>

  /** Sign an arbitrary UTF-8 message with the wallet's Ed25519 key. */
  signMessage(message: string): Promise<string>

  /** List all active capabilities for this origin. */
  listCapabilities(): Promise<OctraCapability[]>

  /** Renew a capability before it expires. */
  renewCapability(capabilityId: string): Promise<OctraCapability>

  /** Revoke a capability immediately. */
  revokeCapability(capabilityId: string): Promise<void>

  on(event: 'connect',            cb: (data: { connection: OctraConnection }) => void): void
  on(event: 'disconnect',         cb: (data: { appOrigin: string }) => void): void
  on(event: 'capabilityGranted',  cb: (data: { capability: OctraCapability }) => void): void
  on(event: 'branchChanged',      cb: (data: { branchId: string; epoch: number }) => void): void
  on(event: 'epochChanged',       cb: (data: { epoch: number }) => void): void
  on(event: 'userRejectedRequest',cb: (data: { requestId: string }) => void): void
  on(event: string,               cb: (...args: unknown[]) => void): void
  off(event: string,              cb: (...args: unknown[]) => void): void
}

declare global {
  interface Window {
    octra?: OctraProvider
    ethereum?: unknown
  }

  interface WindowEventMap {
    'octra:announceProvider': CustomEvent<OctraProviderDetail>
    'octra:requestProvider':  Event
    'octraLoaded':            Event
  }
}
