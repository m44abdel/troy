// ponytail: POSIX quoting; Windows shells need their own once Windows is supported.
export const shellQuote = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`

/** The CLI an agent command runs, e.g. "claude" for "/usr/local/bin/claude --resume". */
export const commandName = (command: string): string =>
  command.trim().split(/\s+/)[0]?.split(/[\\/]/).pop() ?? ''
