import { useState, useCallback, useEffect, useRef } from 'react'
import { ethers } from 'ethers'
import { getOctBalance, getWoctBalance } from '@/lib/bridge-service'
import { setOctraRpc } from '@/lib/octra-rpc'

const INFURA_KEY = import.meta.env.VITE_INFURA_API_KEY || '121cf128273c4f0cb73770b391070d3b'
const ETH_MAINNET_RPC = `https://mainnet.infura.io/v3/${INFURA_KEY}`

export interface WalletState {
  octraAddress?: string
  evmAddress?: string
  ethSigner?: ethers.Signer
  ethProvider?: ethers.JsonRpcProvider
  octBalance?: string   // OCT on Octra chain
  ethBalance?: string   // ETH native on Ethereum
  woctBalance?: string  // wOCT on Ethereum
  loading: boolean
  balanceLoading: boolean
  connected: boolean
}

export function useWallets() {
  const [state, setState] = useState<WalletState>({ loading: false, balanceLoading: false, connected: false })
  const signerRef = useRef<ethers.Wallet | null>(null)

  // RPC is fixed to env var — no localStorage override
  // This prevents Mixed Content errors on HTTPS deployments

  /**
   * Connect via Octra wallet extension (window.octra).
   * The extension returns evmAddress derived from the same secp256k1 private key.
   * We then create an ethers signer using that same key via the extension's signMessage.
   */
  const connect = useCallback(async () => {
    if (!window.octra) {
      alert('Octra wallet extension not found. Please install OctWa.')
      return
    }

    try {
      setState(s => ({ ...s, loading: true }))

      // Disconnect first to clear any cached connection in the extension
      // This ensures the extension uses the currently active wallet
      try { await window.octra.disconnect() } catch { /* ignore */ }

      // Small delay to let extension process disconnect
      await new Promise(r => setTimeout(r, 200))

      // Connect fresh — extension will use currently active wallet
      const conn = await window.octra.connect({
        circle: 'oct-bridge',
        appOrigin: window.location.origin,
        appName: 'OctWa Bridge',
      })

      const octraAddress = conn.walletPubKey || (conn as Record<string, unknown>).address as string
      const evmAddress = conn.evmAddress

      if (!evmAddress) {
        throw new Error('Wallet did not return an EVM address. Please update your OctWa extension.')
      }

      console.log('[Bridge] Connected:', { octraAddress, evmAddress })

      const provider = new ethers.JsonRpcProvider(ETH_MAINNET_RPC)
      const signer = new OctraEVMSigner(evmAddress, provider)
      signerRef.current = null

      setState(s => ({
        ...s,
        octraAddress,
        evmAddress,
        ethSigner: signer,
        ethProvider: provider,
        connected: true,
        loading: false,
        balanceLoading: true,
        // Clear old balances on wallet switch
        octBalance: undefined,
        ethBalance: undefined,
        woctBalance: undefined,
      }))

      await refreshBalancesInternal(octraAddress, evmAddress, provider)
      setState(s => ({ ...s, balanceLoading: false }))
    } catch (err) {
      console.error('Connect failed:', err)
      setState(s => ({ ...s, loading: false }))
      alert(`Connection failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [])

  const disconnect = useCallback(async () => {
    try { await window.octra?.disconnect() } catch { /* ignore */ }
    setState({ loading: false, balanceLoading: false, connected: false, octBalance: undefined, ethBalance: undefined, woctBalance: undefined })
    signerRef.current = null
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

// ─── Custom EVM Signer backed by Octra extension ─────────────────────────────
// The Octra extension holds the secp256k1 private key.
// For EVM transactions, we delegate signing to the extension via invoke.

class OctraEVMSigner extends ethers.AbstractSigner {
  private _address: string
  private _provider: ethers.JsonRpcProvider

  constructor(address: string, provider: ethers.JsonRpcProvider) {
    super(provider)
    this._address = address
    this._provider = provider
  }

  async getAddress(): Promise<string> {
    return this._address
  }

  connect(provider: ethers.Provider): ethers.Signer {
    return new OctraEVMSigner(this._address, provider as ethers.JsonRpcProvider)
  }

  async signMessage(message: string | Uint8Array): Promise<string> {
    if (!window.octra) throw new Error('Octra extension not available')
    const msg = typeof message === 'string' ? message : new TextDecoder().decode(message)
    const result = await window.octra.invoke({
      header: {
        version: 2,
        circleId: 'oct-bridge',
        branchId: 'main',
        epoch: 0,
        nonce: Date.now(),
        timestamp: Date.now(),
        originHash: '',
      },
      body: {
        capabilityId: 'bridge',
        method: 'sign_evm_message',
        payloadHash: msg,
      },
    })
    if (!result.success) throw new Error(result.error || 'Sign failed')
    return typeof result.data === 'string' ? result.data : ''
  }

  async signTransaction(tx: ethers.TransactionRequest): Promise<string> {
    if (!window.octra) throw new Error('Octra extension not available')

    // Populate missing fields manually (provider doesn't have populateTransaction)
    const fromAddr = this._address
    const [nonce, feeData, network] = await Promise.all([
      this._provider.getTransactionCount(fromAddr),
      this._provider.getFeeData(),
      this._provider.getNetwork(),
    ])
    const populated: ethers.TransactionLike = {
      type:                 2,
      to:                   typeof tx.to === 'string' ? tx.to : await Promise.resolve(tx.to) as string,
      from:                 fromAddr,
      data:                 tx.data,
      nonce:                tx.nonce ?? nonce,
      chainId:              tx.chainId ?? network.chainId,
      gasLimit:             tx.gasLimit ?? 250_000n,
      maxFeePerGas:         tx.maxFeePerGas ?? feeData.maxFeePerGas ?? ethers.parseUnits('20', 'gwei'),
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas ?? feeData.maxPriorityFeePerGas ?? ethers.parseUnits('1', 'gwei'),
      value:                tx.value ?? 0n,
    }

    // Serialize the unsigned transaction to get the signing hash
    const unsignedSerialized = ethers.Transaction.from(populated).unsignedSerialized
    const txHash = ethers.keccak256(unsignedSerialized)

    console.log('[Bridge] Signing ETH tx hash:', txHash)
    console.log('[Bridge] Unsigned tx:', unsignedSerialized.slice(0, 60) + '...')

    // Sign the tx hash via extension signMessage
    // Extension signs with secp256k1 key (same key used to derive evmAddress)
    // signMessage returns base64 ed25519 signature — but we need secp256k1 for ETH
    // The extension's signMessage for Octra uses ed25519, NOT secp256k1
    // So we need to use the raw bytes approach
    const sigHex = await window.octra.signMessage(txHash)
    if (!sigHex) throw new Error('Extension rejected ETH tx signing')

    console.log('[Bridge] ETH sig from extension:', sigHex)

    // The signature from extension is base64 ed25519 — this won't work for ETH
    // We need to decode it as a secp256k1 signature (r, s, v)
    // If extension returns proper secp256k1 sig for ETH tx hash, decode it
    let sigBytes: Uint8Array
    try {
      // Try base64 decode first
      const b64 = atob(sigHex)
      sigBytes = new Uint8Array(b64.length)
      for (let i = 0; i < b64.length; i++) sigBytes[i] = b64.charCodeAt(i)
    } catch {
      // Try hex decode
      sigBytes = ethers.getBytes(sigHex)
    }

    console.log('[Bridge] sig bytes length:', sigBytes.length)

    // For secp256k1: sig is 64 bytes (r=32, s=32) + recovery bit
    // Try to construct ethers signature
    if (sigBytes.length === 64) {
      // Try v=27 and v=28
      for (const v of [27, 28]) {
        try {
          const sig = ethers.Signature.from({
            r: ethers.hexlify(sigBytes.slice(0, 32)),
            s: ethers.hexlify(sigBytes.slice(32, 64)),
            v,
          })
          const recovered = ethers.recoverAddress(txHash, sig)
          if (recovered.toLowerCase() === this._address.toLowerCase()) {
            console.log('[Bridge] Recovered address matches! v =', v)
            const signedTx = ethers.Transaction.from({ ...populated, signature: sig } as ethers.TransactionLike)
            return signedTx.serialized
          }
        } catch { /* try next v */ }
      }
    } else if (sigBytes.length === 65) {
      const sig = ethers.Signature.from(ethers.hexlify(sigBytes))
      const signedTx = ethers.Transaction.from({ ...populated, signature: sig } as ethers.TransactionLike)
      return signedTx.serialized
    }

    throw new Error(
      `Extension returned ${sigBytes.length}-byte signature. ` +
      'ETH tx signing requires secp256k1 signature from the extension. ' +
      'The extension may only support ed25519 (Octra) signing, not secp256k1 (ETH) signing.'
    )
  }

  async signTypedData(
    _domain: ethers.TypedDataDomain,
    _types: Record<string, ethers.TypedDataField[]>,
    _value: Record<string, unknown>
  ): Promise<string> {
    throw new Error('signTypedData not supported via Octra extension')
  }
}
