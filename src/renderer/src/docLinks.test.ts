import { describe, expect, it } from 'vitest'
import { resolveDocLink } from './docLinks'

describe('resolveDocLink', () => {
  it('resolves relative and root-relative links against the open file', () => {
    expect(resolveDocLink('docs/guide/setup.md', '../api.md')).toBe('docs/api.md')
    expect(resolveDocLink('docs/guide/setup.md', './a%20b.md#usage')).toBe('docs/guide/a b.md')
    expect(resolveDocLink('docs/guide/setup.md', '/README.md')).toBe('README.md')
    expect(resolveDocLink('README.md', 'CONTRIBUTING.md')).toBe('CONTRIBUTING.md')
  })

  it('leaves external links and anchors alone', () => {
    expect(resolveDocLink('README.md', 'https://example.com/x.md')).toBeNull()
    expect(resolveDocLink('README.md', 'mailto:a@b.c')).toBeNull()
    expect(resolveDocLink('README.md', '#install')).toBeNull()
  })
})
