import { useCallback, useEffect, useState } from 'react'
import type { MergeOptions, PrStatus } from '../../shared/types'

// Asks GitHub again this often while the tab is open.
const PR_POLL_MS = 60_000

export interface PrState {
  /** undefined while loading, null when the branch has no PR. */
  pr?: PrStatus | null
  merge?: MergeOptions
  error?: string
}

/** The branch's PR, polled while `watching`. Shared by Source Control and the PR tab. */
export function usePr(path: string, watching: boolean): [PrState, () => void] {
  const [state, setState] = useState<PrState>({})
  const refresh = useCallback(() => void window.api.pr(path).then(setState), [path])
  useEffect(() => {
    if (!watching) return
    refresh()
    const timer = setInterval(refresh, PR_POLL_MS)
    return () => clearInterval(timer)
  }, [watching, refresh])
  return [state, refresh]
}
