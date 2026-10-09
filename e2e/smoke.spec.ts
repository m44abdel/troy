import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'
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

// TROY_E2E_APP=/path/to/Troy.app/Contents/MacOS/Troy runs the suite against a packaged build.
function launchTroy(env: Record<string, string | undefined>): Promise<ElectronApplication> {
  const packaged = process.env.TROY_E2E_APP
  return packaged
    ? electron.launch({ executablePath: packaged, env })
    : electron.launch({ args: ['.'], env })
}

/** A ZDOTDIR whose login profile puts `bin` first on PATH, ahead of Homebrew's tools. */
function zdotdirWith(bin: string): string {
  const zdotdir = tempDir('troy-zdotdir-')
  writeFileSync(join(zdotdir, '.zprofile'), `export PATH='${bin}':$PATH\n`)
  return zdotdir
}

// A gh that always fails, so no test reaches the developer's real GitHub account.
const noGitHub = tempDir('troy-nogh-')
writeFileSync(join(noGitHub, 'gh'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })

// This ZDOTDIR keeps the developer's own zsh config (prompts, auto-attach) out of the test.
const shellEnv = { ...process.env, SHELL: '/bin/zsh', ZDOTDIR: zdotdirWith(noGitHub) }

test('opens a saved repo in a working terminal', async () => {
  const repo = gitRepo('troy-repo-')
  const userData = tempDir('troy-profile-')
  writeFileSync(join(userData, 'state.json'), JSON.stringify({ repos: [repo] }))

  const app = await launchTroy({ ...shellEnv, TROY_USER_DATA: userData })
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
  const app = await launchTroy({ ...shellEnv, TROY_USER_DATA: tempDir('troy-profile-') })
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

// Starts the agent in each worktree by selecting it and pressing Enter in its agent pane.
async function startAgents(page: Page, paths: string[]): Promise<void> {
  for (const path of paths) {
    const card = page.locator(`.worktree[title="${path}"]`)
    await card.locator('.card-select').click()
    await expect(card).toHaveClass(/selected/)
    await page.locator('.workspace:visible .pane-agent .xterm').click()
    await page.keyboard.press('Enter')
    await expect(card.locator('.status-label')).not.toHaveText('not started')
  }
}

const catAgents = (paths: string[]): object =>
  Object.fromEntries(paths.map((path, i) => [path, { agent: 'cat', port: 3100 + 100 * i }]))

test('Cmd shortcuts switch worktrees while Ctrl chords reach the shell', async () => {
  const repos = [gitRepo('troy-a-'), gitRepo('troy-b-')]
  const userData = tempDir('troy-profile-')
  writeFileSync(join(userData, 'state.json'), JSON.stringify({ repos }))

  const app = await launchTroy({ ...shellEnv, TROY_USER_DATA: userData })
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

  const app = await launchTroy({ ...shellEnv, TROY_USER_DATA: userData })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.worktree.selected')).toContainText('main')

    await chord(app, 'N', 'meta')
    await page.getByLabel('Branch', { exact: true }).fill('feat/e2e')
    await page.getByLabel('Agent', { exact: true }).fill('echo agent-port-$PORT_BASE')
    await page.getByLabel('Initial prompt').fill('Fix the login bug\nand add a test')
    await page.getByRole('button', { name: 'Create' }).click()

    const row = page.locator('.worktree.selected')
    await expect(row.locator('.card-title')).toHaveText('Fix the login bug')
    await expect(row.locator('.card-head')).toContainText('feat/e2e')
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
    await expect(row.locator('.status-label')).toHaveText('finished')

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

  const app = await launchTroy({ ...shellEnv, TROY_USER_DATA: userData })
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

  const app = await launchTroy({
    ...shellEnv,
    TROY_USER_DATA: userData,
    CLAUDE_CONFIG_DIR: claudeHome
  })
  try {
    const page = await app.firstWindow()
    const ring = page.locator('.worktree.selected .ctx-ring')
    const tip = page.getByRole('tooltip')
    // A real hover: the card's full-size select layer must not swallow it.
    await ring.hover()
    await expect(tip).toContainText('75% of context used')
    await expect(tip).toContainText('150k of 200k tokens')
    await expect(tip).toContainText('claude-sonnet-5-5')
    await expect(ring).not.toHaveClass(/warn/)
    await page.mouse.move(0, 0)
    await expect(tip).toHaveCount(0)

    appendFileSync(log, turn(170_000))
    await expect(ring).toHaveClass(/warn/, { timeout: 10_000 })
    await ring.hover()
    await expect(tip).toContainText('85% of context used')
    await expect(tip).toContainText('/compact')
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

  const app = await launchTroy({ ...shellEnv, TROY_USER_DATA: userData })
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

  const app = await launchTroy({ ...shellEnv, TROY_USER_DATA: userData })
  try {
    const page = await app.firstWindow()
    const selected = page.locator('.worktree.selected')
    const selectedButton = selected.locator('.card-select')
    await expect(selected).toHaveAttribute('title', repos[0])

    // Off by default: j does nothing in the sidebar.
    await selectedButton.focus()
    await expect(selectedButton).toBeFocused()
    await page.keyboard.press('j')
    await expect(selected).toHaveAttribute('title', repos[0])

    await chord(app, ',', 'meta')
    await page.getByLabel('Vim navigation').check()
    await page.getByRole('button', { name: 'Done' }).click()
    expect(JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))).toEqual({ vim: true })

    await selectedButton.focus()
    await expect(selectedButton).toBeFocused()
    await page.keyboard.press('j')
    await expect(selected).toHaveAttribute('title', repos[1])
    await expect(selectedButton).toBeFocused()
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

test('renders the docs tab with Mermaid diagrams and follows relative links', async () => {
  const repo = gitRepo('troy-docs-')
  mkdirSync(join(repo, 'docs'))
  writeFileSync(
    join(repo, 'README.md'),
    [
      '# Project',
      '',
      'See [the guide](docs/guide.md).',
      '',
      '| a | b |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      '```mermaid',
      'graph LR',
      '  Agent --> Worktree',
      '```',
      ''
    ].join('\n')
  )
  writeFileSync(join(repo, 'docs', 'guide.md'), '# Guide\n\nHello from the guide.\n')
  const userData = tempDir('troy-profile-')
  writeFileSync(join(userData, 'state.json'), JSON.stringify({ repos: [repo] }))

  const app = await launchTroy({ ...shellEnv, TROY_USER_DATA: userData })
  try {
    const page = await app.firstWindow()
    const workspace = page.locator('.workspace:visible')
    await workspace.getByRole('button', { name: 'Docs' }).click()
    const docs = workspace.locator('.docs-pane')

    await expect(docs.locator('select')).toHaveValue('README.md')
    await expect(docs.getByRole('heading', { name: 'Project' })).toBeVisible()
    await expect(docs.locator('td')).toHaveText(['1', '2'])
    await expect(docs.locator('.mermaid svg')).toBeVisible({ timeout: 10_000 })
    await expect(docs.locator('.mermaid svg')).toContainText('Worktree')

    await docs.getByRole('link', { name: 'the guide' }).click()
    await expect(docs.locator('select')).toHaveValue('docs/guide.md')
    await expect(docs).toContainText('Hello from the guide.')
  } finally {
    await app.close()
  }
})

test('a session that starts waiting while you are elsewhere is highlighted until cleared', async () => {
  const repos = [gitRepo('troy-c1-'), gitRepo('troy-c2-')]
  const userData = tempDir('troy-profile-')
  const meta = { agent: 'cat', port: 3100 }
  writeFileSync(
    join(userData, 'state.json'),
    JSON.stringify({ repos, worktrees: { [repos[0]]: meta, [repos[1]]: { ...meta, port: 3200 } } })
  )

  const app = await launchTroy({ ...shellEnv, TROY_USER_DATA: userData })
  try {
    const page = await app.firstWindow()
    const first = page.locator(`.worktree[title="${repos[0]}"]`)
    await expect(first.locator('.status-label')).toHaveText('not started')

    // Start the agent, then look away before it goes quiet.
    await page.locator('.workspace:visible .pane-agent .xterm').click()
    await page.keyboard.press('Enter')
    await expect(first.locator('.status-label')).toHaveText('working')
    await chord(app, '2', 'meta')

    await expect(first.locator('.status-label')).toHaveText('waiting', { timeout: 10_000 })
    await expect(first).toHaveClass(/needs-you/)
    await page.getByRole('button', { name: 'Clear all waiting' }).click()
    await expect(first).not.toHaveClass(/needs-you/)
    await expect(first.locator('.status-label')).toHaveText('waiting')
    await expect(page.getByRole('button', { name: 'Clear all waiting' })).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('a hook report beats the output guess and badges the dock', async () => {
  const repos = [gitRepo('troy-h1-'), gitRepo('troy-h2-')]
  const userData = tempDir('troy-profile-')
  const script = join(tempDir('troy-agent-'), 'agent.sh')
  const meta = { agent: `sh ${script}`, port: 3100 }
  writeFileSync(
    join(userData, 'state.json'),
    JSON.stringify({ repos, worktrees: { [repos[0]]: meta, [repos[1]]: { ...meta, port: 3200 } } })
  )

  const app = await launchTroy({ ...shellEnv, TROY_USER_DATA: userData })
  try {
    const page = await app.firstWindow()
    const first = page.locator(`.worktree[title="${repos[0]}"]`)
    await expect(first.locator('.status-label')).toHaveText('not started')

    // The agent runs Troy's real Stop hook, then keeps printing, which alone would read as working.
    const hooks = JSON.parse(readFileSync(join(userData, 'claude-hooks.json'), 'utf8'))
    const stop: string = hooks.hooks.Stop[0].hooks[0].command
    writeFileSync(script, `sleep 1\n${stop}\nwhile true; do echo tick; sleep 0.5; done\n`)

    await page.locator('.workspace:visible .pane-agent .xterm').click()
    await page.keyboard.press('Enter')
    await chord(app, '2', 'meta')

    await expect(first.locator('.status-label')).toHaveText('waiting', { timeout: 10_000 })
    await expect(first).toHaveClass(/needs-you/)
    await expect.poll(() => app.evaluate(({ app }) => app.getBadgeCount())).toBe(1)

    await chord(app, '1', 'meta')
    await expect(first).not.toHaveClass(/needs-you/)
    await expect(first.locator('.status-label')).toHaveText('waiting')
    await expect.poll(() => app.evaluate(({ app }) => app.getBadgeCount())).toBe(0)
  } finally {
    await app.close()
  }
})

test('flags two live sessions editing the same files, and only while both are live', async () => {
  const repo = gitRepo('troy-overlap-')
  const git = (...args: string[]): Buffer =>
    execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args])
  writeFileSync(join(repo, 'api.ts'), 'one\n')
  writeFileSync(join(repo, 'db.ts'), 'one\n')
  git('add', '.')
  git('commit', '-qm', 'init')
  git('worktree', 'add', '-q', '-b', 'feat-a', `${repo}.feat-a`)
  git('worktree', 'add', '-q', '-b', 'feat-b', `${repo}.feat-b`)
  writeFileSync(join(`${repo}.feat-a`, 'api.ts'), 'a\n')
  writeFileSync(join(`${repo}.feat-b`, 'api.ts'), 'b\n')
  writeFileSync(join(`${repo}.feat-b`, 'db.ts'), 'b\n')
  const userData = tempDir('troy-profile-')
  const [a, b] = [`${repo}.feat-a`, `${repo}.feat-b`]
  writeFileSync(
    join(userData, 'state.json'),
    JSON.stringify({ repos: [repo], worktrees: catAgents([a, b]) })
  )

  const app = await launchTroy({ ...shellEnv, TROY_USER_DATA: userData })
  try {
    const page = await app.firstWindow()
    const card = (branch: string): Locator => page.locator(`.worktree[title="${repo}.${branch}"]`)
    await expect(page.locator('.worktree')).toHaveCount(3)

    // Edits by sessions that aren't running are history, not a clash.
    await expect(page.locator('.card-overlap')).toHaveCount(0)
    await startAgents(page, [a])
    await expect(page.locator('.card-overlap')).toHaveCount(0)

    await startAgents(page, [b])
    await expect(card('feat-a').locator('.card-overlap')).toHaveText('⚠ 1 file shared with feat-b')
    await expect(card('feat-a').locator('.card-overlap')).toHaveAttribute(
      'title',
      'api.ts\n\nClick to see these changes'
    )
    await expect(card('feat-b').locator('.card-overlap')).toHaveText('⚠ 1 file shared with feat-a')
    await expect(page.locator(`.worktree[title="${repo}"] .card-overlap`)).toHaveCount(0)

    // Clicking the line opens that worktree's diff narrowed to the shared files.
    await card('feat-b').locator('.card-overlap').click()
    const workspace = page.locator('.workspace:visible')
    await expect(page.locator('.worktree.selected')).toHaveAttribute('title', `${repo}.feat-b`)
    await expect(workspace.locator('.filter-bar')).toContainText('1 file shared with feat-a')
    await expect(workspace.locator('.diff-file h3')).toHaveText(['api.ts'])
    await workspace.getByRole('button', { name: 'Show all' }).click()
    await expect(workspace.locator('.diff-file h3')).toHaveText(['api.ts', 'db.ts'])
    await expect(workspace.locator('.filter-bar')).toHaveCount(0)

    // Once one of them closes, the other is no longer in a clash.
    page.on('dialog', (d) => void d.accept())
    await card('feat-a').hover()
    await card('feat-a')
      .getByRole('button', { name: /^Close session/ })
      .click()
    await expect(page.locator('.card-overlap')).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('runs .troy/check when the agent stops and sends a failure back to it', async () => {
  const repo = gitRepo('troy-check-')
  const git = (...args: string[]): Buffer =>
    execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args])
  mkdirSync(join(repo, '.troy'))
  writeFileSync(
    join(repo, '.troy', 'check'),
    'grep -q fixed a.txt || { echo "a.txt is not fixed"; exit 1; }\n'
  )
  writeFileSync(join(repo, 'a.txt'), 'broken\n')
  git('add', '.')
  git('commit', '-qm', 'init')
  const userData = tempDir('troy-profile-')
  const script = join(tempDir('troy-agent-'), 'agent.sh')
  writeFileSync(
    join(userData, 'state.json'),
    JSON.stringify({ repos: [repo], worktrees: { [repo]: { agent: `sh ${script}`, port: 3100 } } })
  )

  const app = await launchTroy({ ...shellEnv, TROY_USER_DATA: userData })
  try {
    const page = await app.firstWindow()
    const card = page.locator('.worktree.selected')
    const hooks = JSON.parse(readFileSync(join(userData, 'claude-hooks.json'), 'utf8'))
    writeFileSync(script, `${hooks.hooks.Stop[0].hooks[0].command}\nwhile true; do sleep 1; done\n`)

    const workspace = page.locator('.workspace:visible')
    await workspace.locator('.pane-agent .xterm').click()
    await page.keyboard.press('Enter')
    await expect(card.locator('.card-check')).toHaveText('✗ check', { timeout: 10_000 })

    await chord(app, 'D', 'meta')
    const bar = workspace.locator('.check-bar')
    await expect(bar.locator('.check-label')).toHaveText('✗ .troy/check failed')
    await bar.locator('summary').click()
    await expect(bar.locator('pre')).toHaveText('a.txt is not fixed')
    await bar.getByRole('button', { name: 'Send failure to agent' }).click()
    await expect(workspace.locator('.pane-agent .xterm-rows')).toContainText(
      '.troy/check failed. Fix it'
    )

    writeFileSync(join(repo, 'a.txt'), 'fixed\n')
    await bar.getByRole('button', { name: 'Run again' }).click()
    await expect(bar.locator('.check-label')).toHaveText('✓ .troy/check passed')
    await expect(card.locator('.card-check')).toHaveText('✓ check')
  } finally {
    await app.close()
  }
})

test('links worktrees through the code graph when one uses code another changed', async () => {
  const repo = gitRepo('troy-graph-')
  const git = (...args: string[]): Buffer =>
    execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args])
  writeFileSync(join(repo, 'api.ts'), 'export const get = 1\n')
  writeFileSync(join(repo, 'ui.ts'), "import { get } from './api'\n")
  git('add', '.')
  git('commit', '-qm', 'init')
  git('worktree', 'add', '-q', '-b', 'api-work', `${repo}.api-work`)
  git('worktree', 'add', '-q', '-b', 'ui-work', `${repo}.ui-work`)
  writeFileSync(join(`${repo}.api-work`, 'api.ts'), 'export const get = 2\n')
  writeFileSync(join(`${repo}.ui-work`, 'ui.ts'), "import { get } from './api'\nget\n")

  // A stand-in for graphify: `graphify extract <repo> --code-only --out <dir>` writes the graph.
  const bin = tempDir('troy-bin-')
  const graph = {
    nodes: [
      { id: 'ui', source_file: 'ui.ts' },
      { id: 'api', source_file: 'api.ts' }
    ],
    links: [{ source: 'ui', target: 'api', relation: 'imports_from' }]
  }
  writeFileSync(
    join(bin, 'graphify'),
    `#!/bin/sh\nmkdir -p "$5/graphify-out"\necho '${JSON.stringify(graph)}' > "$5/graphify-out/graph.json"\n`,
    { mode: 0o755 }
  )
  const userData = tempDir('troy-profile-')
  const worktrees = [`${repo}.api-work`, `${repo}.ui-work`]
  writeFileSync(
    join(userData, 'state.json'),
    JSON.stringify({ repos: [repo], worktrees: catAgents(worktrees) })
  )

  const app = await launchTroy({
    ...shellEnv,
    PATH: `${bin}:${process.env.PATH}`,
    TROY_USER_DATA: userData
  })
  try {
    const page = await app.firstWindow()
    const card = (branch: string): Locator => page.locator(`.worktree[title="${repo}.${branch}"]`)
    await expect(page.locator('.worktree')).toHaveCount(3)
    await startAgents(page, worktrees)
    await expect(card('ui-work').locator('.card-overlap')).toHaveText(
      '↳ 1 file uses changes in api-work'
    )
    await expect(card('api-work').locator('.card-overlap')).toHaveText('↳ 1 file used by ui-work')
  } finally {
    await app.close()
  }
})

test('closing a worktree hides it until reopened, and folds and closes survive a restart', async () => {
  const repo = gitRepo('troy-fold-')
  execFileSync('git', [
    '-C',
    repo,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'init'
  ])
  execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', '-b', 'side', `${repo}.side`])
  const other = gitRepo('troy-fold2-')
  const userData = tempDir('troy-profile-')
  writeFileSync(
    join(userData, 'state.json'),
    JSON.stringify({ repos: [repo, other], worktrees: { [repo]: { agent: 'cat', port: 3100 } } })
  )
  const env = { ...shellEnv, TROY_USER_DATA: userData }

  let app = await launchTroy(env)
  try {
    const page = await app.firstWindow()
    const first = page.locator(`.worktree[title="${repo}"]`)

    // A working agent asks first; closing removes the card and stops the agent.
    await page.locator('.workspace:visible .pane-agent .xterm').click()
    await page.keyboard.press('Enter')
    await expect(first.locator('.status-label')).toHaveText('working')
    const asked = new Promise<string>((resolve) =>
      page.once('dialog', (d) => {
        resolve(d.message())
        void d.accept()
      })
    )
    await first.hover()
    await first.getByRole('button', { name: /^Close session/ }).click()
    expect(await asked).toContain('still working')
    await expect(first).toHaveCount(0)
    await expect(page.locator('.worktree.selected')).toHaveAttribute('title', `${repo}.side`)
    await expect(page.locator('.closed-toggle')).toHaveText('1 closed')

    await page.locator('.repo-toggle').nth(1).click()
    await expect(page.locator(`.worktree[title="${other}"]`)).toHaveCount(0)
  } finally {
    await app.close()
  }

  // Both the close and the fold are remembered.
  app = await launchTroy(env)
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.worktree')).toHaveCount(1)
    await expect(page.locator(`.worktree[title="${repo}.side"]`)).toHaveCount(1)
    await expect(page.locator('.repo-toggle').nth(1)).toHaveAttribute('aria-expanded', 'false')

    // Reopening brings the card back with a fresh agent pane.
    await page.locator('.closed-toggle').click()
    await page.locator('.closed-item').click()
    await expect(page.locator('.worktree.selected')).toHaveAttribute('title', repo)
    await expect(page.locator('.closed-toggle')).toHaveCount(0)
    await expect(page.locator('.workspace:visible .pane-agent .xterm-rows')).toContainText(
      'Press Enter to start'
    )

    // Selecting a worktree in a folded repo unfolds it.
    await chord(app, '3', 'meta')
    await expect(page.locator('.worktree.selected')).toHaveAttribute('title', other)
    await expect(page.locator('.repo-toggle').nth(1)).toHaveAttribute('aria-expanded', 'true')
  } finally {
    await app.close()
  }
})

test('reorders worktrees by drag and by Cmd-arrow, and keeps the order', async () => {
  const repo = gitRepo('troy-order-')
  const git = (...args: string[]): Buffer =>
    execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args])
  git('commit', '-q', '--allow-empty', '-m', 'init')
  git('worktree', 'add', '-q', '-b', 'a', `${repo}.a`)
  git('worktree', 'add', '-q', '-b', 'b', `${repo}.b`)
  const userData = tempDir('troy-profile-')
  writeFileSync(join(userData, 'state.json'), JSON.stringify({ repos: [repo] }))
  const env = { ...shellEnv, TROY_USER_DATA: userData }
  const titles = (page: Page): Promise<string[]> =>
    page.locator('.worktree').evaluateAll((cards) => cards.map((c) => c.getAttribute('title')!))

  let app = await launchTroy(env)
  try {
    const page = await app.firstWindow()
    await expect.poll(() => titles(page)).toEqual([repo, `${repo}.a`, `${repo}.b`])

    await page
      .locator(`.worktree[title="${repo}.b"]`)
      .dragTo(page.locator(`.worktree[title="${repo}"]`))
    await expect.poll(() => titles(page)).toEqual([`${repo}.b`, repo, `${repo}.a`])

    // ⌘↓ moves the selected worktree, and ⌘1–9 follow the new order.
    await chord(app, '1', 'meta')
    await expect(page.locator('.worktree.selected')).toHaveAttribute('title', `${repo}.b`)
    await chord(app, 'Down', 'meta')
    await expect.poll(() => titles(page)).toEqual([repo, `${repo}.b`, `${repo}.a`])
  } finally {
    await app.close()
  }

  app = await launchTroy(env)
  try {
    await expect
      .poll(async () => titles(await app.firstWindow()))
      .toEqual([repo, `${repo}.b`, `${repo}.a`])
  } finally {
    await app.close()
  }
})

test('agents and shells do not inherit the Claude Code session Troy was opened from', async () => {
  const repo = gitRepo('troy-env-')
  const userData = tempDir('troy-profile-')
  writeFileSync(join(userData, 'state.json'), JSON.stringify({ repos: [repo] }))

  const app = await launchTroy({
    ...shellEnv,
    TROY_USER_DATA: userData,
    CLAUDECODE: '1',
    CLAUDE_CODE_CHILD_SESSION: '1',
    CLAUDE_CODE_NO_FLICKER: '1'
  })
  try {
    const page = await app.firstWindow()
    const shell = page.locator('.workspace:visible .pane-shell')
    await shell.locator('.xterm').click()
    await page.keyboard.type(
      'echo "child=[${CLAUDE_CODE_CHILD_SESSION}${CLAUDECODE}] flicker=[${CLAUDE_CODE_NO_FLICKER}]"'
    )
    await page.keyboard.press('Enter')
    await expect(shell.locator('.xterm-rows')).toContainText('child=[] flicker=[1]', {
      timeout: 15_000
    })
  } finally {
    await app.close()
  }
})

test('measures emoji as two columns, as agent TUIs do', async () => {
  const repo = gitRepo('troy-width-')
  const userData = tempDir('troy-profile-')
  writeFileSync(join(userData, 'state.json'), JSON.stringify({ repos: [repo] }))

  const app = await launchTroy({ ...shellEnv, TROY_USER_DATA: userData })
  try {
    const page = await app.firstWindow()
    const shell = page.locator('.workspace:visible .pane-shell')
    await shell.locator('.xterm').click()
    // ✅ then "move to column 3": with Unicode 11 widths the x lands right after the emoji.
    await page.keyboard.type("printf 'width:\\xe2\\x9c\\x85\\033[9Gx|\\n'")
    await page.keyboard.press('Enter')
    await expect(shell.locator('.xterm-rows')).toContainText('width:✅x|', { timeout: 15_000 })
  } finally {
    await app.close()
  }
})

test('resizes the sidebar and the agent pane by dragging, and remembers the sizes', async () => {
  const repo = gitRepo('troy-resize-')
  const userData = tempDir('troy-profile-')
  writeFileSync(join(userData, 'state.json'), JSON.stringify({ repos: [repo] }))
  const env = { ...shellEnv, TROY_USER_DATA: userData }
  const width = (page: Page, selector: string): Promise<number> =>
    page.locator(selector).evaluate((el) => Math.round(el.getBoundingClientRect().width))
  const drag = async (page: Page, name: string, toX: number): Promise<void> => {
    const box = (await page.getByRole('separator', { name }).boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(toX, box.y + box.height / 2, { steps: 5 })
    await page.mouse.up()
  }

  let app = await launchTroy(env)
  let agentBefore = 0
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.workspace:visible')).toBeVisible()
    await drag(page, 'Resize sidebar', 360)
    await expect.poll(() => width(page, '.sidebar')).toBe(360)

    agentBefore = await width(page, '.workspace:visible .pane-agent')
    const column = (await page.locator('.workspace:visible .column').boundingBox())!
    await drag(page, 'Resize agent and side panel', column.x + column.width / 2)
    await expect
      .poll(() => width(page, '.workspace:visible .pane-agent'))
      .toBeGreaterThan(agentBefore)
  } finally {
    await app.close()
  }

  app = await launchTroy(env)
  try {
    const page = await app.firstWindow()
    await expect.poll(() => width(page, '.sidebar')).toBe(360)
    await expect
      .poll(() => width(page, '.workspace:visible .pane-agent'))
      .toBeGreaterThan(agentBefore)
    await page.getByRole('separator', { name: 'Resize sidebar' }).dblclick()
    await expect.poll(() => width(page, '.sidebar')).toBe(272)
  } finally {
    await app.close()
  }
})

test('an agent with an earlier conversation in its worktree resumes it', async () => {
  const repo = gitRepo('troy-resume-')
  const fresh = gitRepo('troy-fresh-')
  const claudeHome = tempDir('troy-claude-')
  // Claude Code keeps a folder's conversations under projects/<path with dashes>.
  const project = join(claudeHome, 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'))
  mkdirSync(project, { recursive: true })
  writeFileSync(join(project, 'earlier.jsonl'), '{}\n')
  const bin = tempDir('troy-bin-')
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\necho "claude-args:[$1]"\n', { mode: 0o755 })
  const userData = tempDir('troy-profile-')
  const meta = { agent: 'claude', port: 3100 }
  writeFileSync(
    join(userData, 'state.json'),
    JSON.stringify({
      repos: [repo, fresh],
      worktrees: { [repo]: meta, [fresh]: { ...meta, port: 3200 } }
    })
  )

  const app = await launchTroy({
    ...shellEnv,
    PATH: `${bin}:${process.env.PATH}`,
    CLAUDE_CONFIG_DIR: claudeHome,
    TROY_USER_DATA: userData
  })
  try {
    const page = await app.firstWindow()
    const agent = page.locator('.workspace:visible .pane-agent')
    await expect(agent.locator('.xterm-rows')).toContainText('Press Enter to resume claude')
    await agent.locator('.xterm').click()
    await page.keyboard.press('Enter')
    await expect(agent.locator('.xterm-rows')).toContainText('claude-args:[--continue]', {
      timeout: 15_000
    })

    await chord(app, '2', 'meta')
    await expect(agent.locator('.xterm-rows')).toContainText('Press Enter to start claude')
    await agent.locator('.xterm').click()
    await page.keyboard.press('Enter')
    await expect(agent.locator('.xterm-rows')).toContainText('claude-args:[--settings]', {
      timeout: 15_000
    })
  } finally {
    await app.close()
  }
})

// Talks to Troy's MCP server the way an agent would, from inside a worktree.
function callMcp(cwd: string, mailDir: string, tool: string, args: object): string {
  const lines = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'e2e' } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: args } }
  ]
  return execFileSync(process.execPath, [join(__dirname, '..', 'out', 'main', 'mcp-server.js')], {
    cwd,
    env: { ...process.env, TROY_MAIL_DIR: mailDir },
    input: lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
  }).toString()
}

test('an agent messages another, now if it runs and otherwise once it starts', async () => {
  const repo = gitRepo('troy-mail-')
  const git = (...args: string[]): Buffer =>
    execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args])
  git('commit', '-q', '--allow-empty', '-m', 'init')
  git('worktree', 'add', '-q', '-b', 'b', `${repo}.b`)
  git('worktree', 'add', '-q', '-b', 'c', `${repo}.c`)
  const userData = tempDir('troy-profile-')
  const meta = (port: number): object => ({ agent: 'cat', port })
  writeFileSync(
    join(userData, 'state.json'),
    JSON.stringify({
      repos: [repo],
      worktrees: { [repo]: meta(3100), [`${repo}.b`]: meta(3200), [`${repo}.c`]: meta(3300) }
    })
  )
  const mail = join(userData, 'mail')

  const app = await launchTroy({ ...shellEnv, TROY_USER_DATA: userData })
  try {
    const page = await app.firstWindow()
    const agent = page.locator('.workspace:visible .pane-agent')
    await expect(page.locator('.worktree')).toHaveCount(3)
    await chord(app, '2', 'meta')
    await expect(page.locator('.worktree.selected')).toHaveAttribute('title', `${repo}.b`)
    await agent.locator('.xterm').click()
    await page.keyboard.press('Enter')
    await expect(page.locator(`.worktree[title="${repo}.b"] .status-label`)).toHaveText(
      /working|waiting/
    )

    expect(
      callMcp(repo, mail, 'agent_message', { to: 'b', text: 'I am changing api.ts' })
    ).toContain('Sent to b')
    await expect(agent.locator('.xterm-rows')).toContainText(
      '[Troy] Message from the agent in main'
    )
    await expect(agent.locator('.xterm-rows')).toContainText('I am changing api.ts')

    // c's agent isn't running: the message waits on its card, then arrives when it starts.
    callMcp(repo, mail, 'agent_message', { to: 'c', text: 'hold off on api.ts' })
    const c = page.locator(`.worktree[title="${repo}.c"]`)
    await expect(c.locator('.card-mail')).toHaveText('✉ 1 message waiting for this agent')
    await chord(app, '3', 'meta')
    await expect(page.locator('.worktree.selected')).toHaveAttribute('title', `${repo}.c`)
    await agent.locator('.xterm').click()
    await page.keyboard.press('Enter')
    await expect(agent.locator('.xterm-rows')).toContainText('hold off on api.ts')
    await expect(c.locator('.card-mail')).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('proposes knowledge from a finished session through a forked, read-only agent', async () => {
  const repo = gitRepo('troy-harvest-')
  execFileSync('git', [
    '-C',
    repo,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'init'
  ])
  const claudeHome = tempDir('troy-claude-')
  const project = join(claudeHome, 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'))
  mkdirSync(project, { recursive: true })
  writeFileSync(join(project, 'earlier.jsonl'), '{}\n')
  const bin = tempDir('troy-bin-')
  const argsFile = join(bin, 'args.txt')
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\nprintf '%s\\n' "$@" > '${argsFile}'\n`, {
    mode: 0o755
  })
  const userData = tempDir('troy-profile-')
  writeFileSync(
    join(userData, 'state.json'),
    JSON.stringify({ repos: [repo], worktrees: { [repo]: { agent: 'claude', port: 3100 } } })
  )

  const app = await launchTroy({
    ...shellEnv,
    PATH: `${bin}:${process.env.PATH}`,
    CLAUDE_CONFIG_DIR: claudeHome,
    TROY_USER_DATA: userData
  })
  try {
    const page = await app.firstWindow()
    const workspace = page.locator('.workspace:visible')
    await workspace.getByRole('button', { name: /^Knowledge/ }).click()
    await workspace.getByRole('button', { name: 'Propose facts from this session' }).click()
    await expect(workspace.locator('.knowledge-pane .notice')).toHaveText(
      'The agent found nothing new worth proposing.'
    )
    const args = readFileSync(argsFile, 'utf8').split('\n')
    expect(args.slice(0, 3)).toEqual(['--continue', '--fork-session', '--print'])
    expect(args).toContain('mcp__troy__knowledge_propose')
  } finally {
    await app.close()
  }
})

test('reviews a requested PR in its own window and submits the review to GitHub', async () => {
  // A clone whose origin names github.com/acme/widgets but fetches from a local bare repo.
  const root = tempDir('troy-pr-')
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
  git('commit', '-qam', 'two')
  const head = git('rev-parse', 'HEAD')
  const diff = git('diff', 'HEAD~1', 'HEAD')
  git('push', '-q', 'origin', 'HEAD:refs/pull/7/head')
  git('reset', '-q', '--hard', 'HEAD~1')

  // A fake gh, put first on the login shell's PATH, that records the review it is sent.
  const bin = join(root, 'bin')
  const posted = join(root, 'posted.json')
  mkdirSync(bin)
  writeFileSync(join(root, 'diff.txt'), diff + '\n')
  writeFileSync(
    join(bin, 'gh'),
    `#!/bin/sh
case "$1 $2" in
  "search prs") echo '[{"number":7,"title":"Add two","url":"https://github.com/acme/widgets/pull/7","updatedAt":"2026-10-07T00:00:00Z","repository":{"nameWithOwner":"acme/widgets"},"author":{"login":"sam"}}]' ;;
  "pr diff") cat '${join(root, 'diff.txt')}' ;;
  "pr view") echo '{"title":"Add two","body":"Adds a line.","url":"https://github.com/acme/widgets/pull/7","author":{"login":"sam"},"baseRefName":"main"}' ;;
  "api --method") while [ "$1" != "--input" ]; do shift; done; cp "$2" '${posted}' ;;
esac
`,
    { mode: 0o755 }
  )
  const userData = tempDir('troy-profile-')
  writeFileSync(join(userData, 'state.json'), JSON.stringify({ repos: [repo] }))

  const app = await launchTroy({ ...shellEnv, ZDOTDIR: zdotdirWith(bin), TROY_USER_DATA: userData })
  try {
    const page = await app.firstWindow()
    const pr = page.locator('.reviews .pr')
    await expect(pr).toContainText('Add two')
    await expect(pr).toContainText('acme/widgets#7 · @sam')

    const [review] = await Promise.all([app.waitForEvent('window'), pr.click()])
    await expect(review.locator('.review-header')).toContainText('#7 Add two')
    await expect(review.locator('.pane-agent .xterm-rows')).toContainText('Press Enter to start')
    const checkout = join(userData, 'reviews', 'widgets-7')
    expect(readFileSync(join(checkout, 'a.txt'), 'utf8')).toBe('one\ntwo\n')
    // The checkout belongs to the review window, not the main window's sidebar.
    await expect(page.locator('.worktree')).toHaveCount(1)

    await review.locator('.diff-gutter-insert').first().click()
    await review.keyboard.type('nice line')
    await review.keyboard.press('Enter')
    await expect(review.locator('.comment')).toContainText('nice line')
    await review.getByPlaceholder('Review summary (optional)').fill('Looks good')

    const closed = review.waitForEvent('close')
    await review.getByRole('button', { name: 'Approve' }).click()
    await closed

    expect(JSON.parse(readFileSync(posted, 'utf8'))).toEqual({
      commit_id: head,
      event: 'APPROVE',
      body: 'Looks good',
      comments: [{ path: 'a.txt', line: 2, side: 'RIGHT', body: 'nice line' }]
    })
    await expect.poll(() => existsSync(checkout)).toBe(false)
  } finally {
    await app.close()
  }
})

test('the board lays worktrees out by agent status and opens the one you pick', async () => {
  const repo = gitRepo('troy-board-')
  const userData = tempDir('troy-profile-')
  writeFileSync(join(userData, 'state.json'), JSON.stringify({ repos: [repo] }))

  const app = await launchTroy({ ...shellEnv, TROY_USER_DATA: userData })
  try {
    const page = await app.firstWindow()
    const board = page.locator('.board')
    await expect(page.getByRole('button', { name: 'Board', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    await expect(page.locator('.workspace:visible')).toBeVisible()

    await chord(app, 'B', 'meta')
    const lane = board.getByRole('region', { name: 'not started' })
    await expect(lane.locator('.card-select')).toBeVisible()

    await lane.locator('.card-select').click()
    await expect(board).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('a terminal drawer under the side column keeps its shell while folded', async () => {
  const repo = gitRepo('troy-drawer-')
  const userData = tempDir('troy-profile-')
  writeFileSync(join(userData, 'state.json'), JSON.stringify({ repos: [repo] }))

  const app = await launchTroy({ ...shellEnv, TROY_USER_DATA: userData })
  try {
    const page = await app.firstWindow()
    const workspace = page.locator('.workspace:visible')
    const agent = workspace.locator('.pane-agent')
    const bar = workspace.getByRole('button', { name: /^Terminal/ })
    const drawer = workspace.locator('.drawer-body')
    await expect(bar).toHaveAttribute('aria-expanded', 'false')
    await expect(drawer).toHaveCount(0)
    const agentBox = await agent.boundingBox()

    await chord(app, 'T', 'meta')
    await expect(bar).toHaveAttribute('aria-expanded', 'true')
    await expect(drawer).toBeVisible()
    await page.keyboard.type('echo drawer-$((40+2))')
    await page.keyboard.press('Enter')
    await expect(drawer.locator('.xterm-rows')).toContainText('drawer-42', { timeout: 15_000 })
    // The drawer takes room from the side column, never from the agent.
    expect(await agent.boundingBox()).toEqual(agentBox)

    await bar.click()
    await expect(drawer).toBeHidden()
    await bar.click()
    await expect(drawer.locator('.xterm-rows')).toContainText('drawer-42')

    // A second tab is its own shell; the first keeps running behind it and dies when closed.
    const panes = drawer.locator('.drawer-pane')
    await workspace.getByRole('button', { name: 'New terminal' }).click()
    await expect(panes).toHaveCount(2)
    await expect(panes.nth(0)).toBeHidden()
    await page.keyboard.type('echo second-$((1+1))')
    await page.keyboard.press('Enter')
    await expect(panes.nth(1).locator('.xterm-rows')).toContainText('second-2', { timeout: 15_000 })
    await workspace.getByRole('button', { name: 'Close terminal 1' }).click()
    await expect(panes).toHaveCount(1)
    await expect(panes.nth(0).locator('.xterm-rows')).toContainText('second-2')
  } finally {
    await app.close()
  }
})
