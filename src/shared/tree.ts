/** One row of the Files tab's tree. */
export interface TreeNode {
  name: string
  path: string
  dir: boolean
  /** Hidden by .gitignore; an ignored folder's contents aren't listed. */
  ignored: boolean
  children: TreeNode[]
}

const byKindThenName = (a: TreeNode, b: TreeNode): number =>
  a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true })

function sorted(nodes: TreeNode[]): TreeNode[] {
  return nodes.map((n) => ({ ...n, children: sorted(n.children) })).sort(byKindThenName)
}

/** Folders and files from `git ls-files` paths; `ignored` folders end in "/". */
export function buildTree(files: string[], ignored: string[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', dir: true, ignored: false, children: [] }
  const add = (entry: string, isIgnored: boolean): void => {
    const dir = entry.endsWith('/')
    const parts = entry.split('/').filter(Boolean)
    let node = root
    parts.forEach((name, i) => {
      const path = parts.slice(0, i + 1).join('/')
      const last = i === parts.length - 1
      let child = node.children.find((c) => c.name === name)
      if (!child) {
        child = { name, path, dir: !last || dir, ignored: last && isIgnored, children: [] }
        node.children.push(child)
      }
      node = child
    })
  }
  files.forEach((f) => add(f, false))
  ignored.forEach((f) => add(f, true))
  return sorted(root.children)
}
