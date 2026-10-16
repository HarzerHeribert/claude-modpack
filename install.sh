#!/usr/bin/env bash
# claude-modpack: install the pack and set it up, in one guided run (macOS and Linux).
#
#   bash install.sh [--dry-run] [--yes] [--project DIR] [--scope user|project]
#                   [--setup guided|quick|later] [--help]
#
# Read it before you run it. It installs the pack with Claude Code's own plugin commands,
# shows every command that changes something before it runs it, asks before it installs
# anything on your system, and never uses sudo without asking. It keeps no log and writes
# no file of its own. Run it again at any time: it finds what is there and goes on from it.

MIN_VERSION=2.1.287     # the first Claude Code that runs mods at all
TESTED_VERSION=2.1.296  # the pack was tested on 2.1.296 to 2.1.301
NODE_MIN=22.13          # cells runs its cells with Node
REPO=HarzerHeribert/claude-modpack
MARKET=claude-modpack
OFFICIAL_REPO=anthropics/claude-plugins-official
OFFICIAL=claude-plugins-official
PACK="modpack statusline smart-compact delegate lsp-plus cells eta seek route"
SETUP_MD="https://github.com/$REPO/blob/main/SETUP.md"
INSTALL_DOCS="https://code.claude.com/docs/en/setup"
WORKER_RE='^(haiku|sonnet|opus):(low|medium|high|xhigh|max)$'
KEY_RE='^[A-Za-z0-9._~+/=:-]{8,}$'   # a key goes into JSON as is: nothing that needs escaping

usage() {
  cat <<EOF
Install claude-modpack and set it up, with each step explained as it goes.

Usage: bash install.sh [options]

  --dry-run         print every command that would change something, and run none of them
                    (only read-only checks run: versions, the plugin list)
  --yes, -y         ask nothing: install in user scope, skip the setup and print the next
                    step; route stays off
  --project DIR     the project to set up (default: the current folder)
  --scope SCOPE     user (default): for you, in every project
                    project: only in DIR, declared in DIR/.claude/settings.json
  --setup MODE      guided: Claude Code runs /modpack:setup with you (recommended)
                    quick:  this script asks the choices and does the steps itself
                    later:  print the command for later and stop
  --help, -h        this text

Exit codes: 0 done, 1 a step failed, 2 wrong usage, 3 cannot run here (Windows, no
Claude Code, or one older than $MIN_VERSION), 130 stopped with Ctrl-C.

Environment: NO_COLOR turns colours off.
EOF
}

# ---------------------------------------------------------------- options

DRY_RUN=0 YES=0 PROJECT="" SCOPE="" SETUP=""
usage_error() { printf 'install.sh: %s (see --help)\n' "$1" >&2; exit 2; }
while [ $# -gt 0 ]; do
  case $1 in
    --dry-run) DRY_RUN=1 ;;
    -y|--yes) YES=1 ;;
    --project) [ $# -ge 2 ] || usage_error "--project needs a folder"; PROJECT=$2; shift ;;
    --project=*) PROJECT=${1#*=} ;;
    --scope) [ $# -ge 2 ] || usage_error "--scope needs user or project"; SCOPE=$2; shift ;;
    --scope=*) SCOPE=${1#*=} ;;
    --setup) [ $# -ge 2 ] || usage_error "--setup needs guided, quick or later"; SETUP=$2; shift ;;
    --setup=*) SETUP=${1#*=} ;;
    -h|--help) usage; exit 0 ;;
    *) usage_error "unknown option: $1" ;;
  esac
  shift
done
case $SCOPE in ''|user|project) ;; *) usage_error "--scope is user or project, not '$SCOPE'" ;; esac
case $SETUP in ''|guided|quick|later) ;; *) usage_error "--setup is guided, quick or later, not '$SETUP'" ;; esac
if [ -n "$PROJECT" ] && [ ! -d "$PROJECT" ]; then usage_error "--project: no folder '$PROJECT'"; fi

# ---------------------------------------------------------------- output

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-dumb}" != dumb ]; then
  B=$'\033[1m' DIM=$'\033[2m' R=$'\033[0m' GRN=$'\033[32m' YEL=$'\033[33m' RED=$'\033[31m' CYN=$'\033[36m'
else
  B="" DIM="" R="" GRN="" YEL="" RED="" CYN=""
fi
case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in
  *UTF-8*|*utf-8*|*UTF8*|*utf8*) OK="✓" NO="✗" DOT="·" RULE="──" ;;
  *) OK="ok" NO="x" DOT="-" RULE="--" ;;
esac
WIDTH=$(tput cols 2>/dev/null || echo 80)
case $WIDTH in ''|*[!0-9]*) WIDTH=80 ;; esac
[ "$WIDTH" -gt 92 ] && WIDTH=92
[ "$WIDTH" -lt 40 ] && WIDTH=40

para() { printf '%s\n' "$*" | fold -s -w "$WIDTH"; }   # a paragraph, wrapped at word boundaries
blank() { printf '\n'; }
heading() { printf '\n%s%s %s %s%s\n' "$B" "$RULE" "$1" "$RULE" "$R"; }
good() { printf '  %s%s%s %s\n' "$GRN" "$OK" "$R" "$*"; }
bad() { printf '  %s%s%s %s\n' "$RED" "$NO" "$R" "$*"; }
warn() { printf '  %s!%s %s\n' "$YEL" "$R" "$*"; }
info() { printf '  %s%s%s %s\n' "$DIM" "$DOT" "$R" "$*"; }
note() { printf '    %s%s%s\n' "$DIM" "$*" "$R"; }

q() {  # one argument, quoted only when a shell would need it
  case $1 in
    '') printf "''" ;;
    *[!A-Za-z0-9_./:@=+,%^-]*) printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")" ;;
    *) printf '%s' "$1" ;;
  esac
}
show_line() { printf '  %s$%s %s\n' "$CYN" "$R" "$1"; }
show_cmd() { local out="" a; for a in "$@"; do out="$out${out:+ }$(q "$a")"; done; show_line "$out"; }

# run CMD...: a command that changes something. Shown first; not run under --dry-run.
run() {
  show_cmd "$@"
  if [ "$DRY_RUN" = 1 ]; then note "(dry run: not run)"; return 0; fi
  "$@" </dev/null
}

# configure PLUGIN JSON: set options the way `claude plugin configure --values-stdin` reads them.
configure() {
  show_line "printf '%s' $(q "$2") | claude plugin configure $1 --values-stdin"
  if [ "$DRY_RUN" = 1 ]; then note "(dry run: not run)"; return 0; fi
  printf '%s' "$2" | claude plugin configure "$1" --values-stdin
}

# ---------------------------------------------------------------- input

# Answers come from the terminal: stdin, or /dev/tty when the script itself arrives on stdin
# (curl ... | bash). With no terminal at all, every question takes its default.
HAVE_TTY=0
if [ -t 0 ]; then
  exec 3<&0; HAVE_TTY=1
elif (exec 3</dev/tty) 2>/dev/null; then
  exec 3</dev/tty
  [ -t 3 ] && HAVE_TTY=1
fi
ASK=$HAVE_TTY
[ "$YES" = 1 ] && ASK=0

# ask VAR QUESTION DEFAULT: the answer, or DEFAULT when it is empty or nobody can answer.
ask() {
  local _a=""
  if [ "$ASK" = 1 ]; then
    printf '%s%s%s ' "$B" "$2" "$R"
    IFS= read -r -u 3 _a || _a=""
  else
    printf '%s %s%s%s\n' "$2" "$DIM" "${3:-(empty)}" "$R"
  fi
  [ -n "$_a" ] || _a=$3
  printf -v "$1" '%s' "$_a"
}

# confirm QUESTION y|n: yes or no, with DEFAULT for an empty answer.
confirm() {
  local a hint="[y/N]" tries=0
  [ "$2" = y ] && hint="[Y/n]"
  while :; do
    ask a "$1 $hint" "$2"
    case $a in
      [Yy]|[Yy][Ee][Ss]) return 0 ;;
      [Nn]|[Nn][Oo]) return 1 ;;
    esac
    tries=$((tries + 1))
    [ "$tries" -ge 3 ] && { [ "$2" = y ]; return; }
    para "Please answer y or n."
  done
}

# choose VAR QUESTION DEFAULT WORD...: one of the words, by number or by name.
choose() {
  local var=$1 question=$2 def=$3 a i w tries=0
  shift 3
  while :; do
    ask a "$question [$def]" "$def"
    i=0
    for w in "$@"; do
      i=$((i + 1))
      if [ "$a" = "$i" ] || [ "$a" = "$w" ]; then printf -v "$var" '%s' "$w"; return 0; fi
    done
    tries=$((tries + 1))
    [ "$tries" -ge 3 ] && { printf -v "$var" '%s' "$def"; return 0; }
    para "Please answer with one of: $*."
  done
}

# ---------------------------------------------------------------- Ctrl-C

ROUTE_KEY=""
# shellcheck disable=SC2329  # called from the traps below
stopped() {
  trap - INT TERM
  [ "$HAVE_TTY" = 1 ] && stty echo <&3 2>/dev/null
  ROUTE_KEY=""
  printf '\n\n%sStopped.%s Nothing is left half-done: what finished stays, and the next run\n' "$B" "$R"
  printf 'finds it and goes on from there. Run the same command again to continue.\n'
  exit "$1"
}
trap 'stopped 130' INT
trap 'stopped 143' TERM

# ---------------------------------------------------------------- helpers

ver_num() { printf '%s\n' "$1" | sed -n 's/^[^0-9]*\([0-9][0-9]*\(\.[0-9][0-9]*\)*\).*/\1/p' | head -1; }
ver_ge() {  # ver_ge A B: A is B or newer
  local i x y a b
  IFS=. read -r -a a <<<"$1"
  IFS=. read -r -a b <<<"$2"
  for i in 0 1 2 3; do
    x=${a[$i]:-0} y=${b[$i]:-0}
    [ "$((10#$x))" -gt "$((10#$y))" ] && return 0
    [ "$((10#$x))" -lt "$((10#$y))" ] && return 1
  done
  return 0
}

# One line per plugin Claude Code lists here (in this folder, so project scope counts):
# "<id> <version> <scope> on|off". Parsed without jq.
list_plugins() {
  # shellcheck disable=SC2020  # each of , { } [ ] becomes a line break
  claude plugin list --json </dev/null 2>/dev/null | tr ',{}[]' '\n\n\n\n\n' | awk '
    function val(s) { sub(/^[^:]*:[ \t]*"?/, "", s); sub(/".*$/, "", s); gsub(/[ \t]/, "", s); return s }
    /"id"[ \t]*:/ { if (id != "") print id, v, sc, en; id = val($0); v = "-"; sc = "-"; en = "on" }
    /"version"[ \t]*:/ { v = val($0) }
    /"scope"[ \t]*:/ { sc = val($0) }
    /"enabled"[ \t]*:[ \t]*false/ { en = "off" }
    END { if (id != "") print id, v, sc, en }'
}
PLUGINS=""
refresh_plugins() { PLUGINS=$(list_plugins); }
plugin_field() {  # plugin_field ID N: field N (2 version, 3 scope, 4 on|off) or "missing"
  printf '%s\n' "$PLUGINS" | awk -v id="$1" -v n="$2" '$1 == id { print $n; f = 1; exit } END { if (!f) print "missing" }'
}
plugin_state() { plugin_field "$1" 4; }
marketplace_known() { claude plugin marketplace list --json </dev/null 2>/dev/null | grep -q "\"name\"[[:space:]]*:[[:space:]]*\"$1\""; }

# with_timeout SECONDS CMD...: CMD, stopped after SECONDS.
with_timeout() {
  local secs=$1 pid w rc
  shift
  "$@" &
  pid=$!
  ( i=0; while [ "$i" -lt "$secs" ]; do sleep 1; kill -0 "$pid" 2>/dev/null || exit 0; i=$((i + 1)); done
    kill "$pid" 2>/dev/null ) >/dev/null 2>&1 &
  w=$!
  wait "$pid"; rc=$?
  kill "$w" 2>/dev/null; wait "$w" 2>/dev/null
  return "$rc"
}

# The summary's rows: "mod|state|why|how to change".
ROWS=()
set_row() {
  local i
  for i in "${!ROWS[@]}"; do
    case ${ROWS[i]} in "$1|"*) ROWS[i]="$1|$2|$3|$4"; return ;; esac
  done
  ROWS[${#ROWS[@]}]="$1|$2|$3|$4"
}
print_rows() {
  local row mod state why how
  printf '  %s%-14s %-22s %s%s\n' "$B" "Mod" "State" "Why, or what is left" "$R"
  for row in "${ROWS[@]}"; do
    IFS='|' read -r mod state why how <<EOF
$row
EOF
    printf '  %-14s %-22s %s\n' "$mod" "$state" "$why"
    [ -n "$how" ] && printf '  %-14s %-22s %s%s%s\n' "" "" "$DIM" "change: $how" "$R"
  done
}

# ================================================================ 1. welcome

printf '%sclaude-modpack installer%s\n\n' "$B" "$R"
para "claude-modpack: Claude Code with fewer wasted steps, and a clear view of what it's doing. It is one plugin, the modpack, that installs, updates and switches eight mods: statusline, smart-compact, delegate, lsp-plus, cells, eta, seek and route."
blank
para "This script checks your machine, installs the pack with Claude Code's own plugin commands, then sets it up with you. Each command that changes something is shown before it runs."
blank
para "Nothing of yours leaves this machine. The pack asks GitHub once a day for a new release (you can turn that off), and route, which sends the start of each prompt to an outside classifier, stays off unless you turn it on."
[ "$DRY_RUN" = 1 ] && { blank; para "${YEL}Dry run:${R} commands that would change something are printed, not run."; }
if [ "$HAVE_TTY" = 0 ] && [ "$YES" = 0 ]; then
  blank; para "No terminal to answer questions in: taking the defaults (as with --yes)."
  YES=1
fi

# ================================================================ 2. checks

heading "1/4 Checks"
para "First what the pack needs: Claude Code $MIN_VERSION or newer, macOS or Linux, git, and a project to set up."
blank

ENV_OS=${OS:-}   # Windows_NT in Git Bash and MSYS2
OS=$(uname -s 2>/dev/null)
case $OS in MINGW*|MSYS*|CYGWIN*) ENV_OS=Windows_NT ;; esac
if [ "$ENV_OS" = Windows_NT ]; then
  bad "Windows ($OS): this script does not support it, and the pack is untested there."
  para "Install from inside Claude Code instead: type /plugin install modpack --marketplace $REPO, answer y, then type /modpack:setup."
  exit 3
fi
case $OS in
  Darwin) good "macOS ($(sw_vers -productVersion 2>/dev/null || uname -r))" ;;
  Linux) good "Linux ($(uname -r))" ;;
  *) warn "$OS: untested; the pack is tested on macOS and Linux. Going on." ;;
esac

if ! command -v claude >/dev/null 2>&1; then
  bad "Claude Code: no 'claude' on your PATH."
  para "Install Claude Code first ($INSTALL_DOCS), open a new terminal, and run this again."
  exit 3
fi
CLAUDE_VERSION=$(ver_num "$(claude --version </dev/null 2>/dev/null)")
if [ -z "$CLAUDE_VERSION" ]; then
  bad "Claude Code: 'claude --version' gave no version."
  para "Check that 'claude --version' works in this terminal, then run this again."
  exit 3
fi
if ! ver_ge "$CLAUDE_VERSION" "$MIN_VERSION"; then
  bad "Claude Code $CLAUDE_VERSION: mods need $MIN_VERSION or newer."
  if [ "$ASK" = 1 ] && confirm "Update Claude Code now (claude update)?" y; then
    run claude update
    CLAUDE_VERSION=$(ver_num "$(claude --version </dev/null 2>/dev/null)")
  fi
  if [ "$DRY_RUN" = 1 ] || ! ver_ge "$CLAUDE_VERSION" "$MIN_VERSION"; then
    para "Update it with 'claude update', then run this again."
    exit 3
  fi
fi
if ver_ge "$CLAUDE_VERSION" "$TESTED_VERSION"; then
  good "Claude Code $CLAUDE_VERSION"
else
  warn "Claude Code $CLAUDE_VERSION runs mods, but the pack was tested on $TESTED_VERSION and newer: 'claude update' is worth it."
fi

if command -v git >/dev/null 2>&1; then
  good "git $(ver_num "$(git --version 2>/dev/null)")"
  HAVE_GIT=1
else
  warn "git: not found. delegate's diffs and lsp-plus's warm-up need it (macOS: xcode-select --install)."
  HAVE_GIT=0
fi

NODE_VERSION=""
command -v node >/dev/null 2>&1 && NODE_VERSION=$(ver_num "$(node --version 2>/dev/null)")
if [ -n "$NODE_VERSION" ] && ver_ge "$NODE_VERSION" "$NODE_MIN"; then
  good "Node $NODE_VERSION (cells runs its cells with it; language servers from npm need it)"
elif [ -n "$NODE_VERSION" ]; then
  warn "Node $NODE_VERSION: cells needs $NODE_MIN or later and stays off until then. Not needed for the install."
else
  info "Node: not found. cells needs $NODE_MIN or later and stays off without it; language servers from npm need it too. Not needed for the install."
fi
if [ "$OS" = Linux ]; then
  info "On Linux, cells also needs bubblewrap (or Node 25 or later): the quick setup checks it."
fi

for f in "/Library/Application Support/ClaudeCode/managed-settings.json" /etc/claude-code/managed-settings.json; do
  if [ -f "$f" ]; then
    info "An organization manages Claude Code here ($f): a few parts of the mods (the hook guard among them) do not run under it."
  fi
done

# The project: the current folder unless --project; it should be a git repository.
[ -n "$PROJECT" ] || PROJECT=$PWD
cd "$PROJECT" || usage_error "cannot open '$PROJECT'"
PROJECT=$PWD
IS_REPO=0
[ "$HAVE_GIT" = 1 ] && [ "$(git rev-parse --is-inside-work-tree 2>/dev/null)" = true ] && IS_REPO=1
[ "$HAVE_GIT" = 0 ] && info "Project: $PROJECT (without git, not checked)"
while [ "$IS_REPO" = 0 ] && [ "$HAVE_GIT" = 1 ]; do
  warn "Project: $PROJECT is not a git repository. delegate's diffs and lsp-plus's warm-up need one, with a commit."
  [ "$ASK" = 1 ] || break
  ask other "Press Enter to set up this folder anyway, or type another folder's path:" ""
  [ -n "$other" ] || break
  case $other in "~"/*) other=$HOME/${other#"~/"} ;; esac
  if [ -d "$other" ] && cd "$other"; then
    PROJECT=$PWD
    [ "$(git rev-parse --is-inside-work-tree 2>/dev/null)" = true ] && IS_REPO=1
  else
    para "No folder '$other'."
  fi
done
if [ "$IS_REPO" = 1 ]; then
  if git log -1 --oneline >/dev/null 2>&1; then
    good "Project: $PROJECT (a git repository)"
  else
    warn "Project: $PROJECT is a git repository with no commit yet: lsp-plus's warm-up waits for the first."
  fi
fi

refresh_plugins
MISSING="" DISABLED=""
for p in $PACK; do
  case $(plugin_state "$p@$MARKET") in
    missing) MISSING="$MISSING $p" ;;
    off) DISABLED="$DISABLED $p" ;;
  esac
done
MISSING=${MISSING# } DISABLED=${DISABLED# }
INSTALLED_VERSION=$(plugin_field "modpack@$MARKET" 2)
INSTALLED_SCOPE=$(plugin_field "modpack@$MARKET" 3)
if [ -z "$MISSING" ] && [ -z "$DISABLED" ]; then
  good "The pack is installed: modpack $INSTALLED_VERSION and its eight mods ($INSTALLED_SCOPE scope)."
  STATE=installed
elif [ "$MISSING" = "$PACK" ]; then
  info "The pack: not installed yet."
  STATE=fresh
else
  partly="The pack is partly installed."
  [ -n "$MISSING" ] && partly="$partly Missing: $MISSING."
  [ -n "$DISABLED" ] && partly="$partly Disabled in the plugin list: $DISABLED."
  warn "$partly"
  STATE=partial
fi
[ "$(plugin_state "modpack@inline")" != missing ] && info "A modpack loaded from a folder (--plugin-dir or CLAUDE_CODE_PLUGIN_DIRS) takes the installed one's place in those sessions."

# ================================================================ 3. install

heading "2/4 Install"
FAILED=0

# The newest release, as the modpack's own update does it: refresh the marketplace's copy, then
# update the modpack and each mod; a mod that is not installed (new in a release) is installed.
update_pack() {
  para "Claude Code refreshes its copy of the marketplace, then updates the modpack and each mod; a mod that is not installed yet is installed. A newer version loads the next time Claude Code starts."
  run claude plugin marketplace update "$MARKET" || return 1
  local m
  for m in $PACK; do
    if [ "$(plugin_state "$m@$MARKET")" = missing ]; then
      run claude plugin install "$m@$MARKET" --scope "$SCOPE" || return 1
    else
      run claude plugin update "$m@$MARKET" || return 1
    fi
  done
}

if [ "$STATE" = installed ]; then
  SCOPE=${INSTALLED_SCOPE:-user}
  para "Already installed, so there is nothing to add. You can look for a newer release now; the pack also does that by itself once a day."
  if confirm "Look for a newer release and install it?" y; then
    if ! update_pack; then
      bad "The update failed (Claude Code's message is above). Your installed version keeps working; /modpack:update in Claude Code tries again."
      FAILED=1
    fi
  fi
else
  HAS_MODPACK=0
  [ "$(plugin_state "modpack@$MARKET")" != missing ] && HAS_MODPACK=1 SCOPE=${INSTALLED_SCOPE:-user}
  KNOWN=0
  marketplace_known "$MARKET" && KNOWN=1
  if [ -z "$SCOPE" ]; then
    para "Where should the pack be installed?"
    info "1) user: for you, in every project (most people want this)"
    info "2) project: only in $PROJECT, declared in its .claude/settings.json, so Claude Code offers it to anyone who opens this project"
    choose SCOPE "Scope:" user user project
  fi
  para "The marketplace tells Claude Code where the pack comes from: its GitHub repository, $REPO. Adding it again is harmless."
  if ! run claude plugin marketplace add "$REPO" --scope "$SCOPE"; then
    bad "Adding the marketplace failed (Claude Code's message is above). Nothing else was changed."
    para "Check your network and run this again, or install from inside Claude Code: /plugin install modpack --marketplace $REPO"
    exit 1
  fi
  if [ "$HAS_MODPACK" = 1 ]; then
    para "The pack is partly installed: an older release, or a run that stopped. This brings it to the newest release and adds what is missing."
    if ! update_pack; then
      bad "Finishing the install failed (Claude Code's message is above). What is installed keeps working; run this again to continue."
      exit 1
    fi
  else
    if [ "$KNOWN" = 1 ]; then
      para "Claude Code already had this marketplace, so its copy may be old: refreshing it first, so the newest release installs."
      run claude plugin marketplace update "$MARKET" || FAILED=1
    fi
    para "Now the modpack plugin. Claude Code installs its eight mods with it, as its dependencies."
    if ! run claude plugin install "modpack@$MARKET" --scope "$SCOPE"; then
      bad "Installing the modpack failed (Claude Code's message is above)."
      para "Run this again to continue, or install from inside Claude Code: /plugin install modpack --marketplace $REPO"
      exit 1
    fi
    note "If Claude Code says some options are not set yet: each keeps its default until you change it."
  fi
  if [ "$DRY_RUN" = 0 ]; then refresh_plugins; fi
  for p in $PACK; do
    [ "$DRY_RUN" = 1 ] && [ "$STATE" = fresh ] && break
    case $(plugin_state "$p@$MARKET") in
      missing) [ "$DRY_RUN" = 1 ] && continue   # update_pack showed its install already
               para "$p is still missing: installing it on its own."
               run claude plugin install "$p@$MARKET" --scope "$SCOPE" || FAILED=1 ;;
      off) para "$p is disabled in Claude Code's plugin list: enabling it (to switch a mod off later, use /mods $p off)."
           run claude plugin enable "$p@$MARKET" || FAILED=1 ;;
    esac
  done
  if [ "$FAILED" = 1 ]; then
    bad "Some of the pack did not install (Claude Code's message is above). Run this again to continue."
    exit 1
  fi
  [ "$DRY_RUN" = 0 ] && refresh_plugins
  if [ "$DRY_RUN" = 1 ]; then
    info "(dry run) the pack would now be installed, $SCOPE scope."
  else
    good "Installed: modpack $(plugin_field "modpack@$MARKET" 2) and its eight mods ($SCOPE scope)."
  fi
fi

# ================================================================ 4. setup

heading "3/4 Setup"
if [ -z "$SETUP" ]; then
  if [ "$YES" = 1 ]; then
    SETUP=later
  else
    para "Each mod has a few choices (where the status line goes, language servers for your project's languages, route on or off), and some need a restart to load. Pick how to set them up:"
    info "1) guided: Claude Code starts in this project with /modpack:setup and does it with you: it checks, asks once, sets each mod up, restarts once and confirms each one works (recommended)"
    info "2) quick: this script asks the choices here, does the steps it can, and proves each mod with a short claude -p run"
    info "3) later: print the command, and stop here"
    choose SETUP "Setup:" guided guided quick later
  fi
fi

SETUP_RESULT=""
LAUNCH="cd $(q "$PROJECT") && claude \"/modpack:setup\""

guided_setup() {
  para "Claude Code now starts in $PROJECT with /modpack:setup as its first message. It reads your machine, asks a few questions in one message, sets the mods up in order (route only if you say yes), then asks you to quit and restart it once, with claude --continue, which keeps the conversation."
  show_line "$LAUNCH"
  if [ "$DRY_RUN" = 1 ]; then note "(dry run: not run)"; SETUP_RESULT="guided (dry run)"; return; fi
  if [ "$HAVE_TTY" = 0 ]; then
    para "There is no terminal here to run Claude Code in. At one, run the line above."
    SETUP_RESULT="later"; return
  fi
  trap ':' INT   # Ctrl-C belongs to Claude Code while it runs
  claude "/modpack:setup" <&3
  local rc=$?
  trap 'stopped 130' INT
  [ "$rc" = 0 ] || warn "Claude Code ended with exit code $rc."
  blank
  para "If the setup asked you to restart Claude Code, start it again here with claude --continue: the same conversation goes on and confirms each mod."
  if confirm "Start it again with claude --continue?" y; then
    show_line "claude --continue"
    trap ':' INT
    claude --continue <&3
    trap 'stopped 130' INT
  fi
  SETUP_RESULT="guided"
}

# ---------------------------------------------------------------- quick setup

lang_info() {  # lang_info KEY: sets LI_NAME LI_PLUGIN LI_SERVER LI_CMD LI_HINT
  LI_PLUGIN="" LI_CMD="" LI_HINT=""
  case $1 in
    ts) LI_NAME="TypeScript/JavaScript" LI_PLUGIN=typescript-lsp LI_SERVER=typescript-language-server LI_CMD="npm i -g typescript-language-server typescript@6" ;;
    py) LI_NAME=Python LI_PLUGIN=pyright-lsp LI_SERVER=pyright-langserver LI_CMD="npm i -g pyright" ;;
    rs) LI_NAME=Rust LI_PLUGIN=rust-analyzer-lsp LI_SERVER=rust-analyzer
        if [ "$OS" = Darwin ]; then LI_CMD="brew install rust-analyzer"; else LI_CMD="rustup component add rust-analyzer"; fi ;;
    go) LI_NAME=Go LI_PLUGIN=gopls-lsp LI_SERVER=gopls LI_CMD="go install golang.org/x/tools/gopls@latest" ;;
    swift) LI_NAME=Swift LI_PLUGIN=swift-lsp LI_SERVER=sourcekit-lsp LI_HINT="comes with Xcode (or the swift.org toolchain on Linux)" ;;
    c) LI_NAME="C/C++" LI_PLUGIN=clangd-lsp LI_SERVER=clangd
       if [ "$OS" = Darwin ]; then LI_HINT="comes with Xcode's command line tools: xcode-select --install"
       elif command -v apt-get >/dev/null 2>&1; then LI_CMD="sudo apt install clangd"
       else LI_HINT="install clangd with your package manager"; fi ;;
    java) LI_NAME=Java LI_PLUGIN=jdtls-lsp LI_SERVER=jdtls LI_CMD="brew install jdtls" ;;
    kt) LI_NAME=Kotlin LI_PLUGIN=kotlin-lsp LI_SERVER=kotlin-lsp LI_CMD="brew install JetBrains/utils/kotlin-lsp" ;;
    cs) LI_NAME="C#" LI_PLUGIN=csharp-lsp LI_SERVER=csharp-ls LI_CMD="dotnet tool install -g csharp-ls" ;;
    php) LI_NAME=PHP LI_PLUGIN=php-lsp LI_SERVER=intelephense LI_CMD="npm i -g intelephense" ;;
    rb) LI_NAME=Ruby LI_PLUGIN=ruby-lsp LI_SERVER=ruby-lsp LI_CMD="gem install ruby-lsp" ;;
    lua) LI_NAME=Lua LI_PLUGIN=lua-lsp LI_SERVER=lua-language-server LI_CMD="brew install lua-language-server" ;;
    md) LI_NAME=Markdown LI_SERVER=marksman LI_CMD="brew install marksman" ;;
    sql) LI_NAME=SQL LI_SERVER=postgres-language-server LI_CMD="brew install postgres-language-server" ;;
    sh) LI_NAME=Shell LI_SERVER=bash-language-server LI_CMD="npm i -g bash-language-server" ;;
    tf) LI_NAME=Terraform LI_SERVER=terraform-ls LI_CMD="brew install hashicorp/tap/terraform-ls" ;;
  esac
  if [ -n "$LI_CMD" ]; then  # the tool the install needs must be here
    local tool=${LI_CMD%% *}
    [ "$tool" = sudo ] && tool=$(printf '%s\n' "$LI_CMD" | awk '{ print $2 }')
    if ! command -v "$tool" >/dev/null 2>&1; then
      LI_HINT="needs $tool, which is not here: $LI_CMD"
      [ "$tool" = brew ] && [ "$OS" != Darwin ] && LI_HINT="install $LI_SERVER with your package manager or from its releases"
      LI_CMD=""
    fi
  fi
}

# The project's languages with five files or more: "<count> <key>", most first.
detect_languages() {
  { if [ "$IS_REPO" = 1 ]; then git ls-files 2>/dev/null
    else find . -type f -not -path '*/.git/*' -not -path '*/node_modules/*' 2>/dev/null | head -50000; fi; } |
  sed -n 's/.*\.\([A-Za-z0-9]*\)$/\1/p' | awk '
    { e = tolower($0); k = "" }
    e ~ /^(ts|tsx|js|jsx|mjs|cjs)$/ { k = "ts" }  e ~ /^(py|pyi)$/ { k = "py" }  e == "rs" { k = "rs" }
    e == "go" { k = "go" }  e == "swift" { k = "swift" }  e ~ /^(c|h|cpp|cc|hpp)$/ { k = "c" }
    e == "java" { k = "java" }  e ~ /^(kt|kts)$/ { k = "kt" }  e == "cs" { k = "cs" }  e == "php" { k = "php" }
    e ~ /^(rb|rake|erb)$/ { k = "rb" }  e == "lua" { k = "lua" }  e == "md" { k = "md" }  e == "sql" { k = "sql" }
    e ~ /^(sh|bash)$/ { k = "sh" }  e ~ /^(tf|tfvars)$/ { k = "tf" }
    k != "" { n[k]++ }
    END { for (k in n) if (n[k] >= 5) print n[k], k }' | sort -rn
}

# claude -p run that proves a mod works: its whole stream (with tool results) in CHECK_OUT.
CHECK_OUT=""
p_check() {  # p_check ALLOWED_TOOL PROMPT (--allowedTools takes several values: it goes first, the prompt last)
  CHECK_OUT=""
  show_cmd claude -p --allowedTools "$1" --output-format stream-json --verbose --no-session-persistence --max-budget-usd 1 "$2"
  if [ "$DRY_RUN" = 1 ]; then note "(dry run: not run)"; return 0; fi
  CHECK_OUT=$(with_timeout 300 claude -p --allowedTools "$1" --output-format stream-json --verbose \
    --no-session-persistence --max-budget-usd 1 "$2" </dev/null 2>&1)
  return 0
}
has() { case $CHECK_OUT in *"$1"*) return 0 ;; esac; return 1; }
not_logged_in() { has "Not logged in" || has "Please run /login" || has "Invalid API key"; }

quick_setup() {
  para "Six short questions, then the script does what it can itself and shows what is left. Press Enter to take the default in brackets."

  # -- statusline
  blank
  para "${B}statusline${R} draws one line: the model and its effort, how full the context is, and your plan's 5-hour and 7-day use. Other mods add to it."
  info "1) line: under the prompt, sharing Claude Code's hint row"
  info "2) tail: appended, dim, to Claude Code's hint"
  info "3) band: above the prompt, on a row of its own"
  info "4) off: nowhere (other mods' segments then show nowhere either)"
  choose PLACEMENT "Where should it go?" line line tail band off

  # -- updates
  blank
  para "${B}Updates${R}: once a day the modpack asks GitHub for a new release. auto installs it in the background (it loads at the next start); notify only says one is out; off makes no request at all."
  choose UPDATES "Updates:" auto auto notify off

  # -- language servers
  blank
  para "${B}Language servers${R}: Claude Code's LSP tool, which lsp-plus, cells and delegate build on, needs per language an official plugin and the server itself. Without them the mods still work, but symbol questions fall back to grep."
  local langs count key plugin_todo="" server_todo="" sudo_todo="" left="" pst sst c IFS_SAVE=$IFS
  langs=$(detect_languages)
  if [ -z "$langs" ]; then
    info "No language with five files or more in $PROJECT: nothing to add."
  fi
  while read -r count key; do
    [ -n "$key" ] || continue
    lang_info "$key"
    pst=""; sst=""
    if [ -n "$LI_PLUGIN" ]; then
      if [ "$(plugin_state "$LI_PLUGIN@$OFFICIAL")" = on ]; then pst="plugin $LI_PLUGIN $OK"
      else pst="plugin $LI_PLUGIN missing"; plugin_todo="$plugin_todo $LI_PLUGIN"; fi
    else
      pst="plugin: lsp-plus has it"
    fi
    if command -v "$LI_SERVER" >/dev/null 2>&1; then
      sst="server $LI_SERVER $OK"
    elif [ -n "$LI_CMD" ]; then
      sst="server missing: $LI_CMD"
      case $LI_CMD in sudo\ *) sudo_todo="$sudo_todo|$LI_CMD" ;; *) server_todo="$server_todo|$LI_CMD" ;; esac
    else
      sst="server missing: $LI_HINT"
      left="$left${left:+; }$LI_NAME: $LI_HINT"
    fi
    info "$LI_NAME ($count files): $pst; $sst"
  done <<EOF
$langs
EOF
  plugin_todo=${plugin_todo# } server_todo=${server_todo#|} sudo_todo=${sudo_todo#|}
  local do_plugins=0 do_servers=0 sudo_ok=""
  if [ -n "$plugin_todo" ]; then
    para "The plugins are Claude Code plugins from Anthropic's official marketplace (no system packages): $plugin_todo."
    confirm "Install them?" y && do_plugins=1
  fi
  if [ -n "$server_todo" ]; then
    para "The servers are programs installed on your system, with these commands:"
    IFS='|'; for c in $server_todo; do show_line "$c"; done; IFS=$IFS_SAVE
    confirm "Run them?" n && do_servers=1
  fi
  if [ -n "$sudo_todo" ]; then
    IFS='|'
    for c in $sudo_todo; do
      IFS=$IFS_SAVE
      para "This one needs sudo, which asks for your password:"
      show_line "$c"
      confirm "Run it?" n && sudo_ok="$sudo_ok|$c"
      IFS='|'
    done
    IFS=$IFS_SAVE
    sudo_ok=${sudo_ok#|}
  fi

  # -- cells' sandbox
  local cells_state="on" cells_why="" cells_fix=""
  if [ "$OS" = Darwin ]; then
    if [ -x /usr/bin/sandbox-exec ]; then cells_why="Seatbelt, built into macOS"; else cells_state="off"; cells_why="no /usr/bin/sandbox-exec"; fi
  elif [ "$OS" = Linux ]; then
    blank
    para "${B}cells${R} runs each cell in a sandbox that closes the network: on Linux that is bubblewrap, or Node 25 or later."
    if command -v bwrap >/dev/null 2>&1 && bwrap --unshare-all --ro-bind / / true >/dev/null 2>&1; then
      good "bubblewrap starts a sandbox here."
      cells_why="bubblewrap"
    elif [ -n "$NODE_VERSION" ] && ver_ge "$NODE_VERSION" 25; then
      good "Node $NODE_VERSION closes the network by itself (signals stay open)."
      cells_why="Node's sandbox only: signals open"
    elif command -v bwrap >/dev/null 2>&1; then
      warn "bubblewrap is here but cannot start a sandbox (often Ubuntu 24.04's AppArmor rule): SETUP.md step 5 has the fix, or use Node 25 or later."
      cells_state="off"; cells_why="bwrap refused; see SETUP.md step 5"
    else
      if command -v apt-get >/dev/null 2>&1; then cells_fix="sudo apt install bubblewrap"
      elif command -v dnf >/dev/null 2>&1; then cells_fix="sudo dnf install bubblewrap"
      elif command -v pacman >/dev/null 2>&1; then cells_fix="sudo pacman -S bubblewrap"; fi
      if [ -n "$cells_fix" ]; then
        para "bubblewrap is missing. This installs it, with sudo, which asks for your password:"
        show_line "$cells_fix"
        confirm "Run it?" n || cells_fix=""
      fi
      [ -n "$cells_fix" ] || { cells_state="off"; cells_why="no sandbox: install bubblewrap, or Node 25 or later"; }
    fi
  fi
  if [ -z "$NODE_VERSION" ] || ! ver_ge "$NODE_VERSION" "$NODE_MIN"; then
    cells_state="off"; cells_why="needs Node $NODE_MIN or later on the PATH (brew install node, nvm install 22)"
  fi

  # -- delegate
  blank
  para "${B}delegate${R} hands big, specified work to a cheaper worker: Haiku for read and mechanical work, Sonnet for build work. Those are the measured defaults; most people keep them."
  local read_w=haiku:low mech_w=haiku:low build_w=sonnet:medium workers_json=""
  if ! confirm "Keep them?" y; then
    local w
    for w in read mechanical build; do
      local def=$read_w
      [ "$w" = mechanical ] && def=$mech_w
      [ "$w" = build ] && def=$build_w
      local v="" tries=0
      while :; do
        ask v "Worker for $w work, as model:effort (haiku, sonnet, opus : low, medium, high, xhigh, max) [$def]" "$def"
        [[ $v =~ $WORKER_RE ]] && break
        tries=$((tries + 1)); [ "$tries" -ge 3 ] && { v=$def; break; }
        para "For example sonnet:high."
      done
      case $w in read) read_w=$v ;; mechanical) mech_w=$v ;; build) build_w=$v ;; esac
    done
    workers_json="{\"readWorker\":\"$read_w\",\"mechanicalWorker\":\"$mech_w\",\"buildWorker\":\"$build_w\"}"
  fi

  # -- route
  blank
  para "${B}route${R} is off unless you want it. When on, the start of each prompt you send goes to an outside classifier (TypeSafe's Jev or ScaleDown, US services), and feature or test requests are then handed to delegate's cheaper worker before Claude reads the code."
  local route_want=0 route_field="" route_service="" route_key_set=0
  if confirm "Hear the details and decide on route now?" n; then
    blank
    para "${B}What route does.${R} For each prompt you send, route asks a fast outside classifier what kind of work it is; only feature or test work gets the order to hand it to delegate's worker. Measured: a TypeScript feature 51% cheaper and 42% faster than the pack alone, writing tests 36% cheaper, all results correct. Everything else stays with Claude."
    para "${B}What leaves your machine:${R} the first 8,000 characters of each prompt you send, typed, from the phone, or through claude -p; for most prompts that is the whole prompt, pasted text included. Not slash commands, and not replies under 40 characters. Nothing else: no files, no code Claude reads, no answers."
    para "${B}To whom:${R} the classifier you pick, a US service. TypeSafe keeps inputs as long as it needs them and never trains on them. ScaleDown's terms promise zero retention. Each service's own terms have the details."
    para "${B}What it costs:${R} each prompt starts about 0.3 s later with Jev, about 1 s with ScaleDown, at most 3 s. The service charges its own fee per prompt, about \$0.00002 to \$0.00003, measured."
    para "${B}How to stop:${R} /mods route off in Claude Code, at once; nothing leaves after that."
    para "Leave it off if you work in the Claude desktop app's auto mode: delegate cannot start workers there, so route's order would only be refused."
    blank
    info "1) Jev (TypeSafe): 0.25 s median, measured. Keys: https://docs.typesafe.ai/introduction/quickstart"
    info "2) ScaleDown: 1.15 s median. Keys: https://docs.scaledown.ai/api-reference/classify"
    local svc
    choose svc "Which classifier?" jev jev scaledown
    if [ "$svc" = jev ]; then route_field=typesafeKey route_service="Jev (TypeSafe)"
    else route_field=scaledownKey route_service=ScaleDown; fi
    local yes=""
    ask yes "Turn route on, with the start of each prompt sent to $route_service? Type yes to agree; anything else keeps it off:" "no"
    case $yes in [Yy][Ee][Ss]|[Yy]) route_want=1 ;; esac
    if [ "$route_want" = 1 ]; then
      para "Make a key on the service's own site, then paste it here and press Enter. Nothing shows while you do. It goes straight to Claude Code's secure storage (the macOS Keychain; ~/.claude/.credentials.json where there is none), and this script never shows, logs or writes it. Press Enter alone to add it later in Claude Code with /plugin configure route@$MARKET."
      if [ "$DRY_RUN" = 1 ]; then
        note "(dry run: the key is not asked for)"
        route_key_set=2
      elif [ "$ASK" = 1 ]; then
        printf '%sKey (hidden):%s ' "$B" "$R"
        IFS= read -r -s -u 3 ROUTE_KEY || ROUTE_KEY=""
        printf '\n'
        ROUTE_KEY=${ROUTE_KEY#"${ROUTE_KEY%%[![:space:]]*}"}   # spaces a paste brought along, before and after
        ROUTE_KEY=${ROUTE_KEY%"${ROUTE_KEY##*[![:space:]]}"}
        if [ -n "$ROUTE_KEY" ]; then
          if [[ ! $ROUTE_KEY =~ $KEY_RE ]]; then
            ROUTE_KEY=""
            warn "That does not look like a key (letters, digits and . _ ~ + / = : - only), so it was not stored. Use /plugin configure route@$MARKET in Claude Code instead."
          else
            show_line "printf '{\"$route_field\":\"%s\"}' <the key, hidden> | claude plugin configure route@$MARKET --values-stdin"
            local out
            out=$(printf '{"%s":"%s"}' "$route_field" "$ROUTE_KEY" | claude plugin configure "route@$MARKET" --values-stdin 2>&1)
            local rc=$?
            case $out in *"$ROUTE_KEY"*) out="(Claude Code's answer is not shown: it held the key)" ;; esac
            ROUTE_KEY=""
            printf '    %s\n' "$out"
            if [ "$rc" = 0 ] && claude plugin configure "route@$MARKET" </dev/null 2>/dev/null | grep -q "$route_field .*sensitive, set"; then
              good "The key is stored (Claude Code lists it as set, never its value)."
              route_key_set=1
            else
              warn "The key was not stored. Use /plugin configure route@$MARKET in Claude Code instead."
            fi
          fi
        fi
      fi
    fi
    ROUTE_KEY=""
  fi

  # -- checks
  blank
  para "${B}Checks${R}: three short claude -p runs prove that the mods work here: a one-line cell (cells), a grep the language server should answer (lsp-plus), and one small read hand-off to a Haiku worker (delegate). Each is capped at \$1 with --max-budget-usd; on a subscription they count against your plan's limits."
  local do_checks=0
  if [ "$YES" = 1 ]; then
    info "Checks: skipped (--yes)."
  elif confirm "Run the checks?" y; then
    do_checks=1
  fi

  # ---- now do it
  blank
  para "${B}Setting it up.${R} Options set from a terminal load the next time Claude Code starts."
  [ "$PLACEMENT" = line ] || configure "statusline@$MARKET" "{\"placement\":\"$PLACEMENT\"}" || FAILED=1
  [ "$UPDATES" = auto ] || configure "modpack@$MARKET" "{\"updates\":\"$UPDATES\"}" || FAILED=1
  [ -n "$workers_json" ] && { configure "delegate@$MARKET" "$workers_json" || FAILED=1; }
  if [ "$do_plugins" = 1 ]; then
    if ! marketplace_known "$OFFICIAL"; then
      para "Anthropic's official marketplace is not added here yet: adding it."
      run claude plugin marketplace add "$OFFICIAL_REPO" || FAILED=1
    fi
    local p
    for p in $plugin_todo; do run claude plugin install "$p@$OFFICIAL" --scope user || FAILED=1; done
  fi
  if [ "$do_servers" = 1 ]; then
    IFS='|'
    for c in $server_todo; do IFS=$IFS_SAVE; show_line "$c"
      if [ "$DRY_RUN" = 1 ]; then note "(dry run: not run)"; else sh -c "$c" </dev/null || { warn "That failed: see its message above (SETUP.md step 6 lists what goes wrong)."; FAILED=1; }; fi
      IFS='|'; done
    IFS=$IFS_SAVE
  fi
  if [ -n "$sudo_ok" ]; then
    IFS='|'
    for c in $sudo_ok; do IFS=$IFS_SAVE; show_line "$c"
      if [ "$DRY_RUN" = 1 ]; then note "(dry run: not run)"; else sh -c "$c" <&3 || { warn "That failed: see its message above."; FAILED=1; }; fi
      IFS='|'; done
    IFS=$IFS_SAVE
  fi
  if [ -n "$cells_fix" ]; then
    show_line "$cells_fix"
    if [ "$DRY_RUN" = 1 ]; then note "(dry run: not run)"
    elif sh -c "$cells_fix" <&3 && bwrap --unshare-all --ro-bind / / true >/dev/null 2>&1; then cells_why="bubblewrap"
    else cells_state="off"; cells_why="bubblewrap did not start a sandbox; see SETUP.md step 5"; FAILED=1; fi
  fi

  # Which languages now have a server (and their plugin).
  local servers_ready=""
  while read -r count key; do
    [ -n "$key" ] || continue
    lang_info "$key"
    command -v "$LI_SERVER" >/dev/null 2>&1 || { [ "$DRY_RUN" = 1 ] && [ "$do_servers" = 1 ] && [ -n "$LI_CMD" ]; } || continue
    servers_ready="$servers_ready${servers_ready:+, }$LI_NAME"
  done <<EOF
$langs
EOF

  # Rows before the checks fill them in.
  set_row statusline "on, $PLACEMENT" "shows after Claude's first answer" "/config statusline.placement=line|tail|band|off"
  set_row smart-compact "on, smart" "keeps an idle session's cache warm, or compacts" "/mods smart-compact off"
  set_row eta "on" "a progress row above the prompt for long jobs" "/mods eta off"
  set_row cells "$cells_state" "${cells_why:-not checked}" "/cells:setup"
  local lsp_why
  if [ -n "$servers_ready" ]; then lsp_why="servers: $servers_ready"; else lsp_why="no language server yet: greps stay plain"; fi
  [ -n "$left" ] && lsp_why="$lsp_why; left: $left"
  set_row lsp-plus "on" "$lsp_why" "/lsp-plus:setup"
  set_row delegate "on" "workers $read_w, $mech_w, $build_w; not checked" "/config delegate.buildWorker=sonnet:high, /delegate:setup"
  set_row seek "on" "its setting rides beside your first prompt" "/mods seek off"
  if [ "$route_want" = 1 ]; then set_row route "off" "you said yes; waits for a working hand-off" "/mods route on, /route:setup"
  else set_row route "off" "your choice (off is its default)" "/route:setup"; fi
  set_row modpack "updates $UPDATES" "hook guard on" "/config modpack.updates=auto|notify|off"

  if [ "$do_checks" = 1 ]; then
    blank
    para "${B}Checking.${R} Each run starts Claude Code without a window in $PROJECT; each takes up to a minute or two."
    local logged_in=1
    # cells
    if [ "$cells_state" = on ]; then
      p_check mcp__cells__run_cell "Call the run_cell tool once, with the code: return 1. Then reply with the word done."
      if [ "$DRY_RUN" = 1 ]; then :
      elif not_logged_in; then logged_in=0
      elif has "## Output"; then good "cells: a cell ran."; set_row cells on "${cells_why:+$cells_why; }a cell ran" "/cells:setup"
      else
        local why
        why=$(printf '%s\n' "$CHECK_OUT" | grep -o 'cells is off: [^".]*' | head -1)
        bad "cells: no cell ran.${why:+ $why}"
        set_row cells off "${why:-the check ran no cell}" "/cells:setup"
      fi
    fi
    # lsp-plus
    if [ "$logged_in" = 1 ] && [ -n "$servers_ready" ] && [ "$IS_REPO" = 1 ]; then
      p_check "Bash(git grep *)" "In this repository, pick a function that is defined in one file and called from another file, with a plain name of three characters or more. Run exactly git grep -n -w <name> once, with the Bash tool. Then reply with the name only."
      if [ "$DRY_RUN" = 1 ]; then :
      elif not_logged_in; then logged_in=0
      elif has "per the language server"; then good "lsp-plus: the grep came back with the language server's answer."
        set_row lsp-plus on "$lsp_why; a grep came back with the server's answer" "/lsp-plus:setup"
      else bad "lsp-plus: the grep came back without the server's answer (/lsp-plus:setup, its step 6, says why)."
        set_row lsp-plus on "$lsp_why; the grep check got no server answer" "/lsp-plus:setup"
      fi
    fi
    # delegate
    local delegate_ok=0
    if [ "$logged_in" = 1 ]; then
      p_check mcp__delegate__hand_off "Call the hand_off tool once, with kind read and this task: List the top-level files and folders of this repository and say in one sentence what the project is. Then reply with the last line of the tool's result."
      if [ "$DRY_RUN" = 1 ]; then :
      elif not_logged_in; then logged_in=0
      elif has "Not handed off" || has "did not start" || has "delegate is turned off"; then
        bad "delegate: the hand-off did not run."; set_row delegate on "the hand-off check did not run a worker" "/delegate:setup"
      elif has "Hand-off " && has " ended:"; then
        good "delegate: a worker ran and reported back."; delegate_ok=1
        set_row delegate on "workers $read_w, $mech_w, $build_w; a hand-off ran" "/config delegate.buildWorker=sonnet:high, /delegate:setup"
      else bad "delegate: no hand-off in the answer."; set_row delegate on "the hand-off check found no hand-off" "/delegate:setup"
      fi
    fi
    if [ "$logged_in" = 0 ]; then
      bad "Claude Code is not logged in here: start claude once, type /login, then run the checks with /modpack:setup."
    fi
    if [ "$route_want" = 1 ] && [ "$route_key_set" = 1 ] && [ "$delegate_ok" = 1 ]; then
      para "A hand-off works and the key is stored, so route goes on now, as you agreed."
      if configure "route@$MARKET" '{"enabled":"true"}'; then
        set_row route "on, $route_service" "you said yes; the key is stored" "/mods route off"
      fi
    fi
  fi
  if [ "$route_want" = 1 ] && [ "$route_key_set" = 0 ]; then
    set_row route off "you said yes; no key stored yet" "/plugin configure route@$MARKET, then /mods route on"
  fi
  if [ "$DRY_RUN" = 1 ] && [ "$route_want" = 1 ]; then
    set_row route "off" "(dry run) would store the key, then turn on after a hand-off works" "/mods route on"
  fi

  blank
  print_rows
  SETUP_RESULT="quick"
}

case $SETUP in
  guided) guided_setup ;;
  quick) quick_setup ;;
  later)
    para "Set it up whenever you like, in the project you work in:"
    show_line "$LAUNCH"
    para "or type /modpack:setup in Claude Code there. By hand: $SETUP_MD"
    SETUP_RESULT="later" ;;
esac

# ================================================================ 5. end

heading "4/4 Done"
if [ "$DRY_RUN" = 1 ]; then
  para "Dry run: nothing was changed."
elif [ "$STATE" = installed ]; then
  para "The pack is installed ($SCOPE scope)."
else
  para "The pack is installed ($SCOPE scope): the modpack and its eight mods."
fi
case $SETUP_RESULT in
  later) para "Next step: in Claude Code, in your project, type /modpack:setup (or run: $LAUNCH)." ;;
  quick) para "If Claude Code is open, restart it to load what was set (claude --continue keeps the conversation)." ;;
  guided) para "The setup ran in Claude Code. If it stopped before confirming each mod, run: cd $(q "$PROJECT") && claude --continue" ;;
esac
blank
para "Three commands worth remembering, typed in Claude Code:"
printf '  %-17s %s\n' "/mods" "what is on, and a switch for each mod"
printf '  %-17s %s\n' "/modpack:setup" "this setup again, for example in another project"
printf '  %-17s %s\n' "/modpack:update" "the newest release, now"
blank
para "Every step by hand: $SETUP_MD"
exit "$FAILED"
