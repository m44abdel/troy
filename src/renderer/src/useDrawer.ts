import { isNumber, useStored } from './useStored'

export const DRAWER_HEIGHT = { initial: 220, min: 80, max: 800 }

const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean'

/** Whether the terminal drawer is open, and how tall; shared by every window. */
export function useDrawer(): {
  open: boolean
  setOpen: React.Dispatch<React.SetStateAction<boolean>>
  height: number
  setHeight: (height: number) => void
} {
  const [open, setOpen] = useStored('troy.drawerOpen', false, isBoolean)
  const [height, setStoredHeight] = useStored('troy.drawerHeight', DRAWER_HEIGHT.initial, isNumber)
  const setHeight = (h: number): void =>
    setStoredHeight(Math.min(DRAWER_HEIGHT.max, Math.max(DRAWER_HEIGHT.min, h)))
  return { open, setOpen, height, setHeight }
}
