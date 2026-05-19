// The OctWa provider surface (window.octra) is fully typed by `@octwa/sdk`.
// We import its `OctraProvider` type so the global remains TypeScript-safe
// while the SDK alone owns the canonical definition.
import type { OctraProvider } from '@octwa/sdk'

declare global {
  interface Window {
    octra?: OctraProvider
    /**
     * Other wallet providers (e.g. MetaMask). The bridge does not interact
     * with `window.ethereum`; it only needs the type to coexist with other
     * wallet extensions.
     */
    ethereum?: unknown
  }
}

export {}
