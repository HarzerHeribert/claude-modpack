// The pages this session published with the Artifact tool, read from what the
// tool answered, for the status line's artifacts pill and its list.

import type { StatuslineArtifact } from '../types'

/** What a publish answers: the page's link and its version. */
export function parsePublish(text: string): { url: string; version: number } | undefined {
  const url = text.match(/\bat (https:\/\/claude\.ai\/(?:code\/)?artifact\/[\w-]+)/)?.[1]
  if (url === undefined) return undefined
  return { url, version: Number(text.match(/\(Version (\d+)/)?.[1] ?? 1) }
}

/** Whether an Artifact call published a page (not an asset upload, a read or a list). */
export function isPagePublish(input: Record<string, unknown>): boolean {
  const action = input.action ?? 'publish'
  return action === 'publish' && input.asset !== true
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' }

/** A page's own `<title>`, else the title the call gave, else its file's name. */
export function titleOf(html: string | undefined, filePath: unknown, given: unknown): string {
  const own = html?.match(/<title[^>]*>([^<]{1,160})<\/title>/i)?.[1]?.trim()
  if (own) return own.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, k: string) => ENTITIES[k] ?? _)
  if (typeof given === 'string' && given.trim()) return given.trim()
  const base = typeof filePath === 'string' ? (filePath.split('/').pop() ?? '').replace(/\.(html?|md)$/i, '') : ''
  return base || 'artifact'
}

/** Puts a publish first, replacing the same page's earlier entry; keeps twenty. */
export function upsert(list: readonly StatuslineArtifact[], a: StatuslineArtifact): StatuslineArtifact[] {
  return [a, ...list.filter(x => x.url !== a.url)].slice(0, 20)
}

export function shortUrl(url: string): string {
  return url.replace(/^https:\/\//, '')
}
