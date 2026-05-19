import { useCallback, useEffect, useRef, useState } from 'react'
import { ethers } from 'ethers'
import { OctraSDK } from '@octwa/sdk'
import { getWoctBalance } from '@/lib/bridge-service'

const INFURA_KEY = import.meta.env.VITE_INFURA_API_KEY || ''
// Public RPC fallback for read-only EVM calls (balance, eth_call).
// publicnode.com: no key required, no CORS restriction, reliable.
const PUBLIC_ETH_RPC = 'https://ethereum.publicnode.com'
const ETH_MAINNET_RPC = INFURA_KEY
  ? `https://mainnet.infura.io/v3/${INFURA_KEY}`
  : PUBLIC_ETH_RPC

/**
 * Permissions the bridge needs from the wallet.
 *
 *   read_address       — discover the connected Octra address
 *   read_balance       — refresh the OCT balance via RPC pass-through
 *   contract_calls     — sendContractTransaction(lock_to_eth, …)
 *   send_transactions  — sign / submit base transactions; also accepted by the
 *                        wallet as a fallback for EVM signing operations,
 *                        so a single grant covers both chains.
 */
const REQUIRED_PERMISSIONS = [
  'read_address',
  'read_balance',
  'contract_calls',
  'send_transactions',
] as const

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
 * Built against `@octwa/sdk@2.1.0` (RFC-O-1):
 *   - `connect()` opens the approval popup and returns the active address
 *   - `evm.getDerivedAddress()` resolves the matching 0x address (same key)
 *   - `rpc('octra_balance', […])` fetches the OCT balance
 *
 * EVM (ETH and wOCT) balances continue to use ethers directly — read-only
 * RPC calls don't need a wallet round-trip.
 */
export function useWallets() {
  const [state, setState] = useState<WalletState>({
    loading: false,
    balanceLoading: false,
    connected: false,
    connectError: null,
  })

  const sdkRef = useRef<OctraSDK | null>(null)

  const clearError = useCallback(() => {
    setState(s => ({ ...s, connectError: null }))
  }, [])

  const getSDK = useCallback(async (): Promise<OctraSDK> => {
    if (sdkRef.current) return sdkRef.current
    const sdk = await OctraSDK.init({ timeout: 3000 })
    sdkRef.current = sdk
    return sdk
  }, [])

  const refreshBalancesInternal = useCallback(async (
    sdk: OctraSDK,
    octraAddr: string,
    evmAddr: string,
    provider: ethers.JsonRpcProvider,
  ) => {
    const [octResult, ethResult, woctResult] = await Promise.allSettled([
      sdk.rpc<{ balance: string }>('octra_balance', [octraAddr])
        .then(r => parseFloat(r.balance).toFixed(6)),
      provider.getBalance(evmAddr).then(wei => ethers.formatEther(wei)),
      getWoctBalance(evmAddr, provider),
    ])
    setState(s => ({
      ...s,
      octBalance:  octResult.status  === 'fulfilled' ? octResult.value  : s.octBalance,
      ethBalance:  ethResult.status  === 'fulfilled' ? ethResult.value  : s.ethBalance,
      woctBalance: woctResult.status === 'fulfilled' ? woctResult.value : s.woctBalance,
    }))
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

      // Request the full permission set in one connect approval — this is the
      // user-facing prompt. RFC-O-1 lets us bundle all needed scopes here.
      const accounts = await sdk.connect({
        permissions: [...REQUIRED_PERMISSIONS],
      })
      const octraAddress = accounts[0]
      if (!octraAddress) throw new Error('Wallet returned no accounts')

      // Resolve the derived 0x address from the same BIP39 seed.
      const evmAddress = await sdk.evm.getDerivedAddress()
      if (!evmAddress) {
        throw new Error('Wallet did not return an EVM address. Please update OctWa.')
      }

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

      await refreshBalancesInternal(sdk, octraAddress, evmAddress, provider)
      setState(s => ({ ...s, balanceLoading: false }))
    } catch (err) {
      console.error('[Bridge] Connect failed:', err)
      setState(s => ({
        ...s,
        loading:      false,
        connectError: err instanceof Error ? err.message : String(err),
      }))
    }
  }, [getSDK, refreshBalancesInternal])

  const disconnect = useCallback(async () => {
    // Revoke the session at the wallet so reconnecting opens the
    // approval popup again — without this the wallet would short-circuit
    // and silently re-use the previous wallet selection.
    try {
      const sdk = sdkRef.current
      if (sdk?.isInstalled()) {
        await sdk.disconnect()
      }
    } catch (err) {
      console.warn('[Bridge] Disconnect error:', err)
    }

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

  const refreshBalances = useCallback(async () => {
    const { octraAddress, evmAddress, ethProvider } = state
    const sdk = sdkRef.current
    if (!sdk || !octraAddress || !evmAddress || !ethProvider) return
    setState(s => ({ ...s, balanceLoading: true }))
    try {
      await refreshBalancesInternal(sdk, octraAddress, evmAddress, ethProvider)
    } finally {
      setState(s => ({ ...s, balanceLoading: false }))
    }
  }, [state, refreshBalancesInternal])

  // React to wallet-driven account / disconnect events.
  useEffect(() => {
    const sdk = sdkRef.current
    if (!sdk?.isInstalled()) return

    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = (args[0] as string[] | undefined) ?? []
      if (accounts.length === 0) {
        // user revoked or locked
        void disconnect()
      } else if (state.octraAddress && accounts[0] !== state.octraAddress) {
        // active account changed in the wallet — re-derive everything
        void connect()
      }
    }

    const onDisconnect = () => { void disconnect() }

    sdk.on('accountsChanged', onAccountsChanged)
    sdk.on('disconnect', onDisconnect)

    return () => {
      sdk.removeListener('accountsChanged', onAccountsChanged)
      sdk.removeListener('disconnect', onDisconnect)
    }
  }, [state.octraAddress, connect, disconnect])

  return {
    ...state,
    sdk: sdkRef.current,
    connect,
    disconnect,
    refreshBalances,
    clearError,
  }
}
