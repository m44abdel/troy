import { app, ipcMain, shell } from 'electron'
import type { Dirent } from 'fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import type { NoteInfo } from '../shared/types'
import { attempt } from './repos'

/** The floating window's Markdown notes, one file each. */
export const notesDir = (): string => join(app.getPath('userData'), 'notes')

const isErrno = (err: unknown, code: string): boolean =>
  (err as NodeJS.ErrnoException).code === code

/**
 * A plain .md file name, so nothing the window sends can reach outside the notes folder.
 * No colon either: on Windows `a.md:b.md` names a hidden stream of a.md.
 */
export const isNoteName = (name: unknown): name is string =>
  typeof name === 'string' && !/[\\/:]/.test(name) && !name.startsWith('.') && name.endsWith('.md')

function noteIn(dir: string, name: unknown): string {
  if (!isNoteName(name)) throw new Error(`Not a note: ${JSON.stringify(name)}`)
  return join(dir, name)
}

/** Notes are plain files: a folder or a link named like one is left out. */
export async function listNotes(dir: string): Promise<NoteInfo[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (err) {
    if (isErrno(err, 'ENOENT')) return []
    throw err
  }
  const notes = await Promise.all(
    entries
      .filter((e) => e.isFile() && isNoteName(e.name))
      .map(async ({ name }) => {
        try {
          return { name, modified: (await stat(join(dir, name))).mtimeMs }
        } catch (err) {
          // Deleted since the folder was read.
          if (isErrno(err, 'ENOENT')) return null
          throw err
        }
      })
  )
  return notes.filter((n) => n !== null).sort((a, b) => b.modified - a.modified)
}

export async function readNote(dir: string, name: unknown): Promise<string> {
  const file = noteIn(dir, name)
  try {
    return await readFile(file, 'utf8')
  } catch (err) {
    if (isErrno(err, 'ENOENT')) throw new Error(`${name} is not in the notes folder anymore.`)
    throw err
  }
}

// The window sends a save each time typing pauses, without waiting for the last one; side by
// side, an older save could finish last. Each note's saves go one at a time, in arrival order.
const saving = new Map<string, Promise<void>>()

/** Saves the note, making it again if it was deleted while open, so typed text isn't lost. */
export async function writeNote(dir: string, name: unknown, text: unknown): Promise<void> {
  const file = noteIn(dir, name)
  if (typeof text !== 'string') throw new Error('A note holds text.')
  const write = async (): Promise<void> => {
    await mkdir(dir, { recursive: true })
    await writeFile(file, text)
  }
  const done = (saving.get(file) ?? Promise.resolve()).then(write, write)
  saving.set(file, done)
  const forget = (): void => {
    if (saving.get(file) === done) saving.delete(file)
  }
  done.then(forget, forget)
  return done
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** Makes an empty note named after `now` and returns its name. */
export async function createNote(dir: string, now = new Date()): Promise<string> {
  await mkdir(dir, { recursive: true })
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const base = `Note ${date} ${time}`
  for (let n = 1; ; n++) {
    const name = n === 1 ? `${base}.md` : `${base} ${n}.md`
    try {
      await writeFile(join(dir, name), '', { flag: 'wx' })
      return name
    } catch (err) {
      if (!isErrno(err, 'EEXIST')) throw err
    }
  }
}

export function registerNotes(): void {
  ipcMain.handle('notes:list', () => attempt(async () => ({ notes: await listNotes(notesDir()) })))
  ipcMain.handle('notes:read', (_e, name) =>
    attempt(async () => ({ text: await readNote(notesDir(), name) }))
  )
  ipcMain.handle('notes:write', (_e, name, text) =>
    attempt(async () => {
      await writeNote(notesDir(), name, text)
      return {}
    })
  )
  ipcMain.handle('notes:create', () =>
    attempt(async () => ({ name: await createNote(notesDir()) }))
  )
  ipcMain.handle('notes:reveal', () =>
    attempt(async () => {
      await mkdir(notesDir(), { recursive: true })
      const failed = await shell.openPath(notesDir())
      if (failed) throw new Error(failed)
      return {}
    })
  )
}
