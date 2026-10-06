// node-pty's npm package ships spawn-helper without its executable bit, and
// without it no terminal can start in the packaged app. Runs before signing.
import { chmodSync, globSync } from 'fs'

export default async function afterPack({ appOutDir }) {
  const helpers = globSync('**/node-pty/prebuilds/*/spawn-helper', { cwd: appOutDir })
  if (!helpers.length) throw new Error(`No node-pty spawn-helper found in ${appOutDir}`)
  for (const helper of helpers) chmodSync(`${appOutDir}/${helper}`, 0o755)
}
