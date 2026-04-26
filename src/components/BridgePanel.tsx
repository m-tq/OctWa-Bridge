import { useState, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowRight, ArrowLeftRight,
  Loader2, CheckCircle2, XCircle,
  ExternalLink, Copy, RefreshCw,
  Wallet, RefreshCw as RefreshIcon,
} from 'lucide-react'
import { cn, shortenAddress } from '@/lib/utils'
import type { BridgeDirection, BridgeStep, BridgeState } from '@/lib/types'
import {
  lockOctOnOctra,
  waitForLockedEvent,
  waitForEpochOnEth,
  claimWoctOnEthereum,
  burnWoctToOctra,
} from '@/lib/bridge-service'
import { storePendingClaim } from '@/lib/pending-claims'
import type { ethers } from 'ethers'

const FEE_RESERVE_OCT  = 0.01   // OCT reserved for Octra tx fee
const MIN_ETH_FOR_GAS  = 130_000 * 2 / 1e9  // 130k gas × 2 Gwei

interface BridgePanelProps {
  octraAddress?: string
  evmAddress?: string
  ethSigner?: ethers.Signer
  octBalance?: string
  ethBalance?: string
  woctBalance?: string
  balanceLoading?: boolean
  onRefreshBalances: () => void
  onConnect: () => void
}

const STEP_LABELS: Record<BridgeStep, string> = {
  idle:          '',
  locking:       'Locking OCT on Octra...',
  waiting_epoch: 'Waiting for Octra confirmation...',
  claiming:      'Waiting for Ethereum to index epoch...',
  approving:     'Approving wOCT...',
  burning:       'Burning wOCT on Ethereum...',
  unlocking:     'Waiting for OCT unlock on Octra (~2 min)...',
  done:          'Transaction submitted!',
  error:         'Bridge failed',
}

const pageVariants = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } },
  exit:    { opacity: 0, y: -12, transition: { duration: 0.25, ease: 'easeIn' } },
}

const OCT_TO_WOCT_STEPS: { step: BridgeStep; label: string }[] = [
  { step: 'locking',       label: 'Lock OCT' },
  { step: 'waiting_epoch', label: 'Epoch confirm' },
  { step: 'claiming',      label: 'Mint wOCT' },
]

const WOCT_TO_OCT_STEPS: { step: BridgeStep; label: string }[] = [
  { step: 'burning',   label: 'Burn wOCT' },
  { step: 'unlocking', label: 'Unlock OCT' },
]

export function BridgePanel({
  octraAddress,
  evmAddress,
  ethSigner,
  octBalance,
  ethBalance,
  woctBalance,
  balanceLoading,
  onRefreshBalances,
  onConnect,
}: BridgePanelProps) {
  const [direction, setDirection] = useState<BridgeDirection>('oct-to-woct')
  const [amount, setAmount]       = useState('')
  const [state, setState]         = useState<BridgeState>({
    direction: 'oct-to-woct', step: 'idle', amount: '', octraAddress: '', ethAddress: '',
  })
  const [progressMsg, setProgressMsg] = useState('')
  const [copied, setCopied]           = useState<string | null>(null)

  const isOctToWoct = direction === 'oct-to-woct'
  const isActive    = state.step !== 'idle' && state.step !== 'done' && state.step !== 'error'
  const isDone      = state.step === 'done'
  const isError     = state.step === 'error'
  const isConnected = !!octraAddress && !!evmAddress

  // ── Balances & validation ─────────────────────────────────────────────────
  const octBalanceNum  = octBalance  ? parseFloat(octBalance)  : 0
  const woctBalanceNum = woctBalance ? parseFloat(woctBalance) : 0
  const ethBalanceNum  = ethBalance  ? parseFloat(ethBalance)  : 0

  const fromBalance = isOctToWoct ? octBalanceNum : woctBalanceNum
  const fromToken   = isOctToWoct ? 'OCT' : 'wOCT'
  const toToken     = isOctToWoct ? 'wOCT' : 'OCT'

  const maxAmount = isOctToWoct
    ? Math.max(0, octBalanceNum - FEE_RESERVE_OCT)
    : woctBalanceNum

  const amountNum = parseFloat(amount) || 0

  const amountError = useMemo(() => {
    if (!amount || amountNum <= 0) return null
    if (amountNum > maxAmount) {
      return isOctToWoct
        ? `Max: ${maxAmount.toFixed(6)} OCT (0.01 reserved for fee)`
        : `Max: ${maxAmount.toFixed(6)} wOCT`
    }
    return null
  }, [amount, amountNum, maxAmount, isOctToWoct])

  const ethLow = isConnected && isOctToWoct && ethBalanceNum < MIN_ETH_FOR_GAS

  const handleMax = () => {
    if (maxAmount > 0) setAmount(maxAmount.toFixed(6))
  }

  const setStep = (step: BridgeStep, extra?: Partial<Omit<BridgeState, 'direction' | 'step' | 'amount' | 'octraAddress' | 'ethAddress'>>) => {
    setState(s => ({ ...s, step, ...extra }))
  }

  // ── OCT → wOCT ───────────────────────────────────────────────────────────
  const handleOctToWoct = useCallback(async () => {
    if (!octraAddress || !evmAddress) return
    setState({ direction: 'oct-to-woct', step: 'idle', amount, octraAddress, ethAddress: evmAddress })

    try {
      setStep('locking')
      setProgressMsg('Confirm the lock transaction in your OctWa wallet...')
      const lockResult = await lockOctOnOctra({ octraAddress, ethRecipient: evmAddress, amountOct: amount })
      setStep('waiting_epoch', { octraTxHash: lockResult.hash })

      const lockedData = await waitForLockedEvent(lockResult.hash, msg => setProgressMsg(msg))

      setStep('claiming', { epochId: lockedData.epoch, srcNonce: lockedData.srcNonce })
      setProgressMsg(`Waiting for epoch ${lockedData.epoch} on Ethereum...`)
      await waitForEpochOnEth(lockedData.epoch, msg => setProgressMsg(msg))

      setProgressMsg('Requesting write capability from OctWa...')
      if (!window.octra) throw new Error('Octra extension not found')
      const cap = await window.octra.requestCapability({
        circle: 'oct-bridge', appOrigin: window.location.origin,
        methods: ['send_evm_transaction'], scope: 'write', encrypted: false,
      })

      setProgressMsg('Confirm the verifyAndMint transaction in OctWa...')
      const ethHash = await claimWoctOnEthereum(lockedData, cap.id, Date.now())

      storePendingClaim(lockResult.hash, ethHash)
      setStep('done', { ethTxHash: ethHash })
      setProgressMsg('')
      onRefreshBalances()
    } catch (err) {
      setStep('error', { error: err instanceof Error ? err.message : String(err) })
      setProgressMsg('')
    }
  }, [amount, octraAddress, evmAddress, onRefreshBalances])

  // ── wOCT → OCT ───────────────────────────────────────────────────────────
  const handleWoctToOct = useCallback(async () => {
    if (!octraAddress || !evmAddress) return
    setState({ direction: 'woct-to-oct', step: 'idle', amount, octraAddress, ethAddress: evmAddress })

    try {
      setStep('burning')
      setProgressMsg('Requesting write capability from OctWa...')
      if (!window.octra) throw new Error('Octra extension not found')
      const cap = await window.octra.requestCapability({
        circle: 'oct-bridge', appOrigin: window.location.origin,
        methods: ['send_evm_transaction'], scope: 'write', encrypted: false,
      })

      setProgressMsg('Confirm the burnToOctra transaction in OctWa...')
      const ethHash = await burnWoctToOctra({
        octraRecipient: octraAddress,
        amountWoct:     amount,
        capabilityId:   cap.id,
        nonce:          Date.now(),
      })

      setStep('unlocking', { ethTxHash: ethHash })
      setProgressMsg('wOCT burned. Bridge relayer will unlock OCT on Octra (~2 min)...')

      // Don't block — OCT unlock is automatic by bridge relayer
      setStep('done', { ethTxHash: ethHash })
      setProgressMsg('')
      onRefreshBalances()
    } catch (err) {
      setStep('error', { error: err instanceof Error ? err.message : String(err) })
      setProgressMsg('')
    }
  }, [amount, octraAddress, evmAddress, onRefreshBalances])

  const handleBridge = useCallback(() => {
    if (!amount || amountNum <= 0 || amountError) return
    if (isOctToWoct) return handleOctToWoct()
    return handleWoctToOct()
  }, [isOctToWoct, amount, amountNum, amountError, handleOctToWoct, handleWoctToOct])

  const reset = () => {
    setState({ direction, step: 'idle', amount: '', octraAddress: '', ethAddress: '' })
    setAmount('')
    setProgressMsg('')
  }

  const switchDirection = () => {
    if (isActive) return
    const next: BridgeDirection = isOctToWoct ? 'woct-to-oct' : 'oct-to-woct'
    setDirection(next)
    setAmount('')
    setState({ direction: next, step: 'idle', amount: '', octraAddress: '', ethAddress: '' })
    setProgressMsg('')
  }

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 1500)
  }

  const canBridge = isConnected && amountNum > 0 && !amountError && !isActive

  // ── Not connected ─────────────────────────────────────────────────────────
  if (!isConnected) {
    return (
      <div className="w-full h-full flex items-center justify-center p-6">
        <motion.div variants={pageVariants} initial="initial" animate="animate" className="text-center">
          <div className="w-12 h-12 border border-dashed border-border flex items-center justify-center mx-auto mb-4">
            <Wallet size={20} className="text-muted-foreground" />
          </div>
          <p className="text-sm font-medium mb-1">Connect your OctWa wallet</p>
          <p className="text-xs text-muted-foreground mb-5 max-w-xs">
            One wallet, two chains. OctWa derives your Ethereum address from the same key.
          </p>
          <button onClick={onConnect} className="px-6 py-2.5 bg-primary text-primary-foreground text-sm hover:opacity-90 transition-opacity">
            Connect OctWa
          </button>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="w-full h-full flex items-center justify-center p-6">
      <motion.div variants={pageVariants} initial="initial" animate="animate" className="w-full max-w-md">

        {/* Balance strip */}
        <div className="mb-4 pb-3 border-b border-dashed border-border">
          <div className="flex items-center justify-between text-[10px] mb-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground w-7">OCT</span>
              <span className="font-mono text-foreground">{shortenAddress(octraAddress!, 8)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={onRefreshBalances} disabled={balanceLoading} className="hover-glow transition-all text-muted-foreground disabled:opacity-40 mr-1">
                <RefreshIcon size={9} className={balanceLoading ? 'animate-spin' : ''} />
              </button>
              {balanceLoading ? <Loader2 size={9} className="animate-spin text-muted-foreground" /> : (
                <span className="font-mono font-medium text-foreground">
                  {octBalance ? parseFloat(octBalance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 }) : '—'}
                </span>
              )}
              <span className="text-muted-foreground">OCT</span>
            </div>
          </div>
          <div className="flex items-center justify-between text-[10px] mb-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground w-7">ETH</span>
              <span className="font-mono text-foreground">{shortenAddress(evmAddress!, 8)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              {balanceLoading ? <Loader2 size={9} className="animate-spin text-muted-foreground" /> : (
                <span className="font-mono font-medium text-foreground">
                  {ethBalance ? parseFloat(ethBalance).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 }) : '—'}
                </span>
              )}
              <span className="text-muted-foreground">ETH</span>
            </div>
          </div>
          <div className="flex items-center justify-between text-[10px]">
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground w-7">wOCT</span>
              <span className="font-mono text-foreground">{shortenAddress(evmAddress!, 8)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              {balanceLoading ? <Loader2 size={9} className="animate-spin text-muted-foreground" /> : (
                <span className="font-mono font-medium text-foreground">
                  {woctBalance ? parseFloat(woctBalance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 }) : '—'}
                </span>
              )}
              <span className="text-muted-foreground">wOCT</span>
            </div>
          </div>
        </div>

        {/* Direction tabs */}
        <div className="flex border-b border-border mb-5">
          <button
            onClick={() => { if (!isActive) { setDirection('oct-to-woct'); reset() } }}
            className={cn('flex-1 py-2 text-xs font-medium transition-all',
              direction === 'oct-to-woct'
                ? 'text-primary border-b-2 border-primary'
                : 'text-muted-foreground hover:[filter:drop-shadow(0_0_4px_currentColor)_drop-shadow(0_0_8px_currentColor)]'
            )}
          >
            OCT → wOCT
          </button>
          <button
            onClick={() => { if (!isActive) { setDirection('woct-to-oct'); reset() } }}
            className={cn('flex-1 py-2 text-xs font-medium transition-all',
              direction === 'woct-to-oct'
                ? 'text-primary border-b-2 border-primary'
                : 'text-muted-foreground hover:[filter:drop-shadow(0_0_4px_currentColor)_drop-shadow(0_0_8px_currentColor)]'
            )}
          >
            wOCT → OCT
          </button>
        </div>

        <AnimatePresence mode="wait">
          {!isDone && !isError ? (
            <motion.div key="form" variants={pageVariants} initial="initial" animate="animate" exit="exit">

              {/* From → To */}
              <div className="flex items-center gap-2 mb-4 text-xs text-muted-foreground">
                <span className="px-2 py-1 border border-border">{isOctToWoct ? 'Octra' : 'Ethereum'}</span>
                <ArrowRight size={12} />
                <span className="px-2 py-1 border border-border">{isOctToWoct ? 'Ethereum' : 'Octra'}</span>
                <button onClick={switchDirection} disabled={isActive} className="ml-auto hover-glow transition-all disabled:opacity-40" title="Swap direction">
                  <ArrowLeftRight size={13} />
                </button>
              </div>

              {/* Amount */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-muted-foreground">Amount ({fromToken})</label>
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="text-muted-foreground">
                      bal: <span className="text-foreground font-mono">
                        {fromBalance.toLocaleString('en-US', { maximumFractionDigits: 6 })}
                      </span>
                    </span>
                    {maxAmount > 0 && (
                      <button
                        onClick={handleMax}
                        disabled={isActive}
                        className="text-primary hover:[filter:drop-shadow(0_0_4px_currentColor)_drop-shadow(0_0_8px_currentColor)] transition-all disabled:opacity-40"
                      >
                        Max
                      </button>
                    )}
                  </div>
                </div>
                <input
                  type="number" min="0" step="any" placeholder="0.000000"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  disabled={isActive}
                  className={cn(
                    'w-full bg-background border px-3 py-2 text-sm focus:outline-none transition-colors disabled:opacity-50',
                    amountError ? 'border-destructive' : 'border-input focus:border-primary'
                  )}
                />
                {amountError && <p className="text-[10px] text-destructive mt-1">{amountError}</p>}
                {!amountError && amount && amountNum > 0 && isOctToWoct && (
                  <p className="text-[10px] text-muted-foreground mt-1">0.01 OCT reserved for network fee</p>
                )}
              </div>

              {/* Recipient info */}
              <div className="mb-5">
                <label className="text-xs text-muted-foreground block mb-1">
                  {isOctToWoct ? 'ETH Recipient' : 'OCT Recipient'}
                </label>
                <div className="w-full bg-muted/30 border border-border px-3 py-2 text-xs font-mono text-muted-foreground flex items-center justify-between">
                  <span>{isOctToWoct ? evmAddress : octraAddress}</span>
                  <span className="text-[9px] text-primary ml-2 flex-shrink-0">derived</span>
                </div>
              </div>

              {/* Summary */}
              {amountNum > 0 && !amountError && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className="mb-5 p-3 border border-dashed border-border text-xs space-y-1"
                >
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">You send</span>
                    <span>{amount} {fromToken}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">You receive</span>
                    <span className="text-primary">{amount} {toToken}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Bridge fee</span>
                    <span>0 (free)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Est. time</span>
                    <span>~2 min</span>
                  </div>
                  {!isOctToWoct && (
                    <div className="flex justify-between pt-1 border-t border-dashed border-border text-[10px]">
                      <span className="text-muted-foreground">Note</span>
                      <span className="text-muted-foreground">OCT unlocked automatically by bridge relayer</span>
                    </div>
                  )}
                </motion.div>
              )}

              {/* ETH balance warning (OCT→wOCT only) */}
              {ethLow && (
                <div className="mb-3 px-3 py-2 border border-yellow-500/40 text-[10px] text-yellow-600 dark:text-yellow-400">
                  ⚠ ETH balance low ({ethBalanceNum.toFixed(4)} ETH). Need ~{MIN_ETH_FOR_GAS.toFixed(5)} ETH for gas.
                </div>
              )}

              {/* Progress */}
              {isActive && (
                <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 size={13} className="animate-spin flex-shrink-0" />
                  <span>{progressMsg || STEP_LABELS[state.step]}</span>
                </div>
              )}

              {/* Bridge button */}
              <button
                onClick={handleBridge}
                disabled={!canBridge}
                className="w-full py-2.5 bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isActive ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 size={14} className="animate-spin" />
                    {STEP_LABELS[state.step]}
                  </span>
                ) : (
                  `Bridge ${fromToken} → ${toToken}`
                )}
              </button>

              {/* Step tracker */}
              {isActive && <StepTracker direction={direction} currentStep={state.step} />}
            </motion.div>

          ) : isDone ? (
            <motion.div key="done" variants={pageVariants} initial="initial" animate="animate" exit="exit" className="text-center py-6">
              <CheckCircle2 size={40} className="text-primary mx-auto mb-3" />
              <p className="text-sm font-medium mb-1">Transaction Submitted!</p>
              <p className="text-xs text-muted-foreground mb-1">
                {state.amount} {isOctToWoct ? 'OCT locked' : 'wOCT burned'}
              </p>
              <p className="text-xs text-muted-foreground mb-4">
                {isOctToWoct
                  ? 'verifyAndMint submitted. Check Bridge History for status.'
                  : 'OCT will be unlocked on Octra by the bridge relayer (~2 min).'}
              </p>
              <div className="space-y-2 mb-5 text-xs">
                {state.octraTxHash && (
                  <TxLink label="Octra TX" hash={state.octraTxHash}
                    href={`https://octrascan.io/tx.html?hash=${state.octraTxHash}`}
                    onCopy={() => copyToClipboard(state.octraTxHash!, 'octra')} copied={copied === 'octra'} />
                )}
                {state.ethTxHash && (
                  <TxLink label="Ethereum TX" hash={state.ethTxHash}
                    href={`https://etherscan.io/tx/${state.ethTxHash}`}
                    onCopy={() => copyToClipboard(state.ethTxHash!, 'eth')} copied={copied === 'eth'} />
                )}
              </div>
              <button onClick={reset} className="flex items-center gap-1.5 mx-auto text-xs text-muted-foreground hover-glow transition-all">
                <RefreshCw size={12} />Bridge again
              </button>
            </motion.div>

          ) : (
            <motion.div key="error" variants={pageVariants} initial="initial" animate="animate" exit="exit" className="text-center py-6">
              <XCircle size={40} className="text-destructive mx-auto mb-3" />
              <p className="text-sm font-medium mb-1">Bridge Failed</p>
              <p className="text-xs text-muted-foreground mb-4 break-all px-2">{state.error}</p>
              <button onClick={reset} className="flex items-center gap-1.5 mx-auto text-xs text-muted-foreground hover-glow transition-all">
                <RefreshCw size={12} />Try again
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}

// ── Step tracker ──────────────────────────────────────────────────────────────

function StepTracker({ direction, currentStep }: { direction: BridgeDirection; currentStep: BridgeStep }) {
  const steps = direction === 'oct-to-woct' ? OCT_TO_WOCT_STEPS : WOCT_TO_OCT_STEPS
  const currentIdx = steps.findIndex(s => s.step === currentStep)
  return (
    <div className="flex items-center justify-center mt-4">
      {steps.map((s, i) => (
        <div key={s.step} className="flex items-center">
          <div className="flex flex-col items-center gap-1">
            <div className={cn('w-5 h-5 flex items-center justify-center text-[9px] border',
              i < currentIdx  ? 'bg-primary border-primary text-primary-foreground'
              : i === currentIdx ? 'border-primary text-primary'
              : 'border-border text-muted-foreground'
            )}>
              {i < currentIdx ? '✓' : i + 1}
            </div>
            <span className="text-[9px] text-muted-foreground whitespace-nowrap">{s.label}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={cn('w-8 h-px mb-4', i < currentIdx ? 'bg-primary' : 'bg-border')} />
          )}
        </div>
      ))}
    </div>
  )
}

// ── Tx link ───────────────────────────────────────────────────────────────────

function TxLink({ label, hash, href, onCopy, copied }: {
  label: string; hash: string; href: string; onCopy: () => void; copied: boolean
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2 border border-border">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <span className="font-mono">{shortenAddress(hash, 8)}</span>
        <button onClick={onCopy} className="hover-glow transition-all text-muted-foreground">
          {copied ? <CheckCircle2 size={11} className="text-primary" /> : <Copy size={11} />}
        </button>
        <a href={href} target="_blank" rel="noopener noreferrer" className="hover-glow transition-all text-muted-foreground">
          <ExternalLink size={11} />
        </a>
      </div>
    </div>
  )
}
