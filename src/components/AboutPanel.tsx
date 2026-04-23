import { motion } from 'framer-motion'
import { ExternalLink } from 'lucide-react'
import { OCTRA_BRIDGE_CONTRACT, WOCT_CONTRACT_ADDRESS, WOCT_TOKEN_ADDRESS } from '@/lib/constants'

const pageVariants = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } },
}

function InfoRow({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="flex items-start justify-between py-2 border-b border-dashed border-border last:border-0 text-xs gap-4">
      <span className="text-muted-foreground flex-shrink-0">{label}</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-right break-all hover-glow transition-all flex items-center gap-1"
        >
          {value}
          <ExternalLink size={9} className="flex-shrink-0" />
        </a>
      ) : (
        <span className="font-mono text-right break-all">{value}</span>
      )}
    </div>
  )
}

export function AboutPanel() {
  return (
    <div className="w-full h-full flex items-center justify-center p-6">
      <motion.div
        variants={pageVariants}
        initial="initial"
        animate="animate"
        className="w-full max-w-2xl"
      >
        <h2 className="text-sm font-medium mb-1">About OCT Bridge</h2>
        <p className="text-xs text-muted-foreground mb-5">
          The OCT Bridge connects native OCT on Octra with wOCT on Ethereum using a 1:1 lock/mint model.
          No liquidity pools. No swaps. Pure bridging.
        </p>

        <div className="mb-5">
          <h3 className="text-xs font-medium mb-2 text-muted-foreground uppercase tracking-wider">Contracts</h3>
          <div className="border border-border p-3">
            <InfoRow
              label="Octra Bridge"
              value={OCTRA_BRIDGE_CONTRACT}
            />
            <InfoRow
              label="ETH Bridge (verifyAndMint)"
              value={WOCT_CONTRACT_ADDRESS}
              href={`https://etherscan.io/address/${WOCT_CONTRACT_ADDRESS}`}
            />
            <InfoRow
              label="wOCT Token"
              value={WOCT_TOKEN_ADDRESS}
              href={`https://etherscan.io/token/${WOCT_TOKEN_ADDRESS}`}
            />
          </div>
        </div>

        <div className="mb-5">
          <h3 className="text-xs font-medium mb-2 text-muted-foreground uppercase tracking-wider">OCT → wOCT Flow</h3>
          <ol className="space-y-1 text-xs text-muted-foreground list-none">
            {[
              'Call lock_to_eth on Octra bridge contract',
              'Wait for epoch confirmation (~1 min)',
              'Bridge header submitted to Ethereum',
              'Call verifyAndMint on Ethereum contract',
              'wOCT minted to recipient',
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-primary flex-shrink-0">{i + 1}.</span>
                {step}
              </li>
            ))}
          </ol>
        </div>

        <div className="mb-5">
          <h3 className="text-xs font-medium mb-2 text-muted-foreground uppercase tracking-wider">wOCT → OCT Flow</h3>
          <ol className="space-y-1 text-xs text-muted-foreground list-none">
            {[
              'Approve wOCT spend on Ethereum',
              'Burn wOCT (transfer to zero address)',
              'Bridge processes the burn event',
              'OCT unlocked on Octra via unlock_trusted',
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-primary flex-shrink-0">{i + 1}.</span>
                {step}
              </li>
            ))}
          </ol>
        </div>

        <div className="border border-dashed border-border p-3 text-xs text-muted-foreground">
          <p>Bridge fee: <span className="text-foreground">0 (free)</span></p>
          <p>Denomination: <span className="text-foreground">1 OCT = 1 wOCT = 1,000,000 raw units</span></p>
          <p>Est. time: <span className="text-foreground">~2 minutes</span></p>
        </div>
      </motion.div>
    </div>
  )
}
