import { app } from 'electron'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { commandName, shellQuote } from '../shared/shell'

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

/** The file Claude Code loads via --mcp-config. */
export async function writeMcpConfig(): Promise<void> {
  await writeFile(configPath(), JSON.stringify({ mcpServers: { troy: launch() } }, null, 2))
}

/**
 * Flags appended to the agent's command line so it starts Troy's MCP server.
 * They go last: Claude's --mcp-config takes every argument after it.
 */
export function mcpFlags(agent: string, config = configPath(), server = launch()): string {
  const cli = commandName(agent)
  if (cli === 'claude') return ` --mcp-config ${shellQuote(config)}`
  if (cli !== 'codex') return ''
  const env = Object.entries(server.env).map(([k, v]) => `${k}=${JSON.stringify(v)}`)
  return [
    `command=${JSON.stringify(server.command)}`,
    `args=${JSON.stringify(server.args)}`,
    `env={${env.join(',')}}`
  ]
    .map((setting) => ` -c ${shellQuote(`mcp_servers.troy.${setting}`)}`)
    .join('')
}
