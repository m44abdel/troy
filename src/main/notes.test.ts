import { describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createNote, isNoteName, listNotes, readNote, writeNote } from './notes'

const notesFolder = (): string => realpathSync(mkdtempSync(join(tmpdir(), 'troy-notes-')))

const AT = new Date(2026, 10, 3, 14, 5, 9)

describe('createNote', () => {
  it('names the note after the time it was made', async () => {
    const dir = notesFolder()
    expect(await createNote(dir, AT)).toBe('Note 2026-11-03 140509.md')
    expect(readFileSync(join(dir, 'Note 2026-11-03 140509.md'), 'utf8')).toBe('')
  })

  it('numbers a second note made in the same second', async () => {
    const dir = notesFolder()
    await createNote(dir, AT)
    expect(await createNote(dir, AT)).toBe('Note 2026-11-03 140509 2.md')
    expect(await createNote(dir, AT)).toBe('Note 2026-11-03 140509 3.md')
  })

  it('makes the folder on the first note', async () => {
    const dir = join(notesFolder(), 'notes')
    await createNote(dir, AT)
    expect(existsSync(join(dir, 'Note 2026-11-03 140509.md'))).toBe(true)
  })
})

describe('listNotes', () => {
  it('lists only Markdown files, newest first', async () => {
    const dir = notesFolder()
    writeFileSync(join(dir, 'old.md'), 'a')
    writeFileSync(join(dir, 'new.md'), 'b')
    writeFileSync(join(dir, 'picture.png'), 'c')
    utimesSync(join(dir, 'old.md'), new Date(2026, 0, 1), new Date(2026, 0, 1))
    utimesSync(join(dir, 'new.md'), new Date(2026, 5, 1), new Date(2026, 5, 1))
    const notes = await listNotes(dir)
    expect(notes.map((n) => n.name)).toEqual(['new.md', 'old.md'])
    expect(notes[0].modified).toBe(new Date(2026, 5, 1).getTime())
  })

  it('leaves out a folder named like a note and a link to a deleted file', async () => {
    const dir = notesFolder()
    writeFileSync(join(dir, 'real.md'), 'a')
    mkdirSync(join(dir, 'folder.md'))
    symlinkSync(join(dir, 'gone.md'), join(dir, 'dangling.md'))
    expect((await listNotes(dir)).map((n) => n.name)).toEqual(['real.md'])
  })

  it('is empty before the folder exists', async () => {
    expect(await listNotes(join(notesFolder(), 'missing'))).toEqual([])
  })
})

describe('readNote and writeNote', () => {
  it('write then read gives the text back', async () => {
    const dir = notesFolder()
    const name = await createNote(dir, AT)
    await writeNote(dir, name, '# Plan\n- ship it\n')
    expect(await readNote(dir, name)).toBe('# Plan\n- ship it\n')
  })

  it('saves sent together land in the order they were sent', async () => {
    const dir = notesFolder()
    const name = await createNote(dir, AT)
    // The long first save would finish last if the two were written side by side.
    await Promise.all([writeNote(dir, name, 'a'.repeat(5_000_000)), writeNote(dir, name, 'b')])
    expect(readFileSync(join(dir, name), 'utf8')).toBe('b')
  })

  it('writing a note deleted meanwhile saves it again', async () => {
    const dir = notesFolder()
    const name = await createNote(dir, AT)
    rmSync(join(dir, name))
    await writeNote(dir, name, 'still here')
    expect(readFileSync(join(dir, name), 'utf8')).toBe('still here')
  })

  it('says which note is gone when reading one that was deleted', async () => {
    await expect(readNote(notesFolder(), 'gone.md')).rejects.toThrow(
      'gone.md is not in the notes folder anymore.'
    )
  })

  it('refuses text that is not a string', async () => {
    const dir = notesFolder()
    const name = await createNote(dir, AT)
    await expect(writeNote(dir, name, 42)).rejects.toThrow('A note holds text.')
  })

  it.each([
    '../escape.md',
    'sub/inner.md',
    'sub\\inner.md',
    'a.md:stream.md',
    '.hidden.md',
    'notes.txt',
    ''
  ])('refuses %j', async (name) => {
    const dir = notesFolder()
    await expect(readNote(dir, name)).rejects.toThrow('Not a note')
    await expect(writeNote(dir, name, 'x')).rejects.toThrow('Not a note')
  })
})

describe('isNoteName', () => {
  it('accepts a Markdown file name with spaces', () => {
    expect(isNoteName('Note 2026-11-03 140509.md')).toBe(true)
  })

  it('refuses anything but a string', () => {
    expect(isNoteName(undefined)).toBe(false)
    expect(isNoteName(['a.md'])).toBe(false)
  })
})
