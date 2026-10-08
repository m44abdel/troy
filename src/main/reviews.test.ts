import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { delimiter, join } from 'path'
import { closeReview, githubSlug, openReview, reviewPayload, submitReview } from './reviews'

const originalPath = process.env.PATH
afterEach(() => {
  process.env.PATH = originalPath
})

describe('githubSlug', () => {
  it.each([
    ['git@github.com:Acme/Widgets.git', 'acme/widgets'],
    ['https://github.com/acme/widgets', 'acme/widgets'],
    ['https://github.com/acme/widgets.git/', 'acme/widgets'],
    ['ssh://git@github.com/acme/widgets.git', 'acme/widgets'],
    ['https://gitlab.com/acme/widgets.git', null],
    ['', null]
  ])('%s → %s', (remote, slug) => {
    expect(githubSlug(remote)).toBe(slug)
  })
})

describe('reviewPayload', () => {
  it('puts removed lines on the left side and the rest on the right', () => {
    const payload = reviewPayload('abc', 'APPROVE', 'LGTM', [
      { file: 'a.ts', changeKey: 'I3', line: 3, removed: false, text: 'nice' },
      { file: 'b.ts', changeKey: 'D7', line: 7, removed: true, text: 'why?' }
    ])

    expect(payload).toEqual({
      commit_id: 'abc',
      event: 'APPROVE',
      body: 'LGTM',
      comments: [
        { path: 'a.ts', line: 3, side: 'RIGHT', body: 'nice' },
        { path: 'b.ts', line: 7, side: 'LEFT', body: 'why?' }
      ]
    })
  })
})

/** A clone whose origin says github.com/acme/widgets but fetches from a local bare repo with PR #7. */
function prRepo(): { root: string; repo: string; head: string; log: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'troy-review-')))
  const remote = join(root, 'remote.git')
  const repo = join(root, 'widgets')
  const git = (...args: string[]): string =>
    execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args])
      .toString()
      .trim()
  execFileSync('git', ['init', '-q', '--bare', remote])
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  writeFileSync(join(repo, 'a.txt'), 'one\n')
  git('add', '.')
  git('commit', '-qm', 'init')
  git('remote', 'add', 'origin', 'https://github.com/acme/widgets.git')
  git('config', `url.${remote}.insteadOf`, 'https://github.com/acme/widgets.git')
  git('push', '-q', 'origin', 'main')
  writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n')
  git('commit', '-qam', 'pr')
  const head = git('rev-parse', 'HEAD')
  git('push', '-q', 'origin', 'HEAD:refs/pull/7/head')
  git('reset', '-q', '--hard', 'HEAD~1')

  // A fake gh that logs its arguments and the review JSON it is given.
  const log = join(root, 'gh.log')
  const bin = join(root, 'bin')
  mkdirSync(bin)
  writeFileSync(
    join(bin, 'gh'),
    `#!/bin/sh
echo "$@" >> "${log}"
case "$1 $2" in
  "pr diff") echo "diff --git a/a.txt b/a.txt" ;;
  "pr view") echo '{"title":"Add two","body":"b","url":"u","author":{"login":"sam"},"baseRefName":"main"}' ;;
  "api --method") while [ "$1" != "--input" ]; do shift; done; cat "$2" >> "${log}" ;;
esac
`
  )
  chmodSync(join(bin, 'gh'), 0o755)
  process.env.PATH = [bin, originalPath].join(delimiter)
  return { root, repo, head, log }
}

describe('a review checkout', () => {
  it('checks out the PR head, posts the review on that commit, then removes itself', async () => {
    const { root, repo, head, log } = prRepo()
    const dir = join(root, 'reviews')

    const { path, diff, meta } = await openReview(dir, repo, 7)

    expect(readFileSync(join(path, 'a.txt'), 'utf8')).toBe('one\ntwo\n')
    expect(diff).toBe('diff --git a/a.txt b/a.txt')
    expect(meta).toMatchObject({ number: 7, slug: 'acme/widgets', title: 'Add two', author: 'sam' })

    await submitReview(dir, repo, 7, 'COMMENT', 'ok', [])

    expect(readFileSync(log, 'utf8')).toContain(`"commit_id":"${head}","event":"COMMENT"`)
    expect(readFileSync(log, 'utf8')).toContain('repos/acme/widgets/pulls/7/reviews')
    expect(existsSync(path)).toBe(false)
  })

  it('reopens an existing checkout, and closing twice is harmless', async () => {
    const { root, repo } = prRepo()
    const dir = join(root, 'reviews')

    const first = await openReview(dir, repo, 7)
    const again = await openReview(dir, repo, 7)
    await closeReview(dir, repo, 7)
    await closeReview(dir, repo, 7)

    expect(again.path).toBe(first.path)
    expect(existsSync(first.path)).toBe(false)
  })
})
