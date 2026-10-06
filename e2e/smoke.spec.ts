import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { execFileSync, spawn } from 'child_process'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from 'fs'
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
    expect(readFileSync(join(worktree, 'AGENTS.md'), 'utf8')).toContain('.troy/knowledge.md')
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

test('shows context usage from the Claude Code session log', async () => {
  const repo = gitRepo('troy-ctx-')
  const claudeHome = tempDir('troy-claude-')
  const logDir = join(claudeHome, 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'))
  mkdirSync(logDir, { recursive: true })
  const turn = (cacheRead: number): string =>
    JSON.stringify({
      type: 'assistant',
      message: {
        model: 'claude-sonnet-5-5',
        usage: {
          input_tokens: 0,
          cache_read_input_tokens: cacheRead,
          cache_creation_input_tokens: 0
        }
      }
    }) + '\n'
  const log = join(logDir, 'session.jsonl')
  writeFileSync(log, turn(150_000))
  const userData = tempDir('troy-profile-')
  writeFileSync(
    join(userData, 'state.json'),
    JSON.stringify({ repos: [repo], worktrees: { [repo]: { agent: 'claude', port: 3100 } } })
  )

  const app = await electron.launch({
    args: ['.'],
    env: { ...shellEnv, TROY_USER_DATA: userData, CLAUDE_CONFIG_DIR: claudeHome }
  })
  try {
    const page = await app.firstWindow()
    const ring = page.locator('.worktree.selected .ctx-ring')
    await expect(ring.locator('title')).toHaveText(
      '75% of context used (150k / 200k)\nclaude-sonnet-5-5'
    )
    await expect(ring).not.toHaveClass(/warn/)

    appendFileSync(log, turn(170_000))
    await expect(ring).toHaveClass(/warn/, { timeout: 10_000 })
    await expect(ring.locator('title')).toContainText('85% of context used')
    await expect(ring.locator('title')).toContainText('/compact')
  } finally {
    await app.close()
  }
})

/** Talks to the MCP server the way an agent would: spawned from Troy's config, over stdio. */
async function mcpSession(userData: string, cwd: string, messages: object[]): Promise<string[]> {
  const { command, args, env } = JSON.parse(readFileSync(join(userData, 'mcp.json'), 'utf8'))
    .mcpServers.troy
  const server = spawn(command, args, { cwd, env: { ...process.env, ...env } })
  const replies: string[] = []
  let buffer = ''
  const done = new Promise<void>((resolve, reject) => {
    server.on('error', reject)
    server.stdout.on('data', (chunk) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop()!
      replies.push(...lines)
      if (replies.length >= messages.filter((m) => 'id' in m).length) resolve()
    })
  })
  server.stdin.write(messages.map((m) => JSON.stringify(m)).join('\n') + '\n')
  await done
  server.kill()
  // Replies may arrive in any order; JSON-RPC matches them by id.
  return replies.sort((a, b) => JSON.parse(a).id - JSON.parse(b).id)
}

test('an agent proposes a fact over MCP and the user approves it', async () => {
  const repo = gitRepo('troy-know-')
  writeFileSync(join(repo, 'ports.txt'), 'PORT_BASE=3100\n')
  execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '.'])
  execFileSync('git', [
    '-C',
    repo,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    'commit',
    '-qm',
    'i'
  ])
  const userData = tempDir('troy-profile-')
  writeFileSync(join(userData, 'state.json'), JSON.stringify({ repos: [repo] }))

  const app = await electron.launch({ args: ['.'], env: { ...shellEnv, TROY_USER_DATA: userData } })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.worktree.selected')).toContainText('main')

    const propose = (id: number, source: string): object => ({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name: 'knowledge_propose', arguments: { fact: 'Ports start at 3100.', source } }
    })
    const replies = await mcpSession(userData, repo, [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { clientInfo: { name: 'e2e-agent' } }
      },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      propose(2, 'ports.txt:1'),
      propose(3, 'ports.txt:7')
    ])
    expect(replies[1]).toContain('Queued for review')
    expect(replies[2]).toContain('out of range')

    const workspace = page.locator('.workspace:visible')
    const tab = workspace.locator('.tab', { hasText: 'Knowledge' })
    await expect(tab).toContainText('Knowledge · 1', { timeout: 10_000 })
    await tab.click()
    const pane = workspace.locator('.knowledge-pane')
    await expect(pane.locator('.proposal')).toContainText('ports.txt:1 · ')
    await expect(pane.locator('.proposal')).toContainText('e2e-agent')

    await pane.getByRole('button', { name: 'Approve' }).click()
    await expect(pane.locator('.proposal')).toHaveCount(0)
    await expect(pane.locator('.fact')).toContainText('Ports start at 3100.')
    await expect(tab).toHaveText('Knowledge')
    expect(readFileSync(join(repo, '.troy', 'knowledge.md'), 'utf8')).toContain(
      '- Ports start at 3100.\n  Source: `ports.txt:1`'
    )
  } finally {
    await app.close()
  }
})

test('vim keys move through the sidebar only when enabled, and keybindings.json remaps', async () => {
  const repos = [gitRepo('troy-v1-'), gitRepo('troy-v2-')]
  const userData = tempDir('troy-profile-')
  writeFileSync(join(userData, 'state.json'), JSON.stringify({ repos }))
  // Free Cmd-N and put "new worktree" on Cmd-K instead.
  writeFileSync(
    join(userData, 'keybindings.json'),
    JSON.stringify({ KeyN: null, KeyK: 'newWorktree' })
  )

  const app = await electron.launch({ args: ['.'], env: { ...shellEnv, TROY_USER_DATA: userData } })
  try {
    const page = await app.firstWindow()
    const selected = page.locator('.worktree.selected')
    await expect(selected).toHaveAttribute('title', repos[0])

    // Off by default: j does nothing in the sidebar.
    await selected.focus()
    await page.keyboard.press('j')
    await expect(selected).toHaveAttribute('title', repos[0])

    await chord(app, ',', 'meta')
    await page.getByLabel('Vim navigation').check()
    await page.getByRole('button', { name: 'Done' }).click()
    expect(JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))).toEqual({ vim: true })

    await selected.focus()
    await page.keyboard.press('j')
    await expect(selected).toHaveAttribute('title', repos[1])
    await expect(selected).toBeFocused()
    await page.keyboard.press('g')
    await page.keyboard.press('g')
    await expect(selected).toHaveAttribute('title', repos[0])

    // Enter hands focus to the agent pane; from then on j is plain typing.
    await page.keyboard.press('Enter')
    await page.keyboard.press('j')
    await expect(selected).toHaveAttribute('title', repos[0])

    await chord(app, 'N', 'meta')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await chord(app, 'K', 'meta')
    await expect(page.getByRole('heading', { name: /New worktree/ })).toBeVisible()
  } finally {
    await app.close()
  }
})
