import { Sun, Moon, Wallet, LogOut, Loader2 } from 'lucide-react'
import { useTheme } from './ThemeProvider'
import { Logo } from './Logo'
import { cn, shortenAddress } from '@/lib/utils'

interface HeaderProps {
  connected: boolean
  loading: boolean
  octraAddress?: string
  evmAddress?: string
  onConnect: () => void
  onDisconnect: () => void
}

export function Header({
  connected,
  loading,
  octraAddress,
  evmAddress,
  onConnect,
  onDisconnect,
}: HeaderProps) {
  const { theme, toggleTheme } = useTheme()

  return (
    <header
      className="app-header flex items-center justify-between px-4 border-b border-border bg-background z-50"
      style={{ height: 'var(--header-height)' }}
    >
      {/* Left: Logo + Name */}
      <div className="flex items-center gap-2">
        <Logo size={26} />
        <span className="text-sm font-semibold tracking-tight">
          OctWa <span className="text-primary">Bridge</span>
          <span className="text-[10px] text-muted-foreground font-normal ml-1.5">Experimental</span>
        </span>
      </div>

      {/* Center: Nav */}
      <nav className="hidden md:flex items-center gap-6 text-xs text-muted-foreground">
        <a
          href="https://docs.octra.org/oct-docs/bridging"
          target="_blank"
          rel="noopener noreferrer"
          className="hover-glow transition-all"
        >
          Docs
        </a>
        <a
          href={`https://etherscan.io/token/0x4647e1fe715c9e23959022c2416c71867f5a6e80`}
          target="_blank"
          rel="noopener noreferrer"
          className="hover-glow transition-all"
        >
          wOCT
        </a>
        <a
          href="https://octrascan.io"
          target="_blank"
          rel="noopener noreferrer"
          className="hover-glow transition-all"
        >
          Octrascan
        </a>
      </nav>

      {/* Right: Single wallet + theme toggle */}
      <div className="flex items-center gap-2">
        {connected && octraAddress ? (
          <div className="flex items-center gap-2">
            {/* Wallet info */}
            <div className="hidden sm:flex flex-col items-end text-[10px] leading-tight">
              <span className="text-foreground font-mono">{shortenAddress(octraAddress, 6)}</span>
              {evmAddress && (
                <span className="text-muted-foreground font-mono">{shortenAddress(evmAddress, 6)}</span>
              )}
            </div>
            <div className="flex items-center gap-1 px-2 py-1.5 border border-primary/40 text-primary text-xs">
              <Wallet size={11} />
              <span className="hidden sm:inline">Connected</span>
            </div>
            <button
              onClick={onDisconnect}
              className="p-1.5 hover-glow transition-all text-muted-foreground"
              title="Disconnect"
            >
              <LogOut size={13} />
            </button>
          </div>
        ) : (
          <button
            onClick={onConnect}
            disabled={loading}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-xs hover:opacity-90 transition-opacity',
              loading && 'opacity-60 cursor-not-allowed'
            )}
          >
            {loading ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <Wallet size={11} />
            )}
            {loading ? 'Connecting...' : 'Connect OctWa'}
          </button>
        )}

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="p-1.5 hover-glow transition-all text-muted-foreground"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>
    </header>
  )
}
