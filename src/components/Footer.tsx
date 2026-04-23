export function Footer() {
  return (
    <footer
      className="app-footer flex items-center justify-between px-4 border-t border-border bg-background text-[10px] text-muted-foreground"
      style={{ height: 'var(--footer-height)' }}
    >
      <span>OCT Bridge · Octra ↔ Ethereum</span>
      <span>
        wOCT:{' '}
        <a
          href="https://etherscan.io/token/0x4647e1fe715c9e23959022c2416c71867f5a6e80"
          target="_blank"
          rel="noopener noreferrer"
          className="hover-glow transition-all"
        >
          0x4647…a6e80
        </a>
      </span>
    </footer>
  )
}
