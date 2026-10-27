import { describe, expect, it } from 'vitest'
import { resolveDocLink } from './docLinks'

describe('resolveDocLink', () => {
  it('resolves against the open file', () => {
    expect(resolveDocLink('docs/guide/setup.md', '../api.md')).toBe('docs/api.md')
    expect(resolveDocLink('docs/guide/setup.md', './a%20b.md#usage')).toBe('docs/guide/a b.md')
    expect(resolveDocLink('docs/guide/setup.md', '/README.md')).toBe('README.md')
    expect(resolveDocLink('README.md', 'CONTRIBUTING.md')).toBe('CONTRIBUTING.md')
  })

  it('external links and bare anchors', () => {
    expect(resolveDocLink('README.md', 'https://example.com/x.md')).toBeNull()
    expect(resolveDocLink('README.md', 'mailto:a@b.c')).toBeNull()
    expect(resolveDocLink('README.md', '#install')).toBeNull()
  })
})
