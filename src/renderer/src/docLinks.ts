/**
 * The repo file a relative link in `from` points to, or null for external links
 * (http:, mailto:, …) and in-page anchors.
 */
export function resolveDocLink(from: string, href: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) return null
  const path = href.split('#')[0]
  const parts = path.startsWith('/') ? [] : from.split('/').slice(0, -1)
  for (const segment of path.split('/')) {
    if (segment === '..') parts.pop()
    else if (segment && segment !== '.') parts.push(decodeURIComponent(segment))
  }
  return parts.join('/')
}
