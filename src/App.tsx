import { useState, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Toaster } from 'sonner'
import { ThemeProvider } from './components/ThemeProvider'
import { Header } from './components/Header'
import { Sidebar, type SidebarPage } from './components/Sidebar'
import { Footer } from './components/Footer'
import { BridgePanel } from './components/BridgePanel'
import { HistoryPanel } from './components/HistoryPanel'
import { AboutPanel } from './components/AboutPanel'
import { useWallets } from './hooks/useWallets'
import { isBridgePaused } from './lib/octra-rpc'
import { PauseCircle, AlertTriangle, FlaskConical } from 'lucide-react'

const DISCLAIMER_KEY = 'bridge_disclaimer_accepted'

const pageVariants = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } },
  exit: { opacity: 0, y: -12, transition: { duration: 0.25, ease: 'easeIn' } },
}

function DisclaimerModal({ onAccept }: { onAccept: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="w-full max-w-sm border border-border bg-background p-6 flex flex-col gap-5"
      >
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex-shrink-0">
            <FlaskConical className="h-5 w-5 text-yellow-500" />
          </div>
          <div>
            <h2 className="text-sm font-semibold leading-tight">Bridge — Experimental</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">Please read before proceeding</p>
          </div>
        </div>

        {/* Warning icon row */}
        <div className="flex justify-center">
          <AlertTriangle className="h-10 w-10 text-yellow-500 opacity-80" />
        </div>

        {/* Disclaimer items */}
        <ul className="flex flex-col gap-2.5 text-xs text-muted-foreground">
          <li className="flex items-start gap-2">
            <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-yellow-500 flex-shrink-0" />
            <span>
              This bridge is <span className="text-foreground font-medium">experimental software</span>.
              Use it entirely at your own risk.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-yellow-500 flex-shrink-0" />
            <span>
              Always start with a <span className="text-foreground font-medium">small test amount</span> before
              bridging larger sums.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-yellow-500 flex-shrink-0" />
            <span>
              The developers are <span className="text-foreground font-medium">not responsible</span> for
              any loss of funds resulting from the use of this bridge.
            </span>
          </li>
        </ul>

        {/* Accept button */}
        <button
          onClick={onAccept}
          className="w-full py-2.5 bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
        >
          I Understand — Continue
        </button>
      </motion.div>
    </div>
  )
}

function AppContent() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [activePage, setActivePage] = useState<SidebarPage>('bridge')
  const [bridgeStatus, setBridgeStatus] = useState<'checking' | 'open' | 'paused'>('checking')
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(
    () => sessionStorage.getItem(DISCLAIMER_KEY) === '1'
  )

  // Check bridge pause status on mount
  useEffect(() => {
    isBridgePaused().then(paused => {
      setBridgeStatus(paused ? 'paused' : 'open')
    })
  }, [])

  const handleAcceptDisclaimer = () => {
    sessionStorage.setItem(DISCLAIMER_KEY, '1')
    setDisclaimerAccepted(true)
  }

  const {
    octraAddress,
    evmAddress,
    ethSigner,
    octBalance,
    ethBalance,
    woctBalance,
    connected,
    loading,
    balanceLoading,
    connect,
    disconnect,
    refreshBalances,
  } = useWallets()

  // Fullscreen pause notice
  if (bridgeStatus === 'paused') {
    return (
      <div className="app-layout">
        <Header
          connected={connected}
          loading={loading}
          octraAddress={octraAddress}
          evmAddress={evmAddress}
          onConnect={connect}
          onDisconnect={disconnect}
        />
        <main className="app-main flex items-center justify-center" style={{ gridColumn: '1 / -1' }}>
          <div className="flex flex-col items-center gap-4 text-center max-w-sm px-6">
            <PauseCircle className="h-16 w-16 text-yellow-500 opacity-80" />
            <h2 className="text-xl font-semibold">Bridge Paused</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              The OCT ↔ wOCT bridge is temporarily paused for maintenance.
              Please check back later.
            </p>
            <button
              onClick={() => isBridgePaused().then(p => setBridgeStatus(p ? 'paused' : 'open'))}
              className="mt-2 px-4 py-2 text-xs border border-border rounded hover:bg-muted transition-colors"
            >
              Check Again
            </button>
          </div>
        </main>
        <Footer />
        <Toaster position="bottom-right" theme="dark" />
      </div>
    )
  }

  // Loading state while checking
  if (bridgeStatus === 'checking') {
    return (
      <div className="app-layout">
        <Header
          connected={connected}
          loading={loading}
          octraAddress={octraAddress}
          evmAddress={evmAddress}
          onConnect={connect}
          onDisconnect={disconnect}
        />
        <main className="app-main flex items-center justify-center" style={{ gridColumn: '1 / -1' }}>
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <div className="h-6 w-6 rounded-full border-2 border-transparent animate-spin" style={{ borderTopColor: 'currentColor' }} />
            <span className="text-sm">Checking bridge status...</span>
          </div>
        </main>
        <Footer />
        <Toaster position="bottom-right" theme="dark" />
      </div>
    )
  }

  return (
    <div className="app-layout">
      {/* Disclaimer modal — shown once per session after bridge is confirmed open */}
      {!disclaimerAccepted && (
        <DisclaimerModal onAccept={handleAcceptDisclaimer} />
      )}

      <Header
        connected={connected}
        loading={loading}
        octraAddress={octraAddress}
        evmAddress={evmAddress}
        onConnect={connect}
        onDisconnect={disconnect}
      />

      <div className="relative" style={{ gridColumn: 1, gridRow: 2 }}>
        <Sidebar
          open={sidebarOpen}
          onToggle={() => setSidebarOpen(o => !o)}
          activePage={activePage}
          onNavigate={setActivePage}
        />
      </div>

      <main className="app-main overflow-hidden">
        <AnimatePresence mode="wait">
          {activePage === 'bridge' && (
            <motion.div key="bridge" variants={pageVariants} initial="initial" animate="animate" exit="exit" className="w-full h-full">
              <BridgePanel
                octraAddress={octraAddress}
                evmAddress={evmAddress}
                ethSigner={ethSigner}
                octBalance={octBalance}
                ethBalance={ethBalance}
                woctBalance={woctBalance}
                balanceLoading={balanceLoading}
                onRefreshBalances={refreshBalances}
                onConnect={connect}
              />
            </motion.div>
          )}
          {activePage === 'history' && (
            <motion.div key="history" variants={pageVariants} initial="initial" animate="animate" exit="exit" className="w-full h-full">
              <HistoryPanel octraAddress={octraAddress} evmAddress={evmAddress} />
            </motion.div>
          )}
          {activePage === 'about' && (
            <motion.div key="about" variants={pageVariants} initial="initial" animate="animate" exit="exit" className="w-full h-full">
              <AboutPanel />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <Footer />
      <Toaster position="bottom-right" theme="dark" />
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  )
}
