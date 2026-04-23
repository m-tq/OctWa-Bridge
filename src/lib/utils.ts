import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function shortenAddress(addr: string, chars = 6): string {
  if (!addr) return ''
  return `${addr.slice(0, chars)}...${addr.slice(-4)}`
}

export function formatAmount(raw: number | string, decimals = 6): string {
  const n = typeof raw === 'string' ? parseFloat(raw) : raw
  if (isNaN(n)) return '0'
  return (n / Math.pow(10, decimals)).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  })
}

export function toRawUnits(amount: string, decimals = 6): bigint {
  const n = parseFloat(amount)
  if (isNaN(n) || n <= 0) return 0n
  return BigInt(Math.round(n * Math.pow(10, decimals)))
}

export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
