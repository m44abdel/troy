import { describe, expect, it } from 'vitest'
import { routeKey, type KeyInput } from './keys'

const key = (code: string, mods: Partial<KeyInput> = {}): KeyInput => ({
  type: 'keyDown',
  code,
  meta: false,
  control: false,
  alt: false,
  shift: false,
  ...mods
})

describe('routeKey on macOS', () => {
  it('maps Cmd shortcuts to app actions', () => {
    expect(routeKey(key('KeyO', { meta: true }), 'darwin')).toBe('addRepo')
    expect(routeKey(key('BracketLeft', { meta: true }), 'darwin')).toBe('prev')
    expect(routeKey(key('BracketRight', { meta: true }), 'darwin')).toBe('next')
    expect(routeKey(key('Digit3', { meta: true }), 'darwin')).toBe('jump:3')
    expect(routeKey(key('KeyN', { meta: true }), 'darwin')).toBe('newWorktree')
    expect(routeKey(key('KeyW', { meta: true }), 'darwin')).toBe('archive')
    expect(routeKey(key('KeyJ', { meta: true }), 'darwin')).toBe('focusAgent')
    expect(routeKey(key('KeyE', { meta: true }), 'darwin')).toBe('focusShell')
    expect(routeKey(key('Backslash', { meta: true }), 'darwin')).toBe('toggleColumn')
    expect(routeKey(key('KeyD', { meta: true }), 'darwin')).toBe('showDiff')
    expect(routeKey(key('Enter', { meta: true }), 'darwin')).toBe('sendToAgent')
  })

  it.each([
    ['Ctrl-P', key('KeyP', { control: true })],
    ['Ctrl-T', key('KeyT', { control: true })],
    ['Ctrl-O', key('KeyO', { control: true })],
    ['Ctrl-N', key('KeyN', { control: true })],
    ['Ctrl-W', key('KeyW', { control: true })],
    ['Ctrl-D', key('KeyD', { control: true })],
    ['plain Enter', key('Enter')],
    ['Alt-f', key('KeyF', { alt: true })],
    ['plain o', key('KeyO')]
  ])('passes %s through to the terminal', (_name, input) => {
    expect(routeKey(input, 'darwin')).toBeNull()
  })

  it('leaves unbound Cmd keys (copy, paste, quit) to the OS menu', () => {
    expect(routeKey(key('KeyC', { meta: true }), 'darwin')).toBeNull()
    expect(routeKey(key('KeyV', { meta: true }), 'darwin')).toBeNull()
    expect(routeKey(key('KeyQ', { meta: true }), 'darwin')).toBeNull()
  })

  it('ignores Cmd combined with other modifiers and keyUp events', () => {
    expect(routeKey(key('KeyO', { meta: true, shift: true }), 'darwin')).toBeNull()
    expect(routeKey(key('KeyO', { meta: true, control: true }), 'darwin')).toBeNull()
    expect(routeKey({ ...key('KeyO', { meta: true }), type: 'keyUp' }, 'darwin')).toBeNull()
  })
})

describe('routeKey on Linux/Windows', () => {
  it('uses Ctrl+Shift for app actions', () => {
    expect(routeKey(key('KeyO', { control: true, shift: true }), 'linux')).toBe('addRepo')
    expect(routeKey(key('Digit1', { control: true, shift: true }), 'win32')).toBe('jump:1')
  })

  it('passes plain Ctrl through to the terminal', () => {
    expect(routeKey(key('KeyO', { control: true }), 'linux')).toBeNull()
    expect(routeKey(key('KeyP', { control: true }), 'win32')).toBeNull()
  })
})
