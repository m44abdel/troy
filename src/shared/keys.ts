// App shortcuts live on Cmd (macOS) or Ctrl+Shift (elsewhere) so that every
// Ctrl and Alt chord reaches the terminal untouched.

export const ACTIONS = [
  'addRepo',
  'newWorktree',
  'archive',
  'focusAgent',
  'focusShell',
  'showDiff',
  'sendToAgent',
  'toggleColumn',
  'prev',
  'next',
  'openSettings'
] as const

export type AppAction = (typeof ACTIONS)[number] | `jump:${number}`

/** Key code → action. null hands the key to the page and terminal instead. */
export type Bindings = Record<string, AppAction | null>

export interface KeyInput {
  type: string
  code: string
  meta: boolean
  control: boolean
  alt: boolean
  shift: boolean
}

export const DEFAULT_BINDINGS: Bindings = {
  KeyO: 'addRepo',
  KeyN: 'newWorktree',
  KeyW: 'archive',
  KeyJ: 'focusAgent',
  KeyE: 'focusShell',
  KeyD: 'showDiff',
  Enter: 'sendToAgent',
  Backslash: 'toggleColumn',
  BracketLeft: 'prev',
  BracketRight: 'next',
  Comma: 'openSettings'
}

const isAction = (v: unknown): v is AppAction => (ACTIONS as readonly unknown[]).includes(v)

/** Merges a keybindings.json over the defaults, skipping entries it can't use. */
export function parseBindings(raw: unknown): { bindings: Bindings; ignored: string[] } {
  const bindings = { ...DEFAULT_BINDINGS }
  const ignored: string[] = []
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return { bindings, ignored: ['the file must hold a JSON object'] }
  for (const [code, action] of Object.entries(raw)) {
    if (action === null || isAction(action)) bindings[code] = action
    else ignored.push(`${code}: ${JSON.stringify(action)}`)
  }
  return { bindings, ignored }
}

function hasAppModifier(input: KeyInput, platform: string): boolean {
  if (platform === 'darwin') {
    return input.meta && !input.control && !input.alt && !input.shift
  }
  return input.control && input.shift && !input.alt && !input.meta
}

export function routeKey(
  input: KeyInput,
  platform: string,
  bindings: Bindings = DEFAULT_BINDINGS
): AppAction | null {
  if (input.type !== 'keyDown' || !hasAppModifier(input, platform)) return null
  const digit = /^Digit([1-9])$/.exec(input.code)
  if (digit) return `jump:${Number(digit[1])}`
  return bindings[input.code] ?? null
}
