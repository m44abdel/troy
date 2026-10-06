import { execFile } from 'child_process'
import { promisify } from 'util'

const LOGIN_SHELL_TIMEOUT_MS = 5000

// Apps launched from Finder get a bare PATH; borrow the login shell's so
// gh (often in /opt/homebrew/bin) resolves.
export async function adoptLoginPath(): Promise<void> {
  if (process.platform === 'win32') return
  try {
    const { stdout } = await promisify(execFile)(
      process.env.SHELL || '/bin/zsh',
      ['-lc', 'printenv PATH'],
      { timeout: LOGIN_SHELL_TIMEOUT_MS }
    )
    const path = stdout.trim().split('\n').pop()
    if (path) process.env.PATH = path
  } catch (err) {
    console.warn('Could not read PATH from the login shell; keeping the inherited one.', err)
  }
}
