import { useState } from 'react'
import { motion } from 'framer-motion'
import { Save } from 'lucide-react'
import { getOctraRpc, setOctraRpc } from '@/lib/octra-rpc'

const pageVariants = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } },
}

export function SettingsPanel() {
  const [rpc, setRpc] = useState(getOctraRpc())
  const [saved, setSaved] = useState(false)

  const save = () => {
    setOctraRpc(rpc)
    localStorage.setItem('bridge-octra-rpc', rpc)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="w-full h-full flex items-center justify-center p-6">
      <motion.div
        variants={pageVariants}
        initial="initial"
        animate="animate"
        className="w-full max-w-md"
      >
        <h2 className="text-sm font-medium mb-4 pb-2 border-b border-border">Settings</h2>

        <div className="mb-5">
          <label className="text-xs text-muted-foreground block mb-1">Octra RPC Endpoint</label>
          <input
            type="text"
            value={rpc}
            onChange={e => setRpc(e.target.value)}
            className="w-full bg-background border border-input px-3 py-2 text-xs focus:outline-none focus:border-primary transition-colors font-mono"
            placeholder="http://..."
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Default: http://46.101.86.250:8080
          </p>
        </div>

        <button
          onClick={save}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-xs hover:opacity-90 transition-opacity"
        >
          <Save size={12} />
          {saved ? 'Saved!' : 'Save Settings'}
        </button>

        <div className="mt-6 pt-4 border-t border-dashed border-border text-[10px] text-muted-foreground space-y-1">
          <p>Bridge flow: lock_to_eth → contract_receipt → verifyAndMint</p>
          <p>No external API required. All data from Octra RPC.</p>
          <p>siblings=[] leafIndex=0 (constant for all bridge txs)</p>
        </div>
      </motion.div>
    </div>
  )
}
