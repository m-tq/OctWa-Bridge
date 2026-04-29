import { useState, useCallback } from 'react'
import { ethers } from 'ethers'
import { getOctBalance, getWoctBalance } from '@/lib/bridge-service'

const INFURA_KEY = import.meta.env.VITE_INFURA_API_KEY || '121cf128273c4f0cb73770b391070d3b'
const ETH_MAINNET_RPC = `https://mainnet.infura.io/v3/${INFURA_KEY}`

export interface WalletState {
  octraAddress?: string
  evmAddress?: string
  ethSigner?: ethers.Signer
  ethProvider?: ethers.JsonRpcProvider
  octBalance?: string
  ethBalance?: string
  woctBalance?: string
  loading: boolean
  balanceLoading: boolean
  connected: boolean
}

export function useWallets() {
  const [state, setState] = useState<WalletState>({
    loading: false,
    balanceLoading: false,
    connected: false,
  })

  /**
   * Connect via Octra wallet extension (window.octra).
   *
   * The extension returns:
   *   - walletPubKey: Octra address
   *   - evmAddress:   Ethereum address derived from the same key
   *
   * We create a read-only ethers provider for balance queries.
   * All EVM transactions go through window.octra.invoke('send_evm_transaction')
   * — the extension holds the private key and signs internally.
   */
  const connect = useCallback(async () => {
    if (!window.octra) {
      alert('Octra wallet extension not found. Please install OctWa.')
      return
    }

    try {
      setState(s => ({ ...s, loading: true }))

      // Disconnect first to clear any cached connection
      try { await window.octra.disconnect() } catch { /* ignore */ }
      await new Promise(r => setTimeout(r, 200))

      const conn = await window.octra.connect({
        circle:    'oct-bridge',
        appOrigin: window.location.origin,
        appName:   'OctWa Bridge',
      })

      const octraAddress = conn.walletPubKey
      const evmAddress   = conn.evmAddress

      if (!evmAddress) {
        throw new Error(
          'Wallet did not return an EVM address. Please update your OctWa extension.'
        )
      }

      console.log('[Bridge] Connected:', { octraAddress, evmAddress, epoch: conn.epoch })

      // Read-only provider — only used for balance queries and fee data.
      // Actual EVM transactions are signed by the extension via invoke.
      const provider = new ethers.JsonRpcProvider(ETH_MAINNET_RPC)

      setState(s => ({
        ...s,
        octraAddress,
        evmAddress,
        ethProvider: provider,
        connected:   true,
        loading:     false,
        balanceLoading: true,
        octBalance:  undefined,
        ethBalance:  undefined,
        woctBalance: undefined,
      }))

      await refreshBalancesInternal(octraAddress, evmAddress, provider)
      setState(s => ({ ...s, balanceLoading: false }))
    } catch (err) {
      console.error('[Bridge] Connect failed:', err)
      setState(s => ({ ...s, loading: false }))
      alert(`Connection failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [])

  const disconnect = useCallback(async () => {
    try { await window.octra?.disconnect() } catch { /* ignore */ }
    setState({
      loading: false,
      balanceLoading: false,
      connected: false,
      octBalance: undefined,
      ethBalance: undefined,
      woctBalance: undefined,
    })
  }, [])

  const refreshBalancesInternal = async (
    octraAddr: string,
    evmAddr: string,
    provider: ethers.JsonRpcProvider
  ) => {
    const [oct, eth, woct] = await Promise.allSettled([
      getOctBalance(octraAddr),
      provider.getBalance(evmAddr).then(wei => ethers.formatEther(wei)),
      getWoctBalance(evmAddr, provider),
    ])
    setState(s => ({
      ...s,
      octBalance:  oct.status  === 'fulfilled' ? oct.value  : s.octBalance,
      ethBalance:  eth.status  === 'fulfilled' ? eth.value  : s.ethBalance,
      woctBalance: woct.status === 'fulfilled' ? woct.value : s.woctBalance,
    }))
  }

  const refreshBalances = useCallback(async () => {
    const { octraAddress, evmAddress, ethProvider } = state
    if (!octraAddress || !evmAddress || !ethProvider) return
    setState(s => ({ ...s, balanceLoading: true }))
    try {
      await refreshBalancesInternal(octraAddress, evmAddress, ethProvider)
    } finally {
      setState(s => ({ ...s, balanceLoading: false }))
    }
  }, [state])

  return {
    ...state,
    connect,
    disconnect,
    refreshBalances,
  }
}
