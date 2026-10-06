// App shortcuts live on Cmd (macOS) or Ctrl+Shift (elsewhere) so that every
// Ctrl and Alt chord reaches the terminal untouched.

export type AppAction =
  | 'addRepo'
  | 'newWorktree'
  | 'archive'
  | 'focusAgent'
  | 'focusShell'
  | 'toggleShell'
  | 'prev'
  | 'next'
  | `jump:${number}`

export interface KeyInput {
  type: string
  code: string
  meta: boolean
  control: boolean
  alt: boolean
  shift: boolean
}

const BINDINGS: Record<string, AppAction> = {
  KeyO: 'addRepo',
  KeyN: 'newWorktree',
  KeyW: 'archive',
  KeyJ: 'focusAgent',
  KeyE: 'focusShell',
  Backslash: 'toggleShell',
  BracketLeft: 'prev',
  BracketRight: 'next'
}

function hasAppModifier(input: KeyInput, platform: string): boolean {
  if (platform === 'darwin') {
    return input.meta && !input.control && !input.alt && !input.shift
  }
  return input.control && input.shift && !input.alt && !input.meta
}

export function routeKey(input: KeyInput, platform: string): AppAction | null {
  if (input.type !== 'keyDown' || !hasAppModifier(input, platform)) return null
  const digit = /^Digit([1-9])$/.exec(input.code)
  if (digit) return `jump:${Number(digit[1])}`
  return BINDINGS[input.code] ?? null
}
