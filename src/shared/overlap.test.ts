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
      a: [{ other: 'b', files: ['src/api.ts', 'README.md'] }],
      b: [
        { other: 'a', files: ['src/api.ts', 'README.md'] },
        { other: 'c', files: ['src/db.ts'] }
      ],
      c: [{ other: 'b', files: ['src/db.ts'] }]
    })
  })

  it('finds nothing when no files are shared', () => {
    expect(overlaps({ a: ['x'], b: ['y'], c: [] })).toEqual({})
  })
})
