export type Place = { file: string; line: number; col: number }
export type RenameEdit = { old: string; new: string }
export type RenamePlan = {
  edits: RenameEdit[]
  changed: number
  skipped: { line: number; col: number; text: string }[]
  ambiguous: { line: number; text: string }[]
}
export declare function isName(name: unknown): boolean
export declare function anchorIn(text: string, name: string, line?: number): { line: number; col: number } | undefined
export declare function parseLocations(text: string): Place[]
export declare function planRename(text: string, places: readonly { line: number; col: number }[], name: string, newName: string): RenamePlan
export declare function parseMentions(out: string, max?: number): { count: number; places: { file: string; line: number; text: string }[] }
