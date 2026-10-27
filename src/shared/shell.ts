// POSIX only. Windows shells will want their own quoting.
export const shellQuote = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`

/** The CLI an agent command runs, e.g. "claude" for "/usr/local/bin/claude --resume". */
export const commandName = (command: string): string =>
  command.trim().split(/\s+/)[0]?.split(/[\\/]/).pop() ?? ''

/** Agent CLIs Troy suggests and looks for on PATH. Any other command works too. */
export const KNOWN_AGENTS = ['claude', 'codex', 'gemini', 'opencode', 'aider']
