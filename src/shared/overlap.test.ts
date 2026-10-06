import { describe, expect, it } from 'vitest'
import { overlaps } from './overlap'

describe('overlaps', () => {
  it('pairs every worktree with the others that changed the same files', () => {
    const result = overlaps({
      a: ['src/api.ts', 'README.md'],
      b: ['src/api.ts', 'README.md', 'src/db.ts'],
      c: ['src/db.ts'],
      d: ['docs/x.md']
    })

    expect(result).toEqual({
      a: [{ other: 'b', kind: 'same', files: ['src/api.ts', 'README.md'] }],
      b: [
        { other: 'a', kind: 'same', files: ['src/api.ts', 'README.md'] },
        { other: 'c', kind: 'same', files: ['src/db.ts'] }
      ],
      c: [{ other: 'b', kind: 'same', files: ['src/db.ts'] }]
    })
  })

  it('finds nothing when no files are shared', () => {
    expect(overlaps({ a: ['x'], b: ['y'], c: [] })).toEqual({})
  })

  it('links a worktree using code another changed, from both sides', () => {
    const deps = { 'src/ui.ts': ['src/api.ts'], 'src/api.ts': ['src/db.ts'] }
    const result = overlaps({ api: ['src/api.ts'], ui: ['src/ui.ts'], docs: ['x.md'] }, deps)

    expect(result).toEqual({
      api: [{ other: 'ui', kind: 'usedBy', files: ['src/api.ts'] }],
      ui: [{ other: 'api', kind: 'uses', files: ['src/ui.ts'] }]
    })
  })

  it('reports only the same-file overlap when a pair has both', () => {
    const deps = { 'src/ui.ts': ['src/api.ts'] }
    const result = overlaps({ a: ['src/api.ts'], b: ['src/api.ts', 'src/ui.ts'] }, deps)

    expect(result.a).toEqual([{ other: 'b', kind: 'same', files: ['src/api.ts'] }])
    expect(result.b).toEqual([{ other: 'a', kind: 'same', files: ['src/api.ts'] }])
  })
})
