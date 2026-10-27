import { describe, expect, it } from 'vitest'
import { liveOverlaps, overlaps } from './overlap'

describe('overlaps', () => {
  it('same files', () => {
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

  it('nothing shared, nothing reported', () => {
    expect(overlaps({ a: ['x'], b: ['y'], c: [] })).toEqual({})
  })

  it('uses and usedBy through the dependency map', () => {
    const deps = { 'src/ui.ts': ['src/api.ts'], 'src/api.ts': ['src/db.ts'] }
    const result = overlaps({ api: ['src/api.ts'], ui: ['src/ui.ts'], docs: ['x.md'] }, deps)

    expect(result).toEqual({
      api: [{ other: 'ui', kind: 'usedBy', files: ['src/api.ts'] }],
      ui: [{ other: 'api', kind: 'uses', files: ['src/ui.ts'] }]
    })
  })

  it('same-file wins when a pair has both', () => {
    const deps = { 'src/ui.ts': ['src/api.ts'] }
    const result = overlaps({ a: ['src/api.ts'], b: ['src/api.ts', 'src/ui.ts'] }, deps)

    expect(result.a).toEqual([{ other: 'b', kind: 'same', files: ['src/api.ts'] }])
    expect(result.b).toEqual([{ other: 'a', kind: 'same', files: ['src/api.ts'] }])
  })
})

describe('liveOverlaps', () => {
  it('drops a pair once either side stops', () => {
    const all = {
      a: [
        { other: 'b', kind: 'same' as const, files: ['x.ts'] },
        { other: 'c', kind: 'same' as const, files: ['y.ts'] }
      ],
      b: [{ other: 'a', kind: 'same' as const, files: ['x.ts'] }],
      c: [{ other: 'a', kind: 'same' as const, files: ['y.ts'] }]
    }
    const live = (path: string): boolean => path !== 'c'

    expect(liveOverlaps(all, live)).toEqual({
      a: [{ other: 'b', kind: 'same', files: ['x.ts'] }],
      b: [{ other: 'a', kind: 'same', files: ['x.ts'] }]
    })
    expect(liveOverlaps(all, () => false)).toEqual({})
  })
})
