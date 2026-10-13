// What the model reads: the chaining guidance (a system-prompt section, in
// both modes) and the run_cell tool's description (cells mode only).

export const NUDGE = `# Fewer round-trips

Every model request re-reads the whole conversation, so a step that needs no judgment should not cost a request of its own.

- When you already know several things you need to see, get them in one Bash call (join commands with \`;\` and label each part with an \`echo\`), or as parallel tool calls in one response.
- When you already know several edits, send them in one response with the check after them: calls in one response run in order, so the check sees the edits. When a check fails, print the failing part in the same command (for example \`pytest -x -q 2>&1 | tail -40\`).
- When a search names the files you will open next, open them in the same command (for example \`rg -l pattern | head -3 | xargs sed -n '1,120p'\`).
- When you wait for something, wait in one command (\`until …; do sleep 5; done\`) instead of checking again and again.

Take a separate step only when what you do next depends on reading the result.`

export const NUDGE_CELLS = `${NUDGE}

run_cell chains real tool calls where one response can't: edits you would otherwise script in Python or sed (it keeps the Edit tool's diff and /rewind), the language server's references, definitions and renames without loading the LSP tool, and steps that branch on results without your judgment.`

export const TOOL_NAME = 'run_cell'

export const TOOL_DESCRIPTION = `Run a short JavaScript program (a cell) that chains real tool calls in one step. Each call inside is a normal Read, Edit, Write, Bash or LSP call with the usual permissions; edits show as diffs and can be rewound.

Use it where one step can do what would otherwise take several requests:
  - Edits and their check: read, edit, edit, then the tests or type check, returning only what failed. Prefer it to a Python or sed script that rewrites files: the same single step, through the Edit tool.
  - The language server, without loading the LSP tool: refs() and defn() list each place with its line; rename() changes every reference of a symbol and lists the text mentions it left (docs, strings, comments) for you to judge.
  - Inspections you already know you need, or that follow from each other without your judgment (a search, then its hits).
Don't use it for one call, or when you need to read a result before deciding the next step.

API (all async; plain JavaScript, TypeScript types are stripped):
  sh(command, { timeout?, check?, background? }) → { ok, out, err, code, task? }
      Bash; with check: true a non-zero exit throws; background: true starts it as a background task (task is its id;
      Claude Code tells you when it ends), for a server, a watcher or a long job the cell need not wait for
  read(path, { offset?, limit? }) → string                       Read
  edit(path, oldText, newText, { all? })                         Edit; throws if it fails; needs a read of the file first (in the cell is fine)
  write(path, text)                                              Write
  refs(path, name, { line? }) → [{ file, line, col, text }]      every reference of name, as defined or used in path (on line, if given); the declaration included
  defn(path, name, { line? }) → [{ file, line, col, text }]      where name, as used in path, is defined
  rename(path, name, newName, { line? }) → { changed, files, skipped, failed, left, leftCount }
      edits every reference the language server lists, through Edit; left lists where the old name still appears as text:
      docs, strings, comments, and code the server did not resolve (another package, dynamic use). Check each.
  fold(text) → string     folds passing tests, build chatter and repeated lines; keeps every failure line
  log(...values)          notes shown in the result
  h                       an object whose values survive into later cells of this prompt; the result previews them
Use Promise.all([...]) for independent calls. \`return\` what you want to see: long text is folded and cut, so keep a full value in h when you may need more of it.

run_cell({ code, background: true }) returns at once and the cell's report arrives as a message when it ends: for a cell that waits on something long.

A cell that does not parse, or throws before its first call, has run nothing, and the report shows the line. Don't send it again: run_cell({ fix: [{ old, new }] }) applies exact replacements to that program (each old text a short snippet that occurs once) and runs it. Where the slip is a template literal escaped as if it sat inside another one (\\\` or \\\${ outside any template), the report shows the repair and run_cell({ repair: true }) runs it.

Example:
  await read('src/app.py')
  await edit('src/app.py', 'retries = 3', 'retries = 5')
  await edit('src/app.py', 'timeout = 10', 'timeout = 30')
  const t = await sh('python -m pytest -x -q tests/test_app.py 2>&1')
  return t.ok ? 'tests pass' : fold(t.out)`
