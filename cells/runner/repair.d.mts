export declare function strayEscapeAt(code: string): number
export declare function unescapeTemplates(code: string): { code: string; lines: number[] } | undefined
export declare function applyFixes(code: string, fixes: readonly { old: string; new: string }[]): { code: string; error?: undefined } | { error: string; code?: undefined }
export declare function describeSyntax(message: string, code: string, line?: number, caret?: string): string
