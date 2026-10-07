import type { ContextUsage } from '../../shared/types'

export const CONTEXT_WARN_PERCENT = 80

export const contextPercent = (u: ContextUsage): number =>
  Math.min(100, Math.round((u.used / u.window) * 100))

export const formatTokens = (n: number): string =>
  n >= 1_000_000
    ? `${+(n / 1_000_000).toFixed(1)}M`
    : n >= 1000
      ? `${Math.round(n / 1000)}k`
      : String(n)
