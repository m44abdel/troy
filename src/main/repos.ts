import { app, dialog, ipcMain, BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { overlaps, type Overlap } from '../shared/overlap'
import type { CreateRequest, Repo, ReposResult, Worktree } from '../shared/types'
import { runCheck } from './check'
import { readContext, resumeFlag } from './context'
import { buildGraph, graphDependencies, graphServer } from './graph'
import { harvest } from './harvest'
import { listDocs, readDoc } from './docs'
import { changedFiles, commitAll, diffAgainst, openPullRequest, push } from './finish'
import { stripInstructions, writeInstructions } from './instructions'
import { approve, readKnowledge, reject } from './knowledge'
import { hookFlags, mcpFlags } from './mcp-config'
import {
  createWorktree,
  findWorktree,
  git,
  hasSetupScript,
  listWorktrees,
  nextPortBase,
  removeWorktree
} from './worktrees'

const DEFAULT_AGENT = 'claude'
const MAX_TITLE_LENGTH = 120

interface WorktreeMeta {
  agent: string
  port: number
  /** Ref the worktree's diff is measured against. */
  base?: string
  title?: string
}

interface State {
  repos: string[]
  worktrees: Record<string, WorktreeMeta>
}

const statePath = (): string => join(app.getPath('userData'), 'state.json')

const isMeta = (m: unknown): m is WorktreeMeta =>
  typeof (m as WorktreeMeta)?.agent === 'string' && typeof (m as WorktreeMeta)?.port === 'number'

async function loadState(): Promise<State> {
  try {
    const parsed = JSON.parse(await readFile(statePath(), 'utf8'))
    const repos = Array.isArray(parsed?.repos)
      ? parsed.repos.filter((r: unknown): r is string => typeof r === 'string')
      : []
    const worktrees = Object.fromEntries(
      Object.entries(parsed?.worktrees ?? {}).filter(([, m]) => isMeta(m))
    ) as Record<string, WorktreeMeta>
    return { repos, worktrees }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT')
      console.error('Unreadable state.json', err)
    return { repos: [], worktrees: {} }
  }
}

async function saveState(state: State): Promise<void> {
  await writeFile(statePath(), JSON.stringify(state, null, 2))
}

async function describeRepos(state: State): Promise<Repo[]> {
  return Promise.all(
    state.repos.map(async (path) => {
      try {
        // ponytail: a graph built after this listing reaches agents on the next one.
        const graph = graphServer(path)
        const worktrees = (await listWorktrees(path)).map((wt) => {
          const meta = state.worktrees[wt.path]
          const agent = meta?.agent ?? DEFAULT_AGENT
          const title = typeof meta?.title === 'string' ? meta.title : undefined
          return {
            ...wt,
            agent, // --mcp-config swallows every argument after it, so it goes last.
            agentArgs: hookFlags(agent) + mcpFlags(agent, undefined, undefined, graph ?? undefined),
            resume: resumeFlag(agent, wt.path),
            port: meta?.port,
            title
          }
        })
        return { path, worktrees }
      } catch (err) {
        return { path, worktrees: [], error: (err as Error).message }
      }
    })
  )
}

const listRepos = async (): Promise<Repo[]> => describeRepos(await loadState())

async function knownRepo(repo: unknown): Promise<string> {
  if (typeof repo !== 'string' || !(await loadState()).repos.includes(repo))
    throw new Error(`Unknown repository: ${repo}`)
  return repo
}

async function addRepo(event: IpcMainInvokeEvent): Promise<ReposResult & { added?: string }> {
  const win = BrowserWindow.fromWebContents(event.sender)
  const options = { title: 'Add a git repository', properties: ['openDirectory' as const] }
  const pick = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options)
  const state = await loadState()
  if (pick.canceled || !pick.filePaths[0]) return { repos: await describeRepos(state) }

  const top = await git(pick.filePaths[0], ['rev-parse', '--show-toplevel']).catch(() => null)
  if (!top)
    return {
      repos: await describeRepos(state),
      error: `${pick.filePaths[0]} is not inside a git repository.`
    }
  if (state.repos.includes(top)) return { repos: await describeRepos(state), added: top }

  const next = { ...state, repos: [...state.repos, top] }
  await saveState(next)
  void buildGraph(top)
  return { repos: await describeRepos(next), added: top }
}

/** The first line of the prompt, short enough for a sidebar card. */
export const taskTitle = (prompt: string): string | undefined =>
  prompt
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
    ?.slice(0, MAX_TITLE_LENGTH)

function parseCreateRequest(req: unknown): CreateRequest {
  const { branch, base, agent, prompt } = (req ?? {}) as Record<string, unknown>
  if (typeof branch !== 'string' || typeof base !== 'string' || typeof agent !== 'string')
    throw new Error('Branch, base and agent must be text.')
  if (!agent.trim() || /[\r\n]/.test(agent)) throw new Error('Agent must be a single command line.')
  if (prompt !== undefined && typeof prompt !== 'string') throw new Error('Prompt must be text.')
  return { branch: branch.trim(), base: base.trim(), agent: agent.trim(), prompt }
}

async function create(
  repoArg: unknown,
  reqArg: unknown
): Promise<ReposResult & { path?: string; setup?: boolean; warning?: string }> {
  try {
    const repo = await knownRepo(repoArg)
    const req = parseCreateRequest(reqArg)
    const { path, base, warnings } = await createWorktree(repo, req.branch, req.base)
    // The base was just fetched, so this is a good moment to refresh the graph.
    void buildGraph(repo)
    await writeInstructions(path, req.agent).catch((err) =>
      console.warn(`Could not add the knowledge block to ${path}`, err)
    )

    const state = await loadState()
    const port = nextPortBase(Object.values(state.worktrees).map((m) => m.port))
    const next = {
      ...state,
      worktrees: {
        ...state.worktrees,
        [path]: { agent: req.agent, port, base, title: taskTitle(req.prompt ?? '') }
      }
    }
    await saveState(next)
    return {
      repos: await describeRepos(next),
      path,
      setup: await hasSetupScript(path),
      ...(warnings.length ? { warning: warnings.join(' ') } : {})
    }
  } catch (err) {
    return { repos: await listRepos(), error: (err as Error).message }
  }
}

async function archive(
  event: IpcMainInvokeEvent,
  repoArg: unknown,
  path: unknown
): Promise<ReposResult> {
  try {
    const repo = await knownRepo(repoArg)
    const wt = await findWorktree(repo, String(path))
    if (wt.primary) throw new Error('The primary worktree cannot be archived.')

    const win = BrowserWindow.fromWebContents(event.sender)
    const options = {
      type: 'question' as const,
      message: `Archive ${wt.branch ?? wt.path}?`,
      detail: `Removes the worktree at ${wt.path}. Git refuses if it has uncommitted changes.`,
      buttons: ['Archive', 'Archive and delete branch', 'Cancel'],
      defaultId: 0,
      cancelId: 2
    }
    const { response } = win
      ? await dialog.showMessageBox(win, options)
      : await dialog.showMessageBox(options)
    if (response === 2) return { repos: await listRepos() }

    // If this fails, git's own dirty check below still protects the worktree.
    await stripInstructions(wt.path).catch((err) =>
      console.warn('Could not strip the knowledge block', err)
    )
    await removeWorktree(repo, wt, response === 1)
    const state = await loadState()
    const worktrees = Object.fromEntries(
      Object.entries(state.worktrees).filter(([p]) => p !== wt.path)
    )
    await saveState({ ...state, worktrees })
    return { repos: await listRepos() }
  } catch (err) {
    return { repos: await listRepos(), error: (err as Error).message }
  }
}

/** Resolves a renderer-supplied path to a worktree of a repo the user added. */
async function locate(path: unknown): Promise<{ path: string; base: string }> {
  const state = await loadState()
  for (const repo of state.repos) {
    const wt = (await listWorktrees(repo).catch(() => [])).find((w) => w.path === path)
    if (wt) return { path: wt.path, base: await baseOf(repo, wt, state) }
  }
  throw new Error(`Unknown worktree: ${path}`)
}

async function baseOf(repo: string, wt: Worktree, state: State): Promise<string> {
  if (wt.primary) return 'HEAD'
  return (
    state.worktrees[wt.path]?.base ??
    (await git(repo, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).catch(() => 'HEAD'))
  )
}

/** Worktrees of the same repo that changed the same files, keyed by worktree path. */
async function findOverlaps(): Promise<Record<string, Overlap[]>> {
  const state = await loadState()
  const perRepo = await Promise.all(
    state.repos.map(async (repo) => {
      const worktrees = await listWorktrees(repo).catch(() => [])
      const changes = await Promise.all(
        worktrees.map(async (wt) => [
          wt.path,
          await changedFiles(wt.path, await baseOf(repo, wt, state)).catch(() => [])
        ])
      )
      return overlaps(Object.fromEntries(changes), await graphDependencies(repo))
    })
  )
  return Object.assign({}, ...perRepo)
}

async function attempt<T extends object>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn()
  } catch (err) {
    return { error: (err as Error).message }
  }
}

export function registerRepos(): void {
  void loadState().then((state) => state.repos.forEach((repo) => void buildGraph(repo)))
  // Only paths derived from these are read, inside the agents' own log folders.
  ipcMain.handle('context:get', (_e, path, agent) => {
    if (typeof path !== 'string' || typeof agent !== 'string') return null
    return readContext(path, agent).catch((err) => {
      console.warn(`Could not read context usage for ${path}`, err)
      return null
    })
  })
  ipcMain.handle('worktree:diff', (_e, path) =>
    attempt(async () => {
      const wt = await locate(path)
      return { diff: await diffAgainst(wt.path, wt.base) }
    })
  )
  ipcMain.handle('worktree:commit', (_e, path, message) =>
    attempt(async () => {
      await commitAll((await locate(path)).path, String(message ?? ''))
      return {}
    })
  )
  ipcMain.handle('worktree:push', (_e, path) =>
    attempt(async () => {
      await push((await locate(path)).path)
      return {}
    })
  )
  ipcMain.handle('worktree:pr', (_e, path) =>
    attempt(async () => {
      await openPullRequest((await locate(path)).path)
      return {}
    })
  )
  ipcMain.handle('docs:list', (_e, path) =>
    attempt(async () => ({ files: await listDocs((await locate(path)).path) }))
  )
  ipcMain.handle('docs:read', (_e, path, file) =>
    attempt(async () => ({ text: await readDoc((await locate(path)).path, String(file)) }))
  )
  ipcMain.handle('knowledge:get', (_e, path) =>
    attempt(async () => readKnowledge((await locate(path)).path))
  )
  ipcMain.handle('knowledge:approve', (_e, path, id) =>
    attempt(async () => {
      await approve((await locate(path)).path, String(id))
      return {}
    })
  )
  ipcMain.handle('knowledge:reject', (_e, path, id) =>
    attempt(async () => {
      await reject((await locate(path)).path, String(id))
      return {}
    })
  )
  ipcMain.handle('worktrees:overlaps', findOverlaps)
  ipcMain.handle('knowledge:harvest', (_e, path) =>
    attempt(async () => {
      const wt = await locate(path)
      const agent = (await loadState()).worktrees[wt.path]?.agent ?? DEFAULT_AGENT
      return { proposed: await harvest(wt.path, agent) }
    })
  )
  ipcMain.handle('check:run', (_e, path) =>
    attempt(async () => ({ result: await runCheck((await locate(path)).path) }))
  )
  ipcMain.handle('repos:list', listRepos)
  ipcMain.handle('repos:add', addRepo)
  ipcMain.handle('worktree:create', (_e, repo, req) => create(repo, req))
  ipcMain.handle('worktree:archive', archive)
}
