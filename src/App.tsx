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
import { PauseCircle } from 'lucide-react'

const pageVariants = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } },
  exit: { opacity: 0, y: -12, transition: { duration: 0.25, ease: 'easeIn' } },
}

function AppContent() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [activePage, setActivePage] = useState<SidebarPage>('bridge')
  const [bridgeStatus, setBridgeStatus] = useState<'checking' | 'open' | 'paused'>('checking')

  // Check bridge pause status on mount
  useEffect(() => {
    isBridgePaused().then(paused => {
      setBridgeStatus(paused ? 'paused' : 'open')
    })
  }, [])

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
