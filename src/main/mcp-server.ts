// Entry point agents spawn over stdio: `ELECTRON_RUN_AS_NODE=1 Troy mcp-server.js`.
import { createInterface } from 'readline'
import { createServer } from './mcp'

const handle = createServer(process.cwd(), process.env.TROY_MAIL_DIR)

createInterface({ input: process.stdin }).on('line', async (line) => {
  if (!line.trim()) return
  let reply: object | null
  try {
    reply = await handle(JSON.parse(line))
  } catch {
    reply = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }
  }
  if (reply) process.stdout.write(`${JSON.stringify(reply)}\n`)
})
