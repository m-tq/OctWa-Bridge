import { useState, useCallback, useRef } from 'react'
import { ethers } from 'ethers'
import { OctraSDK } from '@octwa/sdk'
import type { Capability } from '@octwa/sdk'
import { getWoctBalance } from '@/lib/bridge-service'

const INFURA_KEY = import.meta.env.VITE_INFURA_API_KEY || ''
// For read-only EVM calls (balance, eth_call) we prefer a public RPC that
// doesn't require an API key. Infura is only used when a valid key is provided.
// Public fallbacks: Cloudflare, Ankr — no key needed, no CORS restriction.
const PUBLIC_ETH_RPC = 'https://cloudflare-eth.com'
const ETH_MAINNET_RPC = INFURA_KEY
  ? `https://mainnet.infura.io/v3/${INFURA_KEY}`
  : PUBLIC_ETH_RPC

export interface WalletState {
  octraAddress?: string
  evmAddress?: string
  ethProvider?: ethers.JsonRpcProvider
  octBalance?: string
  ethBalance?: string
  woctBalance?: string
  loading: boolean
  balanceLoading: boolean
  connected: boolean
  connectError: string | null
}

/**
 * useWallets — manages OctWa wallet connection for the bridge.
 *
 * Uses @octwa/sdk v1.3.4 for:
 *   - Provider detection
 *   - connect() / disconnect() lifecycle
 *   - getBalance() — OCT balance via SDK capability (no direct RPC)
 *   - requestCapability() — exposed for BridgePanel / HistoryPanel
 *
 * ETH / wOCT balances still use ethers.js directly (EVM side).
 */
export function useWallets() {
  const [state, setState] = useState<WalletState>({
    loading: false,
    balanceLoading: false,
    connected: false,
    connectError: null,
  })

  const sdkRef  = useRef<OctraSDK | null>(null)
  // Read capability for balance fetching — reused across refreshes
  const readCapRef = useRef<Capability | null>(null)

  const clearError = useCallback(() => {
    setState(s => ({ ...s, connectError: null }))
  }, [])

  const getSDK = useCallback(async (): Promise<OctraSDK> => {
    if (sdkRef.current) return sdkRef.current
    const sdk = await OctraSDK.init({ timeout: 3000 })
    sdkRef.current = sdk
    return sdk
  }, [])

  const connect = useCallback(async () => {
    try {
      setState(s => ({ ...s, loading: true, connectError: null }))

      const sdk = await getSDK()

      if (!sdk.isInstalled()) {
        setState(s => ({
          ...s,
          loading: false,
          connectError: 'Octra wallet extension not found. Please install OctWa.',
        }))
        return
      }

      try { await sdk.disconnect() } catch { /* ignore */ }
      await new Promise(r => setTimeout(r, 200))

      const conn = await sdk.connect({
        circle:    'oct-bridge',
        appOrigin: window.location.origin,
        appName:   'OctWa Bridge',
      })

      const octraAddress = conn.walletPubKey
      const evmAddress   = conn.evmAddress

      if (!evmAddress) {
        throw new Error('Wallet did not return an EVM address. Please update your OctWa extension.')
      }

      // Request a read capability for balance fetching
      const readCap = await sdk.requestCapability({
        circle:    'oct-bridge',
        methods:   ['get_balance'],
        scope:     'read',
        encrypted: false,
        ttlSeconds: 3600,
      })
      readCapRef.current = readCap

      const provider = new ethers.JsonRpcProvider(ETH_MAINNET_RPC)

      setState(s => ({
        ...s,
        octraAddress,
        evmAddress,
        ethProvider:    provider,
        connected:      true,
        loading:        false,
        balanceLoading: true,
        connectError:   null,
        octBalance:     undefined,
        ethBalance:     undefined,
        woctBalance:    undefined,
      }))

      await refreshBalancesInternal(sdk, readCap, octraAddress, evmAddress, provider)
      setState(s => ({ ...s, balanceLoading: false }))
    } catch (err) {
      console.error('[Bridge] Connect failed:', err)
      setState(s => ({
        ...s,
        loading:      false,
        connectError: err instanceof Error ? err.message : String(err),
      }))
    }
  }, [getSDK])

  const disconnect = useCallback(async () => {
    try {
      const sdk = sdkRef.current
      if (sdk) await sdk.disconnect()
    } catch { /* ignore */ }
    readCapRef.current = null
    setState({
      loading:        false,
      balanceLoading: false,
      connected:      false,
      connectError:   null,
      octBalance:     undefined,
      ethBalance:     undefined,
      woctBalance:    undefined,
    })
  }, [])

  const requestCapability = useCallback(async (params: {
    methods: string[]
    scope: 'read' | 'write' | 'compute'
    encrypted: boolean
    ttlSeconds?: number
  }): Promise<Capability> => {
    const sdk = await getSDK()
    if (!sdk.isInstalled()) throw new Error('OctWa extension not found')
    return sdk.requestCapability({ circle: 'oct-bridge', ...params })
  }, [getSDK])

  /**
   * Fetch OCT balance via SDK getBalance(), ETH and wOCT via ethers.
   */
  const refreshBalancesInternal = async (
    sdk: OctraSDK,
    readCap: Capability,
    octraAddr: string,
    evmAddr: string,
    provider: ethers.JsonRpcProvider
  ) => {
    const [octResult, ethResult, woctResult] = await Promise.allSettled([
      sdk.getBalance(readCap.id).then(b => b.octBalance.toFixed(6)),
      provider.getBalance(evmAddr).then(wei => ethers.formatEther(wei)),
      getWoctBalance(evmAddr, provider),
    ])
    setState(s => ({
      ...s,
      octBalance:  octResult.status  === 'fulfilled' ? octResult.value  : s.octBalance,
      ethBalance:  ethResult.status  === 'fulfilled' ? ethResult.value  : s.ethBalance,
      woctBalance: woctResult.status === 'fulfilled' ? woctResult.value : s.woctBalance,
    }))
  }

  const refreshBalances = useCallback(async () => {
    const { octraAddress, evmAddress, ethProvider } = state
    if (!octraAddress || !evmAddress || !ethProvider) return
    const sdk = sdkRef.current
    const readCap = readCapRef.current
    if (!sdk || !readCap) return
    setState(s => ({ ...s, balanceLoading: true }))
    try {
      await refreshBalancesInternal(sdk, readCap, octraAddress, evmAddress, ethProvider)
    } finally {
      setState(s => ({ ...s, balanceLoading: false }))
    }
  }, [state])

  return {
    ...state,
    sdk: sdkRef.current,
    connect,
    disconnect,
    refreshBalances,
    requestCapability,
    clearError,
  }
}
