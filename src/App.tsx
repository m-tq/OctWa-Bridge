import { useState } from 'react'
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

const pageVariants = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } },
  exit: { opacity: 0, y: -12, transition: { duration: 0.25, ease: 'easeIn' } },
}

function AppContent() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [activePage, setActivePage] = useState<SidebarPage>('bridge')

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
