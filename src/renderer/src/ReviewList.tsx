import { useEffect, useState } from 'react'
import type { PullRequest } from '../../shared/types'
import { Icon } from './icons'

const POLL_MS = 5 * 60_000

/** PRs waiting on your review. Hidden when gh is missing or signed out. */
export function ReviewList(): React.JSX.Element | null {
  const [prs, setPrs] = useState<PullRequest[]>([])

  useEffect(() => {
    const refresh = (): void =>
      void window.api.reviews().then(({ prs, error }) => {
        if (error) console.warn('Could not list review requests:', error)
        setPrs(prs ?? [])
      })
    refresh()
    const timer = setInterval(refresh, POLL_MS)
    window.addEventListener('focus', refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  if (!prs.length) return null
  return (
    <section className="reviews">
      <div className="reviews-header">
        <Icon name="pr" size={13} />
        <span className="repo-name">Reviews</span>
        <span className="count">{prs.length}</span>
      </div>
      {prs.map((pr) => (
        <button
          key={pr.url}
          className="pr"
          disabled={!pr.repo}
          title={pr.repo ? pr.url : `Add your clone of ${pr.slug} to Troy to review it here`}
          onClick={() => pr.repo && void window.api.openReviewWindow(pr.repo, pr.number)}
        >
          <span className="pr-title">{pr.title}</span>
          <span className="pr-meta">
            {pr.slug}#{pr.number} · @{pr.author}
          </span>
        </button>
      ))}
    </section>
  )
}
