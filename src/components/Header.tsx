import { useState } from 'react'
import { Sun, Moon, Wallet, LogOut, Loader2, Copy, CheckCheck } from 'lucide-react'
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

function CopyableAddress({
  label,
  address,
  full,
}: {
  label: string
  address: string
  full: string
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(full)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      onClick={handleCopy}
      title={`Copy ${label} address: ${full}`}
      className="flex items-center gap-1 group text-left"
    >
      <span className="font-mono text-[10px] leading-tight group-hover:text-foreground transition-colors">
        {address}
      </span>
      <span className="opacity-0 group-hover:opacity-100 transition-opacity">
        {copied
          ? <CheckCheck size={9} className="text-[#3B567F]" />
          : <Copy size={9} className="text-muted-foreground" />
        }
      </span>
    </button>
  )
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
          OctWa{' '}
          <span className="text-[#3B567F]">Bridge</span>
          <span className="text-[10px] text-muted-foreground font-normal ml-1.5">
            Experimental
          </span>
        </span>
      </div>

      {/* Center: Nav links */}
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
          href="https://etherscan.io/token/0x4647e1fe715c9e23959022c2416c71867f5a6e80"
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

      {/* Right: Wallet + theme toggle */}
      <div className="flex items-center gap-2">
        {connected && octraAddress ? (
          <div className="flex items-center gap-2">
            {/* Copyable addresses */}
            <div className="hidden sm:flex flex-col items-end gap-0.5">
              <CopyableAddress
                label="Octra"
                address={shortenAddress(octraAddress, 6)}
                full={octraAddress}
              />
              {evmAddress && (
                <CopyableAddress
                  label="EVM"
                  address={shortenAddress(evmAddress, 6)}
                  full={evmAddress}
                />
              )}
            </div>

            {/* Connected badge */}
            <div className="flex items-center gap-1 px-2 py-1.5 border border-[#3B567F]/40 text-[#3B567F] text-xs">
              <Wallet size={11} />
              <span className="hidden sm:inline">Connected</span>
            </div>

            {/* Disconnect */}
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
              'flex items-center gap-1.5 px-3 py-1.5 bg-[#3B567F] text-white text-xs hover:opacity-90 transition-opacity',
              loading && 'opacity-60 cursor-not-allowed'
            )}
          >
            {loading ? <Loader2 size={11} className="animate-spin" /> : <Wallet size={11} />}
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
