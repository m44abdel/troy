import { parseDiff, type ChangeData, type FileData } from 'react-diff-view'

// parseDiff turns an empty string into one blank file, so skip it.
export const parseFiles = (diff: string): FileData[] =>
  diff ? parseDiff(diff, { nearbySequences: 'zip' }) : []

export const fileName = (file: FileData): string =>
  file.type === 'delete' ? file.oldPath : file.newPath

export const countChanges = (file: FileData, type: ChangeData['type']): number =>
  file.hunks.reduce((n, hunk) => n + hunk.changes.filter((c) => c.type === type).length, 0)
