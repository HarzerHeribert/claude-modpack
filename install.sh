#!/usr/bin/env bash
# claude-modpack installer, for macOS and Linux: installs the pack, then starts its setup.
#
#   bash install.sh [--advanced] [--dry-run] [--yes] [--verbose] [--project DIR]
#                   [--scope user|project] [--setup guided|quick|later] [--help]
#
# Read it before you run it. It installs with Claude Code's own `claude plugin` commands
# (--verbose shows each one, --dry-run shows them and runs none), asks before it installs
# anything else on your system, and never uses sudo without asking. It keeps no log and writes
# no file of its own. Run it again at any time: it finds what is there and goes on from it.

shopt -s extglob   # before the functions below are read: they use *([0-9;]) patterns

MIN_VERSION=2.1.287     # the first Claude Code that runs mods at all
TESTED_VERSION=2.1.296  # the pack was tested on 2.1.296 to 2.1.301
NODE_MIN=22.13          # cells runs its cells with Node
REPO=HarzerHeribert/claude-modpack
MARKET=claude-modpack
PACK="modpack statusline smart-compact delegate cells eta seek draft route"
SETUP_MD="https://github.com/$REPO/blob/main/SETUP.md"
INSTALL_DOCS="https://code.claude.com/docs/en/setup"
WORKER_RE='^(haiku|sonnet|opus):(low|medium|high|xhigh|max)$'

usage() {
  cat <<EOF
Installs claude-modpack for Claude Code, then starts its setup.

Usage: bash install.sh [options]

  --advanced        set the pack up here in the terminal instead of with Claude
                    (same as --setup quick)
  --dry-run         show what would change, and change nothing
  --yes, -y         ask nothing: install, and print how to set up later
  --verbose         show each command and its output
  --project DIR     the project to set up (default: this folder)
  --scope SCOPE     user (default): for you, in every project
                    project: only in DIR, shared with others who open it
  --setup MODE      guided: Claude sets the mods up with you (the default)
                    quick:  this script asks and sets them up itself
                    later:  print how to do it later
  --help, -h        this text

Every step by hand: $SETUP_MD

Exit codes: 0 done, 1 a step failed, 2 wrong usage, 3 cannot run here
(Windows, no Claude Code, or one older than $MIN_VERSION), 130 stopped with Ctrl-C.
NO_COLOR turns colours off.
EOF
}

# ---------------------------------------------------------------- options

DRY_RUN=0 YES=0 VERBOSE=0 PROJECT="" SCOPE="" SETUP=""
usage_error() { printf 'install.sh: %s (see --help)\n' "$1" >&2; exit 2; }
while [ $# -gt 0 ]; do
  case $1 in
    --dry-run) DRY_RUN=1 ;;
    -y|--yes) YES=1 ;;
    --verbose) VERBOSE=1 ;;
    --advanced) SETUP=quick ;;
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

# ---------------------------------------------------------------- the terminal

ESC=$'\033'
OUT_TTY=0
[ -t 1 ] && OUT_TTY=1
exec 4>&1   # the terminal itself, for its size from inside $( )

# Answers come from the terminal: stdin, or /dev/tty when the script arrives on stdin (curl | bash).
HAVE_TTY=0
if [ -t 0 ]; then
  exec 3<&0; HAVE_TTY=1
elif (exec 3</dev/tty) 2>/dev/null; then
  exec 3</dev/tty
  [ -t 3 ] && HAVE_TTY=1
fi
ASK=$HAVE_TTY
[ "$YES" = 1 ] && ASK=0
STTY_SAVE=""
[ "$HAVE_TTY" = 1 ] && STTY_SAVE=$(stty -g <&3 2>/dev/null)
MENU_KEYS=0   # arrow-key menus need a terminal on both sides
[ "$HAVE_TTY" = 1 ] && [ "$OUT_TTY" = 1 ] && [ "${TERM:-dumb}" != dumb ] && MENU_KEYS=1

# Every line fits: at most 72 columns, and never wider than the terminal.
COLS=""
[ "$OUT_TTY" = 1 ] && COLS=$(stty size <&4 2>/dev/null | awk '{ print $2 }')
case $COLS in ''|0|*[!0-9]*) COLS=${COLUMNS:-80} ;; esac
case $COLS in ''|0|*[!0-9]*) COLS=80 ;; esac
W=$((COLS - 1))
[ "$W" -gt 72 ] && W=72
[ "$W" -lt 20 ] && W=20

if [ "$OUT_TTY" = 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-dumb}" != dumb ]; then
  R="${ESC}[0m" B="${ESC}[1m" DIM="${ESC}[2m" GRN="${ESC}[32m" YEL="${ESC}[33m" RED="${ESC}[31m"
  case "${TERM:-}:${COLORTERM:-}" in
    *256color*|*ghostty*|*:truecolor|*:24bit) ACC="${ESC}[1;38;5;75m" ;;
    *) ACC="${ESC}[1;36m" ;;
  esac
else
  R="" B="" DIM="" GRN="" YEL="" RED="" ACC=""
fi
HIDE="" SHOW=""   # the cursor, hidden while a spinner or a menu draws (not colour: NO_COLOR keeps it)
[ "$OUT_TTY" = 1 ] && [ "${TERM:-dumb}" != dumb ] && HIDE="${ESC}[?25l" SHOW="${ESC}[?25h"
case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in
  *UTF-8*|*utf-8*|*UTF8*|*utf8*)
    OK="✓" WARN="!" BAD="✗" DOT="·" PICK="❯" DASH="—" DOTS="…" HR="─" NEWER="↑" KEYS="↑ ↓"
    BTL="╭" BTR="╮" BBL="╰" BBR="╯" BV="│" FRAMES="⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏" ;;
  *)
    OK="+" WARN="!" BAD="x" DOT="-" PICK=">" DASH="-" DOTS="..." HR="-" NEWER="^" KEYS="up, down"
    BTL="+" BTR="+" BBL="+" BBR="+" BV="|" FRAMES="|/-\\" ;;
esac

# ---------------------------------------------------------------- output

# wrap WIDTH PREFIX TEXT: TEXT broken into lines of at most WIDTH columns, into WRAPPED. The first
# line starts with PREFIX, the others with as many spaces (a hanging indent). Colour codes take no
# room; a word longer than a line (a long path) is cut.
WRAPPED=()
wrap() {
  local width=$1 prefix=$2 plain ind max line="" lw=0 w ww
  local -a words
  WRAPPED=()
  plain=${prefix//"$ESC"\[*([0-9;])m/}
  printf -v ind '%*s' "${#plain}" ''
  max=$((width - ${#plain}))
  [ "$max" -lt 8 ] && max=8
  read -r -a words <<<"$3"
  for w in ${words[@]+"${words[@]}"}; do
    plain=${w//"$ESC"\[*([0-9;])m/}
    ww=${#plain}
    if [ "$ww" -gt "$max" ] && [ "$plain" = "$w" ]; then
      if [ "$lw" -gt 0 ]; then _line "$line"; fi
      while [ "${#w}" -gt "$max" ]; do _line "${w:0:max}"; w=${w:max}; done
      line=$w lw=${#w}
      continue
    fi
    if [ "$lw" -eq 0 ]; then line=$w lw=$ww
    elif [ $((lw + 1 + ww)) -le "$max" ]; then line="$line $w" lw=$((lw + 1 + ww))
    else _line "$line"; line=$w lw=$ww
    fi
  done
  _line "$line"
}
_line() { if [ ${#WRAPPED[@]} -eq 0 ]; then WRAPPED[0]="$prefix$1"; else WRAPPED[${#WRAPPED[@]}]="$ind$1"; fi; }

# say PREFIX TEXT [STYLE]: TEXT wrapped to the width, each line in STYLE.
say() {
  local l
  wrap "$W" "$1" "$2"
  for l in "${WRAPPED[@]}"; do printf '%s%s%s\n' "${3:-}" "$l" "${3:+$R}"; done
}
text() { say "  " "$*"; }
good() { say "  $GRN$OK$R " "$*"; }
warn() { say "  $YEL$WARN$R " "$*"; }
bad() { say "  $RED$BAD$R " "$*"; }
info() { say "  $DIM$DOT$R " "$*"; }
hint() { say "    " "$*" "$DIM"; }
blank() { printf '\n'; }
section() {
  local s n=$((W - 4 - ${#1}))
  [ "$n" -lt 2 ] && n=2
  printf -v s '%*s' "$n" ''
  printf '\n  %s%s%s %s%s%s\n' "$ACC" "$1" "$R" "$DIM" "${s// /$HR}" "$R"
}
# shellcheck disable=SC2088  # the ~ is shown, not expanded
nice_path() { case $1 in "$HOME") printf '~' ;; "$HOME"/*) printf '~/%s' "${1#"$HOME"/}" ;; *) printf '%s' "$1" ;; esac; }
short_path() {  # a folder as ~/…, or by its name alone when that would be long
  local p
  p=$(nice_path "$1")
  if [ "${#p}" -gt $((W - 24)) ]; then printf '%s' "${1##*/}"; else printf '%s' "$p"; fi
}

# box TITLE LINE...: a rounded box as wide as the text. A LINE "PREFIX<tab>TEXT" keeps PREFIX's
# spacing (for aligned columns); "" is an empty line.
box() {
  local title=$1 inner=$((W - 6)) l pre txt v plain pad s n
  shift
  n=$((W - 7 - ${#title}))
  [ "$n" -lt 1 ] && n=1
  printf -v s '%*s' "$n" ''
  printf '  %s%s%s %s%s%s %s%s%s\n' "$DIM" "$BTL$HR" "$R" "$ACC" "$title" "$R" "$DIM" "${s// /$HR}$BTR" "$R"
  for l in "$@"; do
    case $l in *$'\t'*) pre=${l%%$'\t'*} txt=${l#*$'\t'} ;; *) pre="" txt=$l ;; esac
    wrap "$inner" "$pre" "$txt"
    for v in "${WRAPPED[@]}"; do
      plain=${v//"$ESC"\[*([0-9;])m/}
      pad=$((inner - ${#plain}))
      [ "$pad" -lt 0 ] && pad=0
      printf '  %s%s%s %s%*s %s%s%s\n' "$DIM" "$BV" "$R" "$v" "$pad" '' "$DIM" "$BV" "$R"
    done
  done
  printf -v s '%*s' $((W - 4)) ''
  printf '  %s%s%s%s\n' "$DIM" "$BBL" "${s// /$HR}" "$BBR$R"
}

q() {  # one argument, quoted only when a shell would need it
  case $1 in
    '') printf "''" ;;
    *[!A-Za-z0-9_./:@=+,%^-]*) printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")" ;;
    *) printf '%s' "$1" ;;
  esac
}
cmdline() { say "    \$ " "$1" "$DIM"; }   # a command, shown (dim) under --dry-run and --verbose

# run CMD...: a command that changes something. Quiet by default (its output kept for an error);
# shown and run under --verbose; shown and not run under --dry-run.
LOG=""
run() {
  local line="" a out rc
  for a in "$@"; do line="$line${line:+ }$(q "$a")"; done
  if [ "$DRY_RUN" = 1 ]; then cmdline "$line"; return 0; fi
  if [ "$VERBOSE" = 1 ]; then cmdline "$line"; "$@" </dev/null; return; fi
  out=$("$@" </dev/null 2>&1)
  rc=$?
  LOG="$LOG\$ $line"$'\n'"$out"$'\n'
  return "$rc"
}
# configure PLUGIN JSON: options, the way `claude plugin configure --values-stdin` reads them.
configure() {
  local line out rc
  line="printf '%s' $(q "$2") | claude plugin configure $1 --values-stdin"
  if [ "$DRY_RUN" = 1 ]; then cmdline "$line"; return 0; fi
  [ "$VERBOSE" = 1 ] && cmdline "$line"
  out=$(printf '%s' "$2" | claude plugin configure "$1" --values-stdin 2>&1)
  rc=$?
  [ "$VERBOSE" = 1 ] && printf '%s\n' "$out"
  LOG="$LOG\$ $line"$'\n'"$out"$'\n'
  return "$rc"
}
show_log_tail() {  # the last lines Claude Code printed, for an error
  local l
  printf '%s\n' "$LOG" | grep -v '^[[:space:]]*$' | tail -4 | while IFS= read -r l; do hint "$l"; done
}

# spin TEXT ... spun: a spinner and TEXT on one line while the work between them runs.
SPIN_PID=""
spin() {
  [ "$OUT_TTY" = 1 ] && [ "$VERBOSE" = 0 ] && [ "$DRY_RUN" = 0 ] || return 0
  local t=$1
  [ "${#t}" -gt $((W - 4)) ] && t=${t:0:W-4}
  printf '%s' "$HIDE"
  ( i=0 n=${#FRAMES}
    while :; do k=$((i % n)); printf '\r  %s%s%s %s' "$ACC" "${FRAMES:k:1}" "$R" "$t"; i=$((i + 1)); sleep 0.1; done ) &
  SPIN_PID=$!
}
spun() {
  [ -n "$SPIN_PID" ] || return 0
  kill "$SPIN_PID" 2>/dev/null
  wait "$SPIN_PID" 2>/dev/null
  SPIN_PID=""
  printf '\r%*s\r%s' "$W" '' "$SHOW"
}

# ---------------------------------------------------------------- questions

# ask VAR QUESTION DEFAULT: a typed answer, or DEFAULT when it is empty or nobody can answer.
ask() {
  local _a="" _i _n
  wrap $((W - 6)) "  " "$2"
  _n=${#WRAPPED[@]}
  for ((_i = 0; _i < _n - 1; _i++)); do printf '%s%s%s\n' "$B" "${WRAPPED[_i]}" "$R"; done
  if [ "$ASK" = 1 ]; then
    printf '%s%s%s ' "$B" "${WRAPPED[_n - 1]}" "$R"
    IFS= read -r -u 3 _a || _a=""
  else
    printf '%s%s%s %s%s%s\n' "$B" "${WRAPPED[_n - 1]}" "$R" "$DIM" "${3:-}" "$R"
  fi
  [ -n "$_a" ] || _a=$3
  printf -v "$1" '%s' "$_a"
}

# confirm QUESTION y|n: yes or no; Enter takes the default.
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
    if [ "$tries" -ge 3 ]; then [ "$2" = y ]; return; fi
    hint "Type y or n, then Enter."
  done
}

# menu VAR QUESTION RECOMMENDED "value|label" ...: one choice, with the arrow keys and Enter (or
# its number). The recommended one is marked and preselected; with nobody to ask, it is taken.
menu() {
  local var=$1 question=$2 rec=$3 n=0 sel=0 recn=0 i k rest drawn=0 l a tries=0
  local -a vals labels
  shift 3
  for l in "$@"; do
    vals[n]=${l%%|*} labels[n]=${l#*|}
    [ "${vals[n]}" = "$rec" ] && sel=$n recn=$n
    n=$((n + 1))
  done
  if [ "$ASK" = 0 ]; then
    say "  " "$B$question$R $DIM${labels[sel]}$R"
    printf -v "$var" '%s' "${vals[sel]}"
    return 0
  fi
  say "  " "$question" "$B"
  if [ "$MENU_KEYS" = 0 ]; then
    for ((i = 0; i < n; i++)); do
      l=${labels[i]}
      [ "$i" = "$recn" ] && l="$l $DIM(recommended)$R"
      say "    $((i + 1))) " "$l"
    done
    while :; do
      ask a "Type a number, then Enter [$((recn + 1))]:" "$((recn + 1))"
      case $a in *[!0-9]*) ;; *) if [ "$a" -ge 1 ] && [ "$a" -le "$n" ]; then sel=$((a - 1)); break; fi ;; esac
      tries=$((tries + 1))
      [ "$tries" -ge 3 ] && break
    done
  else
    hint "Use $KEYS and Enter."
    printf '%s' "$HIDE"
    stty -echo <&3 2>/dev/null   # keys pressed while it redraws must not print
    _menu_draw
    while :; do
      k=""
      IFS= read -rsn1 -u 3 k || break
      case $k in
        "$ESC")
          rest=""
          IFS= read -rsn2 -t 1 -u 3 rest
          case $rest in '[A'|OA) sel=$(((sel + n - 1) % n)) ;; '[B'|OB) sel=$(((sel + 1) % n)) ;; esac ;;
        k) sel=$(((sel + n - 1) % n)) ;;
        j) sel=$(((sel + 1) % n)) ;;
        [1-9]) if [ "$k" -le "$n" ]; then sel=$((k - 1)); fi ;;   # a number moves there; Enter takes it
        '') break ;;
      esac
      _menu_draw again
    done
    # only the choice stays on screen
    printf '%s[%dA%s[J' "$ESC" $((drawn + 1)) "$ESC"
    say "  $GRN$OK$R " "${labels[sel]}"
    printf '%s' "$SHOW"
    stty echo <&3 2>/dev/null
  fi
  printf -v "$var" '%s' "${vals[sel]}"
}
_menu_draw() {  # menu()'s options, drawn again in place after a key
  local i l lines=0 label
  [ "${1:-}" = again ] && printf '%s[%dA' "$ESC" "$drawn"
  for ((i = 0; i < n; i++)); do
    label=${labels[i]}
    [ "$i" = "$recn" ] && label="$label $DIM(recommended)$R"
    if [ "$i" = "$sel" ]; then wrap "$W" "  $ACC$PICK$R " "$B$label$R"
    else wrap "$W" "    " "$label"; fi
    for l in "${WRAPPED[@]}"; do printf '%s[2K%s\n' "$ESC" "$l"; lines=$((lines + 1)); done
  done
  drawn=$lines
}

# ---------------------------------------------------------------- Ctrl-C

# shellcheck disable=SC2329  # called from the traps below
stopped() {
  trap - INT TERM
  if [ -n "$SPIN_PID" ]; then kill "$SPIN_PID" 2>/dev/null; wait "$SPIN_PID" 2>/dev/null; printf '\r%*s\r' "$W" ''; fi
  [ -n "$STTY_SAVE" ] && stty "$STTY_SAVE" <&3 2>/dev/null
  printf '%s\n\n' "$SHOW"
  say "  " "${B}Stopped.${R} Nothing is left half-done. Run the same command again to go on from here."
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

# The newest release on GitHub ("0.6.1"), or nothing: no network, no curl, any error.
latest_release() {
  command -v curl >/dev/null 2>&1 || return 0
  curl -fsS --max-time 5 -H 'Accept: application/vnd.github+json' -H 'User-Agent: claude-modpack-installer' \
    "https://api.github.com/repos/$REPO/releases/latest" </dev/null 2>/dev/null |
    sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"v\{0,1\}\([0-9][0-9.]*\)".*/\1/p' | head -1
}

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

# ================================================================ start

blank
say "  " "${ACC}claude-modpack${R}"
say "  " "Installs the mods for Claude Code, then helps you set them up." "$DIM"
[ "$DRY_RUN" = 1 ] && say "  " "${YEL}Dry run:${R} nothing will change."
if [ "$HAVE_TTY" = 0 ] && [ "$YES" = 0 ]; then
  say "  " "No terminal to answer questions in, so this takes the defaults." "$DIM"
  YES=1
fi
blank

# ================================================================ checks

ENV_OS=${OS:-}   # Windows_NT in Git Bash and MSYS2
OS=$(uname -s 2>/dev/null)
case $OS in MINGW*|MSYS*|CYGWIN*) ENV_OS=Windows_NT ;; esac
if [ "$ENV_OS" = Windows_NT ]; then
  bad "Windows isn't supported by this installer."
  hint "In Claude Code, type: /plugin install modpack --marketplace $REPO"
  exit 3
fi
case $OS in
  Darwin) MACHINE="Your Mac" ;;
  *) MACHINE="This computer" ;;
esac

if ! command -v claude >/dev/null 2>&1; then
  bad "Claude Code isn't installed yet."
  hint "Install it first ($INSTALL_DOCS), then run this again."
  exit 3
fi
CLAUDE_VERSION=$(ver_num "$(claude --version </dev/null 2>/dev/null)")
if [ -z "$CLAUDE_VERSION" ]; then
  bad "Claude Code didn't say its version."
  hint "Check that 'claude --version' works here, then run this again."
  exit 3
fi
if ! ver_ge "$CLAUDE_VERSION" "$MIN_VERSION"; then
  bad "Claude Code $CLAUDE_VERSION is too old for the mods."
  if [ "$ASK" = 1 ] && confirm "Update Claude Code now?" y; then
    spin "Updating Claude Code$DOTS"
    run claude update
    spun
    CLAUDE_VERSION=$(ver_num "$(claude --version </dev/null 2>/dev/null)")
  fi
  if [ "$DRY_RUN" = 1 ] || ! ver_ge "$CLAUDE_VERSION" "$MIN_VERSION"; then
    hint "Update it with: claude update. Then run this again."
    exit 3
  fi
fi

PROBLEMS=0
problem() { PROBLEMS=$((PROBLEMS + 1)); warn "$1"; [ -n "${2:-}" ] && hint "$2"; }
case $OS in
  Darwin|Linux) ;;
  *) problem "$OS hasn't been tested: the pack is made for macOS and Linux." ;;
esac
ver_ge "$CLAUDE_VERSION" "$TESTED_VERSION" ||
  problem "Claude Code $CLAUDE_VERSION is older than the version the mods were tested on." "Update it when you can: claude update"
HAVE_GIT=0
if command -v git >/dev/null 2>&1; then HAVE_GIT=1
else
  if [ "$OS" = Darwin ]; then problem "git isn't installed: two mods work better with it." "Install it with: xcode-select --install"
  else problem "git isn't installed: two mods work better with it." "Install it with your package manager."; fi
fi
NODE_VERSION=""
command -v node >/dev/null 2>&1 && NODE_VERSION=$(ver_num "$(node --version 2>/dev/null)")
if [ -z "$NODE_VERSION" ] || ! ver_ge "$NODE_VERSION" "$NODE_MIN"; then
  if [ "$OS" = Darwin ] && command -v brew >/dev/null 2>&1; then fix="Install it with: brew install node"
  else fix="Install it from https://nodejs.org"; fi
  problem "Node.js $NODE_MIN or newer isn't installed: one mod (cells) stays off until it is." "$fix"
fi
for f in "/Library/Application Support/ClaudeCode/managed-settings.json" /etc/claude-code/managed-settings.json; do
  [ -f "$f" ] && problem "Your organization manages Claude Code here: a few parts of the mods may not run."
done
[ "$PROBLEMS" = 0 ] && good "$MACHINE is ready ${DIM}$DOT Claude Code $CLAUDE_VERSION${R}"

# The project: this folder unless --project. The setup works best in a git project.
START_DIR=$PWD
[ -n "$PROJECT" ] || PROJECT=$PWD
cd "$PROJECT" || usage_error "cannot open '$PROJECT'"
PROJECT=$PWD
is_repo() { [ "$HAVE_GIT" = 1 ] && [ "$(git rev-parse --is-inside-work-tree 2>/dev/null)" = true ]; }
IS_REPO=0
is_repo && IS_REPO=1
if [ "$IS_REPO" = 0 ] && [ "$HAVE_GIT" = 1 ]; then
  warn "This folder ($(short_path "$PROJECT")) isn't a code project (no git): the setup works best in one."
  tries=0
  while [ "$ASK" = 1 ] && [ "$tries" -lt 3 ]; do
    ask other "Your project's folder (Enter keeps this one):" ""
    [ -n "$other" ] || break
    case $other in "~") other=$HOME ;; "~"/*) other=$HOME/${other#"~/"} ;; esac
    if [ -d "$other" ] && cd "$other"; then
      PROJECT=$PWD
      is_repo && IS_REPO=1
      good "Project: $(short_path "$PROJECT")"
      break
    fi
    hint "There's no folder '$other'."
    tries=$((tries + 1))
  done
fi

# What is installed already.
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
if [ -z "$MISSING" ] && [ -z "$DISABLED" ]; then STATE=installed
elif [ "$MISSING" = "$PACK" ]; then STATE=fresh
else STATE=partial
fi

# ================================================================ install

FAILED=0

# The newest release, as the modpack's own update does it: refresh the marketplace's copy, then
# update the modpack and each mod; a mod that is not installed yet (new in a release) is installed.
update_pack() {
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
# A fresh install, or one that is partly there.
install_pack() {
  local known=0 p
  marketplace_known "$MARKET" && known=1
  run claude plugin marketplace add "$REPO" --scope "$SCOPE" || return 1
  if [ "$(plugin_state "modpack@$MARKET")" != missing ]; then
    update_pack || return 1
  else
    if [ "$known" = 1 ]; then run claude plugin marketplace update "$MARKET" || return 1; fi
    run claude plugin install "modpack@$MARKET" --scope "$SCOPE" || return 1
  fi
  [ "$DRY_RUN" = 1 ] && return 0
  refresh_plugins
  for p in $PACK; do
    case $(plugin_state "$p@$MARKET") in
      missing) run claude plugin install "$p@$MARKET" --scope "$SCOPE" || return 1 ;;
      off) run claude plugin enable "$p@$MARKET" || return 1 ;;
    esac
  done
  refresh_plugins
  for p in $PACK; do [ "$(plugin_state "$p@$MARKET")" = on ] || return 1; done
}
install_failed() {
  bad "The install didn't finish. Claude Code said:"
  show_log_tail
  hint "Run the same command again to retry. Or in Claude Code, type: /plugin install modpack --marketplace $REPO"
  exit 1
}

if [ "$STATE" = installed ]; then
  SCOPE=${INSTALLED_SCOPE:-user}
  LATEST=$(latest_release)
  if [ -n "$LATEST" ] && ! ver_ge "$INSTALLED_VERSION" "$LATEST"; then
    if [ "$DRY_RUN" = 1 ]; then
      say "  $ACC$NEWER$R " "$LATEST is out, you have $INSTALLED_VERSION $DASH this would update it:"
    else
      say "  $ACC$NEWER$R " "$LATEST is out, you have $INSTALLED_VERSION $DASH updating"
    fi
    spin "Updating claude-modpack$DOTS"
    update_pack
    rc=$?
    spun
    [ "$rc" = 0 ] || install_failed
    if [ "$DRY_RUN" = 0 ]; then
      refresh_plugins
      good "Updated claude-modpack to $(plugin_field "modpack@$MARKET" 2)"
    fi
  elif [ -n "$LATEST" ]; then
    good "claude-modpack $INSTALLED_VERSION is installed and up to date"
  else
    good "claude-modpack $INSTALLED_VERSION is installed"
  fi
else
  [ "$STATE" = partial ] && [ "$(plugin_state "modpack@$MARKET")" != missing ] && SCOPE=${INSTALLED_SCOPE:-user}
  if [ -z "$SCOPE" ]; then
    if [ "$SETUP" = quick ] && [ "$ASK" = 1 ]; then
      blank
      menu SCOPE "Who should get the mods?" user \
        "user|Just me, in every project" "project|Everyone who opens this project"
    else
      SCOPE=user
    fi
  fi
  if [ "$DRY_RUN" = 1 ]; then
    info "This would install claude-modpack:"
  elif [ "$STATE" = partial ]; then
    spin "Finishing the install$DOTS"
  else
    spin "Installing claude-modpack$DOTS"
  fi
  install_pack
  rc=$?
  spun
  [ "$rc" = 0 ] || install_failed
  [ "$DRY_RUN" = 0 ] && good "Installed claude-modpack $(plugin_field "modpack@$MARKET" 2)"
fi
VERSION_NOW=$(plugin_field "modpack@$MARKET" 2)
[ "$VERSION_NOW" = missing ] && VERSION_NOW=""

# ================================================================ setup

LAUNCH="cd $(q "$PROJECT") && claude \"/modpack:setup\""

guided_setup() {
  blank
  local where="this folder"
  [ "$PROJECT" = "$START_DIR" ] || where=${PROJECT##*/}
  text "Claude Code opens in $where and asks you a few questions. When it asks for a restart, quit it: this window starts it again."
  if [ "$DRY_RUN" = 1 ]; then cmdline "$LAUNCH"; return; fi
  [ "$VERBOSE" = 1 ] && cmdline "$LAUNCH"
  blank
  trap ':' INT   # Ctrl-C belongs to Claude Code while it runs
  claude "/modpack:setup" <&3
  local rc=$?
  trap 'stopped 130' INT
  blank
  [ "$rc" = 0 ] || warn "Claude Code ended with an error ($rc)."
  if confirm "Start Claude again to finish the setup?" y; then
    [ "$VERBOSE" = 1 ] && cmdline "claude --continue"
    trap ':' INT
    claude --continue <&3
    trap 'stopped 130' INT
  fi
}

# A claude -p run that proves a mod works: its whole stream (with tool results) in CHECK_OUT.
# --allowedTools takes several values, so it goes first and the prompt last.
CHECK_OUT=""
p_check() {  # p_check ALLOWED_TOOL PROMPT
  CHECK_OUT=""
  if [ "$DRY_RUN" = 1 ] || [ "$VERBOSE" = 1 ]; then
    cmdline "claude -p --allowedTools $(q "$1") --output-format stream-json --verbose --no-session-persistence --max-budget-usd 1 $(q "$2")"
  fi
  [ "$DRY_RUN" = 1 ] && return 0
  CHECK_OUT=$(with_timeout 300 claude -p --allowedTools "$1" --output-format stream-json --verbose \
    --no-session-persistence --max-budget-usd 1 "$2" </dev/null 2>&1)
  return 0
}
has() { case $CHECK_OUT in *"$1"*) return 0 ;; esac; return 1; }
not_logged_in() { has "Not logged in" || has "Please run /login" || has "Invalid API key"; }

# The rows of the advanced setup's summary: "mod|on or off|what".
ROWS=()
set_row() {
  local i
  for i in "${!ROWS[@]}"; do
    case ${ROWS[i]} in "$1|"*) ROWS[i]="$1|$2|$3"; return ;; esac
  done
  ROWS[${#ROWS[@]}]="$1|$2|$3"
}
print_rows() {
  local row mod state what sym
  for row in "${ROWS[@]}"; do
    IFS='|' read -r mod state what <<EOF
$row
EOF
    case $state in on) sym="$GRN$OK$R" ;; off) sym="$DIM$DOT$R" ;; *) sym="$YEL$WARN$R" ;; esac
    if [ "$W" -ge 56 ]; then say "  $sym $(printf '%-14s' "$mod")" "$what"   # a column where it fits
    else say "  $sym " "$B$mod$R $what"; fi
  done
}

advanced_setup() {
  local placement updates
  local read_w=haiku:low mech_w=haiku:low build_w=sonnet:medium workers_json="" do_checks=0
  local cells_state=on cells_why="" cells_fix=""

  section "Set up"
  text "A few choices. Enter takes the recommended one; /mods changes any of it later."
  blank
  say "  " "The status line shows the model, how full the conversation is, and your plan's use." "$DIM"
  menu placement "Where should the status line go?" line \
    "line|Under the prompt" "tail|After Claude Code's own hint" "band|Above the prompt" "off|Nowhere"
  blank
  menu updates "How should new releases arrive?" auto \
    "auto|Install them by themselves" "notify|Just tell me" "off|Never check"

  # -- cells' sandbox
  if [ "$OS" = Darwin ]; then
    if [ -x /usr/bin/sandbox-exec ]; then cells_why="runs in macOS's sandbox"; else cells_state=off cells_why="macOS's sandbox is missing"; fi
  elif [ "$OS" = Linux ]; then
    if command -v bwrap >/dev/null 2>&1 && bwrap --unshare-all --ro-bind / / true >/dev/null 2>&1; then
      cells_why="runs in bubblewrap's sandbox"
    elif [ -n "$NODE_VERSION" ] && ver_ge "$NODE_VERSION" 25; then
      cells_why="runs in Node's sandbox"
    elif command -v bwrap >/dev/null 2>&1; then
      cells_state=off cells_why="bubblewrap is blocked here: see SETUP.md, step 5"
    else
      if command -v apt-get >/dev/null 2>&1; then cells_fix="sudo apt install bubblewrap"
      elif command -v dnf >/dev/null 2>&1; then cells_fix="sudo dnf install bubblewrap"
      elif command -v pacman >/dev/null 2>&1; then cells_fix="sudo pacman -S bubblewrap"; fi
      if [ -n "$cells_fix" ]; then
        blank
        text "One mod (cells) needs a sandbox program, bubblewrap. Installing it needs your password (sudo):"
        cmdline "$cells_fix"
        confirm "Install it?" n || cells_fix=""
      fi
      [ -n "$cells_fix" ] || cells_state=off cells_why="needs bubblewrap: $cells_fix"
    fi
  fi
  if [ -z "$NODE_VERSION" ] || ! ver_ge "$NODE_VERSION" "$NODE_MIN"; then
    cells_state=off cells_why="needs Node.js $NODE_MIN or newer"
  fi

  # -- delegate's workers
  blank
  if ! confirm "Keep the recommended models for handed-off work (Haiku to read, Sonnet to build)?" y; then
    local w v def tries
    for w in read mechanical build; do
      def=$read_w
      [ "$w" = mechanical ] && def=$mech_w
      [ "$w" = build ] && def=$build_w
      tries=0
      while :; do
        ask v "Model for $w work, like sonnet:high [$def]:" "$def"
        [[ $v =~ $WORKER_RE ]] && break
        tries=$((tries + 1))
        [ "$tries" -ge 3 ] && { v=$def; break; }
        hint "A model (haiku, sonnet, opus), a colon, and an effort (low, medium, high, xhigh, max)."
      done
      case $w in read) read_w=$v ;; mechanical) mech_w=$v ;; build) build_w=$v ;; esac
    done
    workers_json="{\"readWorker\":\"$read_w\",\"mechanicalWorker\":\"$mech_w\",\"buildWorker\":\"$build_w\"}"
  fi

  # -- tests
  blank
  if [ "$YES" = 1 ]; then
    do_checks=0
  elif confirm "Test each part now? It sends two short requests to Claude." y; then
    do_checks=1
  fi

  # ---- now do it
  section "Setting up"
  LOG=""
  [ "$DRY_RUN" = 1 ] && info "This would run:"
  spin "Saving your choices$DOTS"
  local saved=1
  [ "$placement" = line ] || configure "statusline@$MARKET" "{\"placement\":\"$placement\"}" || saved=0
  [ "$updates" = auto ] || configure "modpack@$MARKET" "{\"updates\":\"$updates\"}" || saved=0
  if [ -n "$workers_json" ]; then configure "delegate@$MARKET" "$workers_json" || saved=0; fi
  spun
  if [ "$saved" = 1 ]; then [ "$DRY_RUN" = 1 ] || good "Saved your choices"
  else bad "Some choices weren't saved. Claude Code said:"; show_log_tail; FAILED=1; fi
  if [ -n "$cells_fix" ]; then
    cmdline "$cells_fix"
    if [ "$DRY_RUN" = 1 ]; then :
    elif sh -c "$cells_fix" <&3 && bwrap --unshare-all --ro-bind / / true >/dev/null 2>&1; then cells_why="runs in bubblewrap's sandbox"
    else cells_state=off cells_why="bubblewrap didn't start: see SETUP.md, step 5"; FAILED=1; fi
  fi

  local placement_words updates_words
  case $placement in line) placement_words="under the prompt" ;; tail) placement_words="after Claude Code's hint" ;;
    band) placement_words="above the prompt" ;; off) placement_words="hidden" ;; esac
  case $updates in auto) updates_words="installs new releases by itself" ;; notify) updates_words="tells you about new releases" ;;
    off) updates_words="never checks for new releases" ;; esac
  set_row statusline "$([ "$placement" = off ] && echo off || echo on)" "the status line, $placement_words"
  set_row smart-compact on "keeps a paused conversation cheap to pick up"
  set_row eta on "shows progress for long jobs"
  set_row cells "$cells_state" "${cells_why:-several steps at once}"
  set_row delegate on "hands big jobs to $build_w"
  set_row seek on "looks around your code in fewer steps"
  set_row draft on "writes to a word limit in one draft"
  set_row route off "optional, off: needs an outside classifier (a Jev or ScaleDown key); /modpack:setup asks"
  set_row modpack on "$updates_words"

  if [ "$do_checks" = 1 ]; then
    local logged_in=1 why
    if [ "$cells_state" = on ]; then
      spin "Testing cells$DOTS"
      p_check mcp__cells__run_cell "Call the run_cell tool once, with the code: return 1. Then reply with the word done."
      spun
      if [ "$DRY_RUN" = 1 ]; then :
      elif not_logged_in; then logged_in=0
      elif has "## Output"; then good "cells works"
      else
        why=$(printf '%s\n' "$CHECK_OUT" | grep -o 'cells is off: [^".]*' | head -1)
        bad "cells didn't run${why:+: ${why#cells is off: }}"
        set_row cells off "${why:-the test ran nothing}; /cells:setup"
      fi
    fi
    if [ "$logged_in" = 1 ]; then
      spin "Testing delegate$DOTS"
      p_check mcp__delegate__hand_off "Call the hand_off tool once, with kind read and this task: List the top-level files and folders of this repository and say in one sentence what the project is. Then reply with the last line of the tool's result."
      spun
      if [ "$DRY_RUN" = 1 ]; then :
      elif not_logged_in; then logged_in=0
      elif has "Not handed off" || has "did not start" || has "delegate is turned off"; then
        bad "delegate couldn't start a helper model"; set_row delegate warn "couldn't start a helper: /delegate:setup"
      elif has "Hand-off " && has " ended:"; then good "delegate works"
      else bad "delegate gave no answer"; set_row delegate warn "the test got no answer: /delegate:setup"
      fi
    fi
    [ "$logged_in" = 1 ] || bad "Claude Code isn't logged in here: open it once and type /login."
  fi

  section "What's on"
  print_rows
}

if [ -z "$SETUP" ]; then
  if [ "$YES" = 1 ]; then SETUP=later
  else
    blank
    if confirm "Set the mods up now? Claude walks you through it in about two minutes." y; then SETUP=guided
    else SETUP=later; fi
  fi
fi
case $SETUP in
  guided)
    if [ "$HAVE_TTY" = 1 ]; then guided_setup
    else SETUP=later; fi ;;
  quick) advanced_setup ;;
esac

# ================================================================ done

blank
L=()
if [ "$DRY_RUN" = 1 ]; then L[${#L[@]}]="$YEL$WARN$R "$'\t'"Dry run: nothing was changed."
else L[${#L[@]}]="$GRN$OK$R "$'\t'"claude-modpack${VERSION_NOW:+ $VERSION_NOW} is installed."; fi
if [ "$SETUP" = later ]; then
  L[${#L[@]}]=""
  L[${#L[@]}]="Next: open Claude Code in your project and type $ACC/modpack:setup$R"
fi
if [ "$SETUP" = quick ] && [ "$DRY_RUN" = 0 ]; then
  L[${#L[@]}]="Restart Claude Code if it's open, to load your choices."
fi
L[${#L[@]}]=""
L[${#L[@]}]="In Claude Code, type:"
for c in "/mods|turn mods on or off" "/modpack:setup|set them up (again)" "/modpack-update|get the newest release"; do
  if [ "$W" -ge 46 ]; then   # two columns where they fit, else the words under the command
    printf -v pad '%-17s' "${c%%|*}"
    L[${#L[@]}]="  $ACC${pad%% *}$R${pad#"${c%%|*}"}"$'\t'"${c#*|}"
  else
    L[${#L[@]}]="  $ACC${c%%|*}$R"
    L[${#L[@]}]="    "$'\t'"${c#*|}"
  fi
done
box "Done" "${L[@]}"
blank
exit "$FAILED"
