import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { fileDependencies, graphifyPython } from './graph'

describe('fileDependencies', () => {
  it('maps each file to the other files its code imports or calls', () => {
    const node = (id: string, file?: string): { id: string; source_file?: string } => ({
      id,
      source_file: file
    })
    const edge = (
      source: string,
      target: string,
      relation: string
    ): { source: string; target: string; relation: string } => ({
      source,
      target,
      relation
    })
    const graph = {
      nodes: [
        node('ui', 'src/ui.ts'),
        node('ui_render', 'src/ui.ts'),
        node('api', 'src/api.ts'),
        node('api_get', 'src/api.ts'),
        node('pkg_react', 'package.json'),
        node('ref_fs')
      ],
      links: [
        edge('ui', 'ui_render', 'contains'),
        edge('ui', 'api', 'imports_from'),
        edge('ui_render', 'api_get', 'calls'),
        edge('ui', 'pkg_react', 'imports_from'),
        edge('api', 'ref_fs', 'imports'),
        edge('api', 'api_get', 'contains')
      ]
    }

    expect(fileDependencies(graph)).toEqual({ 'src/ui.ts': ['src/api.ts'] })
  })

  it('tolerates a graph without links', () => {
    expect(fileDependencies({ nodes: [] })).toEqual({})
  })
})

describe('graphifyPython', () => {
  const dir = (): string => realpathSync(mkdtempSync(join(tmpdir(), 'troy-gfy-')))

  it('uses the python beside the real script, as uv and pipx lay them out', async () => {
    const venv = join(dir(), 'bin')
    mkdirSync(venv)
    writeFileSync(join(venv, 'graphify'), "#!/bin/sh\n'''exec' python\n")
    writeFileSync(join(venv, 'python'), '')
    const link = join(dir(), 'graphify')
    symlinkSync(join(venv, 'graphify'), link)

    expect(await graphifyPython(link)).toBe(join(venv, 'python'))
  })

  it('falls back to a python named in the shebang', async () => {
    const script = join(dir(), 'graphify')
    writeFileSync(script, '#!/opt/py/bin/python3.12\nimport x\n')
    expect(await graphifyPython(script)).toBe('/opt/py/bin/python3.12')

    writeFileSync(script, '#!/usr/bin/env python3\n')
    expect(await graphifyPython(script)).toBe(null)
  })
})
