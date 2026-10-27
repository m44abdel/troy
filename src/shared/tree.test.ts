import { describe, expect, it } from 'vitest'
import { buildTree } from './tree'

describe('buildTree', () => {
  it('nests files under their folders, folders first, by name', () => {
    const tree = buildTree(['src/b.ts', 'README.md', 'src/a/x.ts', 'Makefile'], [])
    expect(tree.map((n) => n.name)).toEqual(['src', 'Makefile', 'README.md'])
    expect(tree[0].children.map((n) => n.name)).toEqual(['a', 'b.ts'])
    expect(tree[0].children[0].children[0]).toEqual({
      name: 'x.ts',
      path: 'src/a/x.ts',
      dir: false,
      ignored: false,
      children: []
    })
  })

  it('shows ignored folders and files, marked', () => {
    const tree = buildTree(['a.ts'], ['out/', 'debug.log'])
    expect(tree).toEqual([
      { name: 'out', path: 'out', dir: true, ignored: true, children: [] },
      { name: 'a.ts', path: 'a.ts', dir: false, ignored: false, children: [] },
      { name: 'debug.log', path: 'debug.log', dir: false, ignored: true, children: [] }
    ])
  })
})
