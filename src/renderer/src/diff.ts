import { parseDiff, type FileData } from 'react-diff-view'

// parseDiff turns an empty string into one blank file, so skip it.
export const parseFiles = (diff: string): FileData[] =>
  diff ? parseDiff(diff, { nearbySequences: 'zip' }) : []
