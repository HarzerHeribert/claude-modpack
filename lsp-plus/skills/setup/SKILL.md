---
name: setup
description: Give this repository's languages a language server, so Claude Code's LSP tool, lsp-plus, cells and delegate can answer from it, then prove that a grep for a code symbol comes back with the server's answer. Run once after installing the modpack or lsp-plus, and again in a repository with a new language.
disable-model-invocation: true
---

Set up the language servers this repository needs. Claude Code's LSP tool, which lsp-plus, cells and delegate build on, needs two things per language: the official LSP plugin (it tells Claude Code which server to start) and the server itself on the `PATH`. Without them the mods still work, but every symbol question falls back to grep. With them, lsp-plus attaches the server's answer to a grep for a code symbol (who calls it, or its references), names the docs that use a symbol in references and definitions, warns when an edit removes a name the docs still use, and starts each server at session start so the first answer is whole.

## 1. Find the languages

Count the repository's files by extension: `git ls-files | sed -n 's/.*\.//p' | sort | uniq -c | sort -rn | head -20` (outside a git repository, `find . -type f -not -path '*/.git/*' -not -path '*/node_modules/*'`). A language with only a handful of files (a build script, a fixture) needs no server: lsp-plus itself names a missing server only from five files of a language.

## 2. Check what is there

First what the installs need: `uname -s` (`Darwin` is macOS, `Linux` is Linux; Windows is untested), and for the npm installs `node --version` and `npm --version`; on macOS `brew --version`. Homebrew also runs on Linux; the Homebrew commands below were tested on macOS only.

For each language that matters, check both halves at once: `claude plugin list` for the plugin, `command -v <server>` for the server.

| Extensions | Plugin (`@claude-plugins-official`) | Server | Install the server |
| --- | --- | --- | --- |
| .ts .tsx .js .jsx .mjs .cjs | `typescript-lsp` | `typescript-language-server` | `npm i -g typescript-language-server typescript@6` |
| .py .pyi | `pyright-lsp` | `pyright-langserver` | `npm i -g pyright` |
| .rs | `rust-analyzer-lsp` | `rust-analyzer` | `brew install rust-analyzer` or `rustup component add rust-analyzer` |
| .go | `gopls-lsp` | `gopls` | `go install golang.org/x/tools/gopls@latest` |
| .swift | `swift-lsp` | `sourcekit-lsp` | Xcode, or `brew install swift`; Linux: the swift.org toolchain (untested) |
| .c .h .cpp .cc .hpp | `clangd-lsp` | `clangd` | Xcode command line tools (`xcode-select --install`); Linux: `apt install clangd` |
| .java | `jdtls-lsp` | `jdtls` | `brew install jdtls` |
| .kt .kts | `kotlin-lsp` | `kotlin-lsp` | `brew install JetBrains/utils/kotlin-lsp` (its download failed when we tried, 15 Oct) |
| .cs | `csharp-lsp` | `csharp-ls` | `dotnet tool install -g csharp-ls` |
| .php | `php-lsp` | `intelephense` | `npm i -g intelephense` |
| .rb .rake .erb | `ruby-lsp` | `ruby-lsp` | `gem install ruby-lsp` |
| .lua | `lua-lsp` | `lua-language-server` | `brew install lua-language-server` |
| .md | lsp-plus (built in) | `marksman` | `brew install marksman` |
| .sql | lsp-plus (built in) | `postgres-language-server` | `brew install postgres-language-server` |
| .sh .bash | lsp-plus (built in) | `bash-language-server` | `npm i -g bash-language-server` (or `brew install bash-language-server`); with `shellcheck` on the `PATH` it also reports ShellCheck's warnings |
| .tf .tfvars | lsp-plus (built in) | `terraform-ls` | `brew install hashicorp/tap/terraform-ls` (Linux: HashiCorp's apt/rpm repository or a release binary) |

Markdown, SQL, shell and Terraform need no plugin: lsp-plus declares their servers itself. YAML (Ansible, Kubernetes, Helm, GitHub Actions) gets no server here: Claude Code gives each file extension one server, so `.yaml` cannot go to the Ansible server for playbooks and to another for manifests, and none of their servers finds references; grep stays the tool for them.

The grep answer covers TypeScript and JavaScript, Python, C and C++, Rust, Go, Swift, Java, Kotlin, C#, PHP, Ruby, Lua, shell and Terraform. Checked against real servers: Python, TypeScript, Go, Ruby, shell and Terraform; Kotlin by tests only.

## 3. Ask once, then install

Show the person one short list: per language, what is missing and the command that installs it. Installs change their machine (global npm packages, Homebrew formulas, sometimes sudo on Linux), so ask once for the whole list before running any of it. Then install:
- plugins: `claude plugin install <plugin>@claude-plugins-official --scope user`
- servers: the commands above. Without Homebrew (Linux), use the system's package manager or the server's own release; say which.

What goes wrong:
- **TypeScript 7** ships no `tsserver.js`, which `typescript-language-server` needs: install `typescript@6` alongside it, even if the project uses 7.
- **npm `EACCES`** on a global install: point npm at a user prefix (`npm config set prefix ~/.local`) and make sure `~/.local/bin` is on the `PATH`, rather than installing as root.
- **csharp-ls** 0.18 needs .NET 9; an older SDK fails at start.
- **terraform-ls from Homebrew's own formula** (`brew install terraform-ls`) has no provider schemas built in: it finds no references inside `resource`, `data` and `provider` blocks. HashiCorp's build (`hashicorp/tap/terraform-ls`, or a release binary) has them; swap it in if `findReferences` on a variable misses its uses in resources.
- **ruby-lsp** exits at start (code 78) in a project with a `Gemfile` but no `Gemfile.lock`: run `bundle lock` (or `bundle install`) there first.
- **clangd from Homebrew's llvm** is not on the `PATH` by itself: add `$(brew --prefix llvm)/bin`.
- **kotlin-lsp**: JetBrains' formula pointed at a download that returned 404 on 15 October. If it fails, say so and leave Kotlin on grep.
- A server installed into a directory the shell adds to the `PATH` only in interactive shells (`.zshrc`) may be invisible to Claude Code started from elsewhere: prefer `~/.local/bin`, `/opt/homebrew/bin` or `/usr/local/bin`.

## 4. Options

All on by default except `nudge` and `blast`; most people change none. `/mods lsp-plus off` turns the whole mod off at once. Others: `/plugin configure lsp-plus@claude-modpack`, or typed, `/config lsp-plus.warm=false`, or by hand in `~/.claude/settings.json` (user settings only) under `"pluginConfigs": { "lsp-plus@claude-modpack": { "options": { … } } }`. A change inside the session applies at once; in the file, at the next start.

| Option | Default | Change it when |
| --- | --- | --- |
| `enabled` | `true` | You want none of lsp-plus (the language servers it declares stay). |
| `answer` | `true` | You do not want the server's answer attached to symbol greps. |
| `warm` | `true` | Memory is tight: servers then start on their first question instead of at session start (pyright about 440 MB, the TypeScript server up to 2 GB on a large repository). |
| `docs` | `true` | You do not want doc lines added to `findReferences`, `goToDefinition` and `incomingCalls`. |
| `drift` | `true` | You do not want the note after an edit removes a name the docs still use. |
| `nudge` | `false` | Leave off: an older note naming the LSP call; never followed in 45 benchmark notes. |
| `blast` | `false` | You want the callers listed after an edit changes a function's parameters (measured: no gain, so off). |

## 5. Confirm

Claude Code reads a new plugin at session start, so tell the person to restart Claude Code once the installs are done (`claude --continue` keeps this conversation). In the new session:

1. **Each server answers.** One LSP question per language proves it: `documentSymbol` on a file of that language returns its outline. (Load the LSP tool first if your tool list shows it as deferred.) A failure starts with `No LSP server`, or with `Error performing` and a spawn error (`ENOENT`): the plugin or the server is missing, or the server is not on the `PATH` Claude Code started with.
2. **The grep answer.** Pick a function defined in one file of a language with a server and called from another; it must be a plain name of three characters or more. Search for it through Bash (lsp-plus reads Bash's result, not the Grep tool's), with line numbers: `git grep -n -w <name>`. The result must come back with a note like:
   ```
   `<name>` per the language server: called from 3 functions in 2 files (code only: strings, comments, docs and namesakes are in the grep above):
   src/cli.py: main (40), Runner.run (88)
   ```
   or, for a name that is not a function, `` `<name>` per the language server: 5 references in code, in 3 files (…) ``. No note: see step 6.
3. **No missing-server line.** If the person saw `lsp-plus: no language server answers for <language> (<n> files) in this repository…` at the start of a session, it should be gone now.
4. Optionally, the person types `/refs`: it checks every doc for code names the code no longer has and for links to missing files (`All N code references in M docs resolve.` when clean).

End with a short table: language, plugin, server, and whether it is ready or what is left for the person to do.

## 6. When it does not work

- **No note on the grep**: `answer` is off; the grep ran through the Grep tool rather than Bash; the output had no line numbers (`-n`); the pattern was not one plain name (an alternation, free text, under three characters); the name appears only in strings or comments, or only in files no server reads; the definition was not among the hits and the server knows several symbols of that name; or the server was still indexing (it gets about 3 s, and without a whole answer there is none: ask again).
- **The first answers are partial**: the server was cold. With `warm` on, each language's server gets one question about its smallest tracked file at session start (about 1 s for Python, 4 s for TypeScript).
- **No warm-up and no missing-server line**: both read `git ls-tree HEAD`, so a folder that is not a git repository, or one with no commit yet, gets neither.
- **An organization manages Claude Code here**: the `prompt.compose` event does not reach plugins a person installs (`claude plugin validate` names it), so Claude is not told about a missing server; the person's line and the grep answer still work.
- **A server costs memory, not tokens**, and runs until the session ends. If the machine struggles, set `warm` to `false`, or uninstall the servers for languages that matter little.

## 7. Turn it off, or remove it

- Off, at once and kept across updates: `/mods lsp-plus off`. On again: `/mods lsp-plus on`. The official LSP plugins and Claude Code's LSP tool keep working without it.
- Removed: `claude plugin uninstall lsp-plus@claude-modpack`. While the modpack stays installed, its next release installs any missing mod again, so turning it off is the lasting way.
- A language's plugin: `claude plugin uninstall <plugin>@claude-plugins-official`. Its server: the way it came (`npm uninstall -g <package>`, `brew uninstall <formula>`, `gem uninstall ruby-lsp`, `dotnet tool uninstall -g csharp-ls`).
