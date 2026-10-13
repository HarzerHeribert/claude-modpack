---
name: setup
description: Give this repository's languages a language server, so Claude Code's LSP tool, lsp-plus, cells and delegate can answer from it. Run once after installing the modpack or lsp-plus, and again in a repository with a new language.
disable-model-invocation: true
---

Set up the language servers this repository needs. Claude Code's LSP tool, which lsp-plus, cells and delegate build on, needs two things per language: the official LSP plugin (it tells Claude Code which server to start) and the server itself on the `PATH`. Without them the mods still work, but every symbol question falls back to grep.

## 1. Find the languages

Count the repository's files by extension: `git ls-files | sed -n 's/.*\.//p' | sort | uniq -c | sort -rn | head -20` (outside a git repository, `find . -type f -not -path '*/.git/*' -not -path '*/node_modules/*'`). A language with only a handful of files (a build script, a fixture) needs no server.

## 2. Check what is there

For each language that matters, check both halves at once: `claude plugin list` for the plugin, `command -v <server>` for the server.

| Extensions | Plugin (`@claude-plugins-official`) | Server | Install the server |
| --- | --- | --- | --- |
| .ts .tsx .js .jsx .mjs .cjs | `typescript-lsp` | `typescript-language-server` | `npm i -g typescript-language-server typescript@6` |
| .py .pyi | `pyright-lsp` | `pyright-langserver` | `npm i -g pyright` |
| .rs | `rust-analyzer-lsp` | `rust-analyzer` | `brew install rust-analyzer` or `rustup component add rust-analyzer` |
| .go | `gopls-lsp` | `gopls` | `go install golang.org/x/tools/gopls@latest` |
| .swift | `swift-lsp` | `sourcekit-lsp` | Xcode, or `brew install swift` |
| .c .h .cpp .cc .hpp | `clangd-lsp` | `clangd` | Xcode command line tools (`xcode-select --install`); Linux: `apt install clangd` |
| .java | `jdtls-lsp` | `jdtls` | `brew install jdtls` |
| .kt .kts | `kotlin-lsp` | `kotlin-lsp` | `brew install JetBrains/utils/kotlin-lsp` |
| .cs | `csharp-lsp` | `csharp-ls` | `dotnet tool install -g csharp-ls` |
| .php | `php-lsp` | `intelephense` | `npm i -g intelephense` |
| .rb .rake .erb | `ruby-lsp` | `ruby-lsp` | `gem install ruby-lsp` |
| .lua | `lua-lsp` | `lua-language-server` | `brew install lua-language-server` |
| .md | lsp-plus (built in) | `marksman` | `brew install marksman` |
| .sql | lsp-plus (built in) | `postgres-language-server` | `brew install postgres-language-server` |

Markdown and SQL need no plugin: lsp-plus declares their servers itself.

## 3. Ask once, then install

Show the person one short list: per language, what is missing and the command that installs it. Installs change their machine (global npm packages, Homebrew formulas), so ask once for the whole list before running any of it. Then install:
- plugins: `claude plugin install <plugin>@claude-plugins-official --scope user`
- servers: the commands above. Without Homebrew (Linux), use the system's package manager or the server's own release; say which.

What goes wrong:
- **TypeScript 7** ships no `tsserver.js`, which `typescript-language-server` needs: install `typescript@6` alongside it, even if the project uses 7.
- **npm `EACCES`** on a global install: point npm at a user prefix (`npm config set prefix ~/.local`) and make sure `~/.local/bin` is on the `PATH`, rather than installing as root.
- **csharp-ls** 0.18 needs .NET 9; an older SDK fails at start.
- **clangd from Homebrew's llvm** is not on the `PATH` by itself: add `$(brew --prefix llvm)/bin`.
- A server installed into a directory the shell adds to the `PATH` only in interactive shells (`.zshrc`) may be invisible to Claude Code started from elsewhere: prefer `~/.local/bin`, `/opt/homebrew/bin` or `/usr/local/bin`.

## 4. Confirm

Claude Code reads a new plugin at session start, so tell the person to restart Claude Code once the installs are done. In the new session, one LSP question per language proves it: `documentSymbol` on a file of that language returns its outline. A server costs memory, not tokens (pyright about 440 MB, the TypeScript server up to 2 GB on a large repository) and starts on the first question.

End with a short table: language, plugin, server, and whether it is ready or what is left for the person to do.
