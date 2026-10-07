import { useEffect, useState } from 'react'

// Per-machine view state (folded repos, closed sessions, pane sizes), so browser storage is
// enough. It may be unavailable or hold junk; the value then falls back and isn't remembered.
function load<T>(key: string, fallback: T, valid: (v: unknown) => v is T): T {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    return valid(value) ? value : fallback
  } catch {
    return fallback
  }
}

/** State that survives restarts. */
export function useStored<T>(
  key: string,
  fallback: T,
  valid: (v: unknown) => v is T
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState(() => load(key, fallback, valid))
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch (err) {
      console.warn(`Could not remember ${key}`, err)
    }
  }, [key, value])
  return [value, setValue]
}

export const isStringList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string')

export const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
