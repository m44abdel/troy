import { useEffect, useState } from 'react'

// Per-machine view state (folded repos, closed sessions), so browser storage is enough.
// It may be unavailable; the list then just starts empty and isn't remembered.
function load(key: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []
  } catch {
    return []
  }
}

/** A list of strings that survives restarts. */
export function useStoredList(
  key: string
): [string[], React.Dispatch<React.SetStateAction<string[]>>] {
  const [list, setList] = useState(() => load(key))
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(list))
    } catch (err) {
      console.warn(`Could not remember ${key}`, err)
    }
  }, [key, list])
  return [list, setList]
}
