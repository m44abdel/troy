import { test, expect, _electron as electron } from '@playwright/test'
import { execFileSync } from 'child_process'
import { mkdtempSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

function tempDir(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)))
}

// Empty ZDOTDIR keeps the developer's own zsh config (prompts, auto-attach) out of the test.
const shellEnv = { ...process.env, SHELL: '/bin/zsh', ZDOTDIR: tempDir('troy-zdotdir-') }

test('opens a saved repo in a working terminal', async () => {
  const repo = tempDir('troy-repo-')
  execFileSync('git', ['init', '-q', repo])
  const userData = tempDir('troy-profile-')
  writeFileSync(join(userData, 'state.json'), JSON.stringify({ repos: [repo] }))

  const app = await electron.launch({
    args: ['.'],
    env: { ...shellEnv, TROY_USER_DATA: userData }
  })
  try {
    const page = await app.firstWindow()
    const repoName = repo.split('/').pop()!
    await expect(page.locator('.repo.selected')).toContainText(repoName)

    await page.locator('.xterm').click()
    await page.keyboard.type('echo troy-$((40+2))')
    await page.keyboard.press('Enter')
    await expect(page.locator('.xterm-rows')).toContainText('troy-42', { timeout: 15_000 })
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

test('Cmd shortcuts switch repos while Ctrl chords reach the shell', async () => {
  const repos = [tempDir('troy-a-'), tempDir('troy-b-')]
  repos.forEach((r) => execFileSync('git', ['init', '-q', r]))
  const userData = tempDir('troy-profile-')
  writeFileSync(join(userData, 'state.json'), JSON.stringify({ repos }))

  const app = await electron.launch({ args: ['.'], env: { ...shellEnv, TROY_USER_DATA: userData } })
  try {
    const page = await app.firstWindow()
    const visibleRows = page.locator('.terminal:visible .xterm-rows')

    // Playwright's keyboard bypasses before-input-event, so chords go through
    // sendInputEvent, which takes the same path as a real keypress.
    const chord = (keyCode: string, modifier: 'meta' | 'control'): Promise<void> =>
      app.evaluate(
        ({ BrowserWindow }, [k, m]) => {
          const wc = BrowserWindow.getAllWindows()[0].webContents
          wc.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: [m] })
          wc.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: [m] })
        },
        [keyCode, modifier] as const
      )

    await page.locator('.terminal:visible .xterm').click()
    // Ctrl-U clears the typed line in zsh; if the app swallowed it, "junk" would run.
    await page.keyboard.type('junk')
    await chord('U', 'control')
    await page.keyboard.type('echo ctrl-ok')
    await page.keyboard.press('Enter')
    await expect(visibleRows).toContainText('ctrl-ok')
    await expect(visibleRows).not.toContainText('command not found: junk')

    await chord('2', 'meta')
    await expect(page.locator('.repo.selected')).toContainText(repos[1].split('/').pop()!)
  } finally {
    await app.close()
  }
})
