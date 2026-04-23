import { ArrowRightLeft, History, Info, Settings } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

export type SidebarPage = 'bridge' | 'history' | 'about' | 'settings'

interface SidebarProps {
  open: boolean
  onToggle: () => void
  activePage: SidebarPage
  onNavigate: (page: SidebarPage) => void
}

const MENU_ITEMS: { id: SidebarPage; label: string; icon: React.ReactNode }[] = [
  { id: 'bridge', label: 'Bridge', icon: <ArrowRightLeft size={15} /> },
  { id: 'history', label: 'History', icon: <History size={15} /> },
  { id: 'about', label: 'About', icon: <Info size={15} /> },
  { id: 'settings', label: 'Settings', icon: <Settings size={15} /> },
]

export function Sidebar({ open, onToggle, activePage, onNavigate }: SidebarProps) {
  return (
    <div className="relative flex h-full">
      {/* Sidebar panel */}
      <motion.aside
        animate={{ width: open ? 210 : 48 }}
        transition={{ duration: 0.2, ease: 'easeInOut' }}
        className="app-sidebar h-full border-r border-border bg-background overflow-hidden flex-shrink-0"
        style={{ width: open ? 210 : 48 }}
      >
        <nav className="flex flex-col gap-0.5 pt-3 px-1">
          {MENU_ITEMS.map(item => {
            const isActive = activePage === item.id
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={cn(
                  'flex items-center gap-3 px-2 py-2 text-xs w-full text-left transition-all',
                  isActive
                    ? 'text-primary border-l-2 border-primary pl-[6px]'
                    : 'text-muted-foreground hover:[filter:drop-shadow(0_0_4px_currentColor)_drop-shadow(0_0_8px_currentColor)]'
                )}
              >
                <span className="flex-shrink-0">{item.icon}</span>
                {open && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="whitespace-nowrap overflow-hidden"
                  >
                    {item.label}
                  </motion.span>
                )}
              </button>
            )
          })}
        </nav>
      </motion.aside>

      {/* Toggle button - outside sidebar */}
      <button
        onClick={onToggle}
        className="absolute -right-[17px] top-4 z-10 w-[17px] h-8 border border-border bg-background text-[10px] text-muted-foreground flex items-center justify-center hover:opacity-80 transition-opacity"
        aria-label={open ? 'Collapse sidebar' : 'Expand sidebar'}
      >
        {open ? '‹' : '›'}
      </button>
    </div>
  )
}
