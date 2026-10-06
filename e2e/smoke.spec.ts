import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

function tempDir(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)))
}

function gitRepo(prefix: string): string {
  const repo = tempDir(prefix)
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  return repo
}

// Empty ZDOTDIR keeps the developer's own zsh config (prompts, auto-attach) out of the test.
const shellEnv = { ...process.env, SHELL: '/bin/zsh', ZDOTDIR: tempDir('troy-zdotdir-') }

test('opens a saved repo in a working terminal', async () => {
  const repo = gitRepo('troy-repo-')
  const userData = tempDir('troy-profile-')
  writeFileSync(join(userData, 'state.json'), JSON.stringify({ repos: [repo] }))

  const app = await electron.launch({
    args: ['.'],
    env: { ...shellEnv, TROY_USER_DATA: userData }
  })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.repo-header')).toContainText(repo.split('/').pop()!)
    await expect(page.locator('.worktree.selected')).toContainText('main')

    const shell = page.locator('.workspace:visible .pane-shell')
    await shell.locator('.xterm').click()
    await page.keyboard.type('echo troy-$((40+2))')
    await page.keyboard.press('Enter')
    await expect(shell.locator('.xterm-rows')).toContainText('troy-42', { timeout: 15_000 })
  } finally {
    await app.close()
  }
})

test('shows the welcome screen with no repos', async () => {
  const app = await electron.launch({
    args: ['.'],
    env: { ...shellEnv, TROY_USER_DATA: tempDir('troy-profile-') }
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { name: 'Welcome to Troy' })).toBeVisible()
  } finally {
    await app.close()
  }
})

// Playwright's keyboard bypasses before-input-event, so chords go through
// sendInputEvent, which takes the same path as a real keypress.
function chord(
  app: ElectronApplication,
  keyCode: string,
  modifier: 'meta' | 'control'
): Promise<void> {
  return app.evaluate(
    ({ BrowserWindow }, [k, m]) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents
      wc.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: [m] })
      wc.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: [m] })
    },
    [keyCode, modifier] as const
  )
}

test('Cmd shortcuts switch worktrees while Ctrl chords reach the shell', async () => {
  const repos = [gitRepo('troy-a-'), gitRepo('troy-b-')]
  const userData = tempDir('troy-profile-')
  writeFileSync(join(userData, 'state.json'), JSON.stringify({ repos }))

  const app = await electron.launch({ args: ['.'], env: { ...shellEnv, TROY_USER_DATA: userData } })
  try {
    const page = await app.firstWindow()
    const shell = page.locator('.workspace:visible .pane-shell')
    const visibleRows = shell.locator('.xterm-rows')

    await shell.locator('.xterm').click()
    // Ctrl-U clears the typed line in zsh; if the app swallowed it, "junk" would run.
    await page.keyboard.type('junk')
    await chord(app, 'U', 'control')
    await page.keyboard.type('echo ctrl-ok')
    await page.keyboard.press('Enter')
    await expect(visibleRows).toContainText('ctrl-ok')
    await expect(visibleRows).not.toContainText('command not found: junk')

    await chord(app, '2', 'meta')
    await expect(page.locator('.worktree.selected')).toHaveAttribute('title', repos[1])
  } finally {
    await app.close()
  }
})

test('creates a bootstrapped worktree, runs its agent and archives it', async () => {
  const repo = gitRepo('troy-wt-')
  const git = (...args: string[]): Buffer =>
    execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args])
  mkdirSync(join(repo, '.troy'))
  writeFileSync(join(repo, '.troy', 'setup.sh'), 'touch setup-ran\n')
  writeFileSync(join(repo, '.gitignore'), '.env\nsetup-ran\n')
  git('add', '.')
  git('commit', '-qm', 'init')
  writeFileSync(join(repo, '.env'), 'SECRET=1\n')
  const userData = tempDir('troy-profile-')
  writeFileSync(join(userData, 'state.json'), JSON.stringify({ repos: [repo] }))
  const worktree = `${repo}.feat-e2e`

  const app = await electron.launch({ args: ['.'], env: { ...shellEnv, TROY_USER_DATA: userData } })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.worktree.selected')).toContainText('main')

    await chord(app, 'N', 'meta')
    await page.getByLabel('Branch', { exact: true }).fill('feat/e2e')
    await page.getByLabel('Agent').fill('echo agent-port-$PORT_BASE')
    await page.getByRole('button', { name: 'Create' }).click()

    const row = page.locator('.worktree.selected')
    await expect(row).toContainText('feat/e2e')
    expect(existsSync(join(worktree, '.env'))).toBe(true)
    await expect.poll(() => existsSync(join(worktree, 'setup-ran')), { timeout: 15_000 }).toBe(true)

    // The agent waits for Enter, runs once with this worktree's port, and exits cleanly.
    const agent = page.locator('.workspace:visible .pane-agent')
    await expect(agent.locator('.xterm-rows')).toContainText('Press Enter to start')
    await agent.locator('.xterm').click()
    await page.keyboard.press('Enter')
    await expect(agent.locator('.xterm-rows')).toContainText('agent-port-3100', { timeout: 15_000 })
    await expect(row.locator('.dot')).toHaveClass(/done/)

    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as never
    })
    await chord(app, 'W', 'meta')
    await expect(page.locator('.worktree')).toHaveCount(1)
    await expect(page.locator('.sidebar .error')).toHaveCount(0)
    expect(existsSync(worktree)).toBe(false)
    expect(git('branch', '--list', 'feat/e2e').toString()).toBe('')
  } finally {
    await app.close()
  }
})

test('reviews the diff, sends comments to the agent and commits', async () => {
  const repo = gitRepo('troy-diff-')
  const git = (...args: string[]): string =>
    execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args])
      .toString()
      .trim()
  writeFileSync(join(repo, 'a.txt'), 'one\n')
  git('add', '.')
  git('commit', '-qm', 'init')
  git('config', 'user.name', 't')
  git('config', 'user.email', 't@t')
  writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n')
  writeFileSync(join(repo, 'new.txt'), 'fresh\n')
  const userData = tempDir('troy-profile-')
  writeFileSync(
    join(userData, 'state.json'),
    JSON.stringify({ repos: [repo], worktrees: { [repo]: { agent: 'cat', port: 3100 } } })
  )

  const app = await electron.launch({ args: ['.'], env: { ...shellEnv, TROY_USER_DATA: userData } })
  try {
    const page = await app.firstWindow()
    const workspace = page.locator('.workspace:visible')
    const agentRows = workspace.locator('.pane-agent .xterm-rows')

    await workspace.locator('.pane-agent .xterm').click()
    await page.keyboard.press('Enter')
    await expect(page.locator('.worktree.selected .dot')).toHaveClass(/running|waiting/)

    await chord(app, 'D', 'meta')
    const diff = workspace.locator('.pane-diff')
    await expect(diff.locator('.diff-file h3')).toHaveText(['a.txt', 'new.txt'])

    await diff.locator('.diff-file').first().locator('.diff-gutter-insert').first().click()
    await page.keyboard.type('rename this')
    await page.keyboard.press('Enter')
    await expect(diff.locator('.comment')).toContainText('rename this')
    await expect(workspace.locator('.tab.active')).toContainText('Diff · 1')

    await chord(app, 'Enter', 'meta')
    await expect(agentRows).toContainText('a.txt:2: rename this')
    await expect(diff.locator('.comment')).toHaveCount(0)

    await diff.getByPlaceholder('Commit message').fill('add two')
    await diff.getByRole('button', { name: 'Commit all' }).click()
    await expect(diff.locator('.notice')).toHaveText('Committed.')
    await expect(diff.getByText('No changes yet.')).toBeVisible()
    expect(git('log', '-1', '--format=%s')).toBe('add two')
    expect(git('status', '--porcelain')).toBe('')
  } finally {
    await app.close()
  }
})
