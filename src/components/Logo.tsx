export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="logo-circle flex-shrink-0"
    >
      <rect width="32" height="32" rx="6" fill="hsl(var(--primary))" />
      <path d="M16 6 L26 16 L16 26 L6 16 Z" fill="none" stroke="white" strokeWidth="1.5" />
      <path d="M16 10 L22 16 L16 22 L10 16 Z" fill="white" opacity="0.9" />
      <path d="M4 16 H9 M23 16 H28" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
