export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 50 50"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="logo-circle flex-shrink-0"
    >
      <circle cx="25" cy="25" r="21" stroke="#3B567F" strokeWidth="8" fill="none" />
      <circle cx="25" cy="25" r="9" fill="#3B567F" />
    </svg>
  )
}
