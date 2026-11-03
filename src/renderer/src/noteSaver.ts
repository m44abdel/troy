export type SaveState = 'saved' | 'saving' | { error: string }

interface NoteSaver {
  /** The editor's text changed; it goes out on the next flush. */
  edit: (text: string) => void
  /** Sends the latest unsent text, if any. */
  flush: () => void
}

/**
 * Sends a note's text as soon as it is flushed, without waiting on earlier writes (main
 * writes each note's saves in the order they arrive). A failed save is kept for the next
 * flush, unless newer text has gone out since: resending it would put older text on disk.
 */
export function noteSaver(
  write: (text: string) => Promise<{ error?: string }>,
  report: (state: SaveState) => void
): NoteSaver {
  let unsaved: string | null = null
  let sent = 0
  return {
    edit: (text) => {
      unsaved = text
    },
    flush: () => {
      if (unsaved === null) return
      const text = unsaved
      const version = ++sent
      unsaved = null
      report('saving')
      write(text)
        .catch((err: Error) => ({ error: err.message }))
        .then(({ error }) => {
          if (version !== sent) return
          if (error) {
            unsaved ??= text
            report({ error })
          } else if (unsaved === null) report('saved')
        })
    }
  }
}
