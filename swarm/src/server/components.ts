import { readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Component } from '../lib/types'

export const MAX_DEPTH = 3
const SKIP = new Set(['node_modules', '.git', 'dist', '.output'])
const MAX_ENTRIES = 30_000

/** Make `p` relative to `cwd`; undefined when it lies outside (or is the root itself, returned as "."). */
export function relativeToCwd(p: string, cwd: string): string | undefined {
  const norm = (x: string) => x.replace(/\\/g, '/').replace(/\/+$/, '')
  const c = norm(cwd)
  let q = norm(p)
  if (q.startsWith('/') || /^[A-Za-z]:\//.test(q)) {
    if (q === c) return '.'
    if (!q.startsWith(c + '/')) return undefined
    q = q.slice(c.length + 1)
  }
  q = q.replace(/^(\.\/)+/, '')
  if (q === '' || q === '.') return '.'
  if (q.startsWith('../') || q === '..') return undefined
  return q
}

/** Deepest component that contains the repo-relative path (a file or a directory). */
export function componentForPath(path: string, ids: ReadonlySet<string>): string | undefined {
  if (ids.size === 0) return undefined
  let p = path
  // A path that names a component itself (a directory) maps to it directly.
  if (ids.has(p)) return p
  for (;;) {
    const i = p.lastIndexOf('/')
    if (i < 0) return ids.has('.') ? '.' : undefined
    p = p.slice(0, i)
    if (ids.has(p)) return p
  }
}

/** Scan directories to depth 3 under `cwd`, with recursive file counts. */
export function scanComponents(cwd: string): Component[] {
  const comps = new Map<string, Component>()
  let budget = MAX_ENTRIES
  const root: Component = { id: '.', label: basename(cwd) || cwd, parentId: null, fileCount: 0 }
  comps.set('.', root)

  // Returns the file count of the directory subtree.
  function walk(abs: string, id: string, depth: number): number {
    let count = 0
    let entries
    try {
      entries = readdirSync(abs, { withFileTypes: true })
    } catch {
      return 0
    }
    for (const e of entries) {
      if (--budget < 0) return count
      if (e.isDirectory()) {
        if (SKIP.has(e.name) || e.name.startsWith('.')) continue
        const childId = id === '.' ? e.name : `${id}/${e.name}`
        if (depth <= MAX_DEPTH) {
          const comp: Component = { id: childId, label: e.name, parentId: id, fileCount: 0 }
          comps.set(childId, comp)
          comp.fileCount = walk(join(abs, e.name), childId, depth + 1)
          count += comp.fileCount
        } else {
          count += walkCountOnly(join(abs, e.name))
        }
      } else if (e.isFile()) {
        count++
      }
    }
    return count
  }
  function walkCountOnly(abs: string): number {
    let count = 0
    let entries
    try {
      entries = readdirSync(abs, { withFileTypes: true })
    } catch {
      return 0
    }
    for (const e of entries) {
      if (--budget < 0) return count
      if (e.isDirectory()) {
        if (SKIP.has(e.name) || e.name.startsWith('.')) continue
        count += walkCountOnly(join(abs, e.name))
      } else if (e.isFile()) count++
    }
    return count
  }
  root.fileCount = walk(cwd, '.', 1)
  return [...comps.values()]
}
