import { app } from 'electron'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { commandName, shellQuote } from '../shared/shell'
import { STATUS_OSC } from '../shared/status'

export interface McpLaunch {
  command: string
  args: string[]
  env: Record<string, string>
}

// Troy's own binary runs the server as plain Node, so nothing extra is installed.
const launch = (): McpLaunch => ({
  command: process.execPath,
  args: [join(__dirname, 'mcp-server.js')],
  env: { ELECTRON_RUN_AS_NODE: '1' }
})

const configPath = (): string => join(app.getPath('userData'), 'mcp.json')

const hooksPath = (): string => join(app.getPath('userData'), 'claude-hooks.json')

// The agent pane sets TROY_TTY; the OSC lands in that pane's terminal, which reads it as status.
const report = (
  status: 'running' | 'waiting'
): { hooks: { type: string; command: string }[] }[] => [
  {
    hooks: [
      {
        type: 'command',
        command: `[ -n "$TROY_TTY" ] && printf '\\033]${STATUS_OSC};${status}\\007' > "$TROY_TTY"; true`
      }
    ]
  }
]

/** Claude Code hooks that report working or waiting straight to Troy. */
export const hookSettings = (): Record<string, unknown> => ({
  hooks: {
    UserPromptSubmit: report('running'),
    PostToolUse: report('running'),
    Notification: report('waiting'),
    Stop: report('waiting')
  }
})

/** The files Claude Code loads via --mcp-config and --settings. */
export async function writeMcpConfig(): Promise<void> {
  await writeFile(configPath(), JSON.stringify({ mcpServers: { troy: launch() } }, null, 2))
  await writeFile(hooksPath(), JSON.stringify(hookSettings(), null, 2))
}

/** Claude's --settings merges with the user's own settings rather than replacing them. */
export const hookFlags = (agent: string, path = hooksPath()): string =>
  commandName(agent) === 'claude' ? ` --settings ${shellQuote(path)}` : ''

/**
 * Flags appended to the agent's command line so it starts Troy's MCP server.
 * They go last: Claude's --mcp-config takes every argument after it.
 */
export function mcpFlags(
  agent: string,
  config = configPath(),
  server = launch(),
  graph?: { config: string; server: McpLaunch }
): string {
  const cli = commandName(agent)
  if (cli === 'claude')
    return ` --mcp-config ${[config, ...(graph ? [graph.config] : [])].map(shellQuote).join(' ')}`
  if (cli !== 'codex') return ''
  return codexServer('troy', server) + (graph ? codexServer('graph', graph.server) : '')
}

function codexServer(name: string, server: McpLaunch): string {
  const env = Object.entries(server.env).map(([k, v]) => `${k}=${JSON.stringify(v)}`)
  return [
    `command=${JSON.stringify(server.command)}`,
    `args=${JSON.stringify(server.args)}`,
    `env={${env.join(',')}}`
  ]
    .map((setting) => ` -c ${shellQuote(`mcp_servers.${name}.${setting}`)}`)
    .join('')
}
