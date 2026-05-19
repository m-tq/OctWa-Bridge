import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ExternalLink, ArrowRight, RefreshCw, Loader2,
  CheckCircle2, Zap, Clock, Search, AlertCircle,
} from 'lucide-react'
import { cn, shortenAddress } from '@/lib/utils'
import type { OctraSDK } from '@octwa/sdk'
import type { BridgeTxRecord, BurnRecord } from '@/lib/on-chain-history'
import { fetchBridgeHistory, fetchBurnHistory, lookupTxHash } from '@/lib/on-chain-history'
import { claimWoctOnEthereum, refetchLockedEvent, waitForEpochOnEth } from '@/lib/bridge-service'
import { getOctraRpc } from '@/lib/octra-rpc'
import {
  storePendingClaim, getPendingClaim, updateClaimStatus,
  checkEthTxStatus,
} from '@/lib/pending-claims'

const pageVariants = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } },
}

interface HistoryPanelProps {
  octraAddress?: string
  evmAddress?: string
  sdk: OctraSDK | null
}

const STATUS_LABEL: Record<BridgeTxRecord['claimStatus'], string> = {
  claimed:       'claimed',
  unclaimed:     'unclaimed',
  epoch_pending: 'epoch pending',
  unknown:       'unknown',
}

const STATUS_CLASS: Record<BridgeTxRecord['claimStatus'], string> = {
  claimed:       'text-primary border-primary/30',
  unclaimed:     'text-yellow-500 border-yellow-500/30',
  epoch_pending: 'text-muted-foreground border-border',
  unknown:       'text-muted-foreground border-border',
}

export function HistoryPanel({ octraAddress, evmAddress, sdk }: HistoryPanelProps) {
  const [records, setRecords]         = useState<BridgeTxRecord[]>([])
  const [burnRecords, setBurnRecords] = useState<BurnRecord[]>([])
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [claiming, setClaiming]       = useState<string | null>(null)
  const [claimErr, setClaimErr]       = useState<Record<string, string>>({})
  const [claimProg, setClaimProg]     = useState<Record<string, string>>({})

  // Manual lookup
  const [lookupHash, setLookupHash]         = useState('')
  const [lookupResult, setLookupResult]     = useState<BridgeTxRecord | null | 'not_found'>(null)
  const [lookupLoading, setLookupLoading]   = useState(false)
  const [lookupError, setLookupError]       = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!octraAddress && !evmAddress) return
    setLoading(true)
    setError(null)
    try {
      const [lockData, burnData] = await Promise.allSettled([
        octraAddress ? fetchBridgeHistory(octraAddress, getOctraRpc()) : Promise.resolve([]),
        evmAddress   ? fetchBurnHistory(evmAddress) : Promise.resolve([]),
      ])
      if (lockData.status === 'fulfilled') setRecords(lockData.value)
      if (burnData.status === 'fulfilled') setBurnRecords(burnData.value)
      if (lockData.status === 'rejected' && burnData.status === 'rejected') {
        setError(lockData.reason?.message || 'Failed to load history')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [octraAddress, evmAddress])

  useEffect(() => { load() }, [load])

  const handleClaim = useCallback(async (rec: BridgeTxRecord, force = false) => {
    if (!sdk) return

    if (!force) {
      const existing = getPendingClaim(rec.octraTxHash)
      if (existing && existing.status === 'pending') {
        const onChainStatus = await checkEthTxStatus(existing.ethTxHash)
        if (onChainStatus === 'confirmed') {
          updateClaimStatus(rec.octraTxHash, 'confirmed')
          await load()
          return
        }
        if (onChainStatus === 'pending') {
          setClaimErr(e => ({
            ...e,
            [rec.octraTxHash]: `TX pending: ${existing.ethTxHash.slice(0, 10)}... Click "Force Re-claim" to retry.`,
          }))
          return
        }
        updateClaimStatus(rec.octraTxHash, 'failed')
      }
    }

    setClaiming(rec.octraTxHash)
    setClaimErr(e => { const n = { ...e }; delete n[rec.octraTxHash]; return n })
    setClaimProg(p => ({ ...p, [rec.octraTxHash]: 'Fetching lock data...' }))

    try {
      const lockedData = await refetchLockedEvent(rec.octraTxHash)

      if (rec.claimStatus === 'epoch_pending') {
        await waitForEpochOnEth(lockedData.epoch, msg =>
          setClaimProg(p => ({ ...p, [rec.octraTxHash]: msg })),
        )
      }

      setClaimProg(p => ({ ...p, [rec.octraTxHash]: 'Confirm in OctWa...' }))
      const ethHash = await claimWoctOnEthereum(sdk, lockedData)

      storePendingClaim(rec.octraTxHash, ethHash)
      setClaimProg(p => ({ ...p, [rec.octraTxHash]: `Submitted: ${ethHash.slice(0, 10)}...` }))
      pollConfirmation(rec.octraTxHash, ethHash)
      await load()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setClaimErr(err => ({ ...err, [rec.octraTxHash]: msg }))
      setClaimProg(p => { const n = { ...p }; delete n[rec.octraTxHash]; return n })
    } finally {
      setClaiming(null)
    }
  }, [load, sdk])

  const pollConfirmation = useCallback((octraTxHash: string, ethTxHash: string) => {
    const maxAttempts = 40
    let attempt = 0
    const interval = setInterval(async () => {
      attempt++
      const status = await checkEthTxStatus(ethTxHash)
      if (status === 'confirmed') {
        updateClaimStatus(octraTxHash, 'confirmed')
        setClaimProg(p => { const n = { ...p }; delete n[octraTxHash]; return n })
        clearInterval(interval)
        load()
      } else if (status === 'failed') {
        updateClaimStatus(octraTxHash, 'failed')
        setClaimErr(e => ({ ...e, [octraTxHash]: 'ETH tx failed. You can re-claim.' }))
        setClaimProg(p => { const n = { ...p }; delete n[octraTxHash]; return n })
        clearInterval(interval)
      } else if (attempt >= maxAttempts) {
        clearInterval(interval)
        setClaimProg(p => { const n = { ...p }; delete n[octraTxHash]; return n })
      }
    }, 30_000)
  }, [load])

  const handleLookup = async () => {
    const hash = lookupHash.trim()
    if (!hash) return
    setLookupLoading(true)
    setLookupError(null)
    setLookupResult(null)
    try {
      const result = await lookupTxHash(hash, getOctraRpc())
      setLookupResult(result ?? 'not_found')
    } catch (e) {
      setLookupError(e instanceof Error ? e.message : String(e))
    } finally {
      setLookupLoading(false)
    }
  }

  const hasAny = records.length > 0 || burnRecords.length > 0

  return (
    <div className="w-full h-full overflow-y-auto p-4">
      <motion.div variants={pageVariants} initial="initial" animate="animate" className="w-full max-w-3xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-4 pb-2 border-b border-border">
          <h2 className="text-sm font-medium">Bridge History</h2>
          <button
            onClick={load}
            disabled={loading || (!octraAddress && !evmAddress)}
            className="hover-glow transition-all text-muted-foreground disabled:opacity-40"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Manual lookup */}
        <div className="mb-5 p-3 border border-dashed border-border">
          <p className="text-[10px] text-muted-foreground mb-2 font-medium">Manual TX Lookup</p>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Octra tx hash (64 hex chars)"
              value={lookupHash}
              onChange={e => setLookupHash(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLookup()}
              className="flex-1 bg-background border border-input px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary transition-colors"
            />
            <button
              onClick={handleLookup}
              disabled={lookupLoading || !lookupHash.trim()}
              className="flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground text-xs hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {lookupLoading ? <Loader2 size={11} className="animate-spin" /> : <Search size={11} />}
              Check
            </button>
          </div>

          <AnimatePresence>
            {lookupError && (
              <motion.p initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="text-[10px] text-destructive mt-2">{lookupError}</motion.p>
            )}
            {lookupResult === 'not_found' && (
              <motion.p initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="text-[10px] text-muted-foreground mt-2">Not a valid lock_to_eth transaction.</motion.p>
            )}
            {lookupResult && lookupResult !== 'not_found' && (
              <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="mt-2 space-y-1 text-[10px]">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Amount</span>
                  <span className="font-medium">{lookupResult.amountOct} OCT</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Epoch</span>
                  <span className="font-mono">{lookupResult.epoch}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">ETH Recipient</span>
                  <span className="font-mono">{shortenAddress(lookupResult.ethAddress, 8)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <span className={cn('px-1.5 py-0.5 border', STATUS_CLASS[lookupResult.claimStatus])}>
                    {STATUS_LABEL[lookupResult.claimStatus]}
                  </span>
                </div>
                {lookupResult.claimStatus === 'unclaimed' && (
                  <button
                    onClick={() => handleClaim(lookupResult as BridgeTxRecord, false)}
                    disabled={!!claiming}
                    className="w-full mt-1 flex items-center justify-center gap-1 py-1 border border-primary text-primary text-[11px] hover:opacity-80 disabled:opacity-40"
                  >
                    <Zap size={10} />Verify &amp; Claim wOCT
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── 2-column history ── */}
        {!octraAddress && !evmAddress ? (
          <p className="text-xs text-muted-foreground text-center py-8">Connect wallet to view history.</p>
        ) : loading && !hasAny ? (
          <div className="flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground">
            <Loader2 size={13} className="animate-spin" />Loading on-chain history...
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 py-8 text-xs text-destructive justify-center">
            <AlertCircle size={13} />{error}
          </div>
        ) : !hasAny ? (
          <p className="text-xs text-muted-foreground text-center py-8">No bridge transactions found.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 items-start">

            {/* ── Left column: OCT → wOCT ── */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 pb-1 border-b border-border">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">OCT</span>
                <ArrowRight size={9} className="text-muted-foreground" />
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">wOCT</span>
                {records.length > 0 && (
                  <span className="ml-auto text-[9px] text-muted-foreground/60">{records.length}</span>
                )}
              </div>

              {records.length === 0 ? (
                <p className="text-[10px] text-muted-foreground/60 text-center py-4">No locks found.</p>
              ) : (
                records.map(rec => {
                  const isClaiming = claiming === rec.octraTxHash
                  const err  = claimErr[rec.octraTxHash]
                  const prog = claimProg[rec.octraTxHash]
                  const pending = getPendingClaim(rec.octraTxHash)
                  const isPendingTx = pending?.status === 'pending'

                  return (
                    <div
                      key={rec.octraTxHash}
                      className={cn(
                        'border p-2.5 text-[11px] space-y-1.5',
                        rec.claimStatus === 'claimed' ? 'border-primary/30' : 'border-border'
                      )}
                    >
                      {/* Amount + badge */}
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-medium truncate">{rec.amountOct} OCT</span>
                        <span className={cn('text-[9px] px-1 py-0.5 border flex items-center gap-0.5 shrink-0', STATUS_CLASS[rec.claimStatus])}>
                          {rec.claimStatus === 'claimed'       && <CheckCircle2 size={8} />}
                          {rec.claimStatus === 'unclaimed'     && <Zap size={8} />}
                          {rec.claimStatus === 'epoch_pending' && <Clock size={8} />}
                          {STATUS_LABEL[rec.claimStatus]}
                        </span>
                      </div>

                      {/* Tx link + epoch */}
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span className="text-muted-foreground/60">ep {rec.epoch}</span>
                        <a
                          href={`https://octrascan.io/tx.html?hash=${rec.octraTxHash}`}
                          target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-0.5 hover-glow transition-all font-mono"
                        >
                          {shortenAddress(rec.octraTxHash, 6)}<ExternalLink size={8} />
                        </a>
                      </div>

                      {/* ETH recipient */}
                      {rec.ethAddress && (
                        <div className="text-[10px] text-muted-foreground/60 font-mono truncate">
                          → {shortenAddress(rec.ethAddress, 8)}
                        </div>
                      )}

                      {/* Timestamp */}
                      <div className="text-[9px] text-muted-foreground/50">
                        {new Date(rec.timestamp).toLocaleString()}
                      </div>

                      {/* Progress */}
                      {prog && (
                        <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
                          <Loader2 size={8} className="animate-spin shrink-0" />{prog}
                        </div>
                      )}

                      {/* Error */}
                      {err && <p className="text-[9px] text-destructive break-all">{err}</p>}

                      {/* Claim button */}
                      {(rec.claimStatus === 'unclaimed' || rec.claimStatus === 'epoch_pending') && (
                        <div className="space-y-1 pt-0.5">
                          {isPendingTx && (
                            <div className="text-[9px] text-yellow-500 flex items-center gap-1">
                              <Clock size={8} />
                              <a href={`https://etherscan.io/tx/${pending!.ethTxHash}`}
                                target="_blank" rel="noopener noreferrer"
                                className="font-mono hover-glow transition-all">
                                {shortenAddress(pending!.ethTxHash, 6)}
                              </a>
                              <ExternalLink size={7} />
                            </div>
                          )}
                          <button
                            onClick={() => handleClaim(rec, false)}
                            disabled={!!claiming}
                            className={cn(
                              'w-full flex items-center justify-center gap-1 py-1 text-[10px] font-medium border transition-opacity',
                              'border-primary text-primary hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed'
                            )}
                          >
                            {isClaiming
                              ? <><Loader2 size={9} className="animate-spin" />Claiming...</>
                              : rec.claimStatus === 'epoch_pending'
                              ? <><Clock size={9} />Wait epoch</>
                              : <><Zap size={9} />Claim wOCT</>
                            }
                          </button>
                          {isPendingTx && (
                            <button
                              onClick={() => handleClaim(rec, true)}
                              disabled={!!claiming}
                              className="w-full flex items-center justify-center gap-1 py-0.5 text-[9px] text-muted-foreground border border-dashed border-border hover:opacity-80 disabled:opacity-40"
                            >
                              Force re-claim
                            </button>
                          )}
                        </div>
                      )}

                      {/* Claimed footer */}
                      {rec.claimStatus === 'claimed' && (
                        <div className="flex items-center gap-1 text-[9px] text-primary">
                          <CheckCircle2 size={8} />
                          {rec.amountOct} wOCT → {shortenAddress(rec.ethAddress, 5)}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>

            {/* ── Right column: wOCT → OCT ── */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 pb-1 border-b border-border">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">wOCT</span>
                <ArrowRight size={9} className="text-muted-foreground" />
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">OCT</span>
                {burnRecords.length > 0 && (
                  <span className="ml-auto text-[9px] text-muted-foreground/60">{burnRecords.length}</span>
                )}
              </div>

              {burnRecords.length === 0 ? (
                <p className="text-[10px] text-muted-foreground/60 text-center py-4">No burns found.</p>
              ) : (
                burnRecords.map(burn => (
                  <div key={burn.ethTxHash} className="border border-primary/20 p-2.5 text-[11px] space-y-1.5">
                    {/* Amount + badge */}
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-medium truncate">{burn.amountWoct} wOCT</span>
                      <span className="text-[9px] px-1 py-0.5 border text-primary border-primary/30 flex items-center gap-0.5 shrink-0">
                        <CheckCircle2 size={8} />burned
                      </span>
                    </div>

                    {/* ETH tx link + block */}
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span className="text-muted-foreground/60">#{burn.blockNumber.toLocaleString()}</span>
                      <a
                        href={`https://etherscan.io/tx/${burn.ethTxHash}`}
                        target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-0.5 hover-glow transition-all font-mono"
                      >
                        {shortenAddress(burn.ethTxHash, 6)}<ExternalLink size={8} />
                      </a>
                    </div>

                    {/* OCT recipient */}
                    <div className="text-[10px] text-muted-foreground/60 font-mono truncate">
                      → {shortenAddress(burn.octraRecipient, 8)}
                    </div>

                    {/* Timestamp */}
                    <div className="text-[9px] text-muted-foreground/50">
                      {new Date(burn.timestamp).toLocaleString()}
                    </div>

                    <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
                      <Clock size={8} />OCT unlocked by relayer
                    </div>
                  </div>
                ))
              )}
            </div>

          </div>
        )}
      </motion.div>
    </div>
  )
}
