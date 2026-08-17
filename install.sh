#!/usr/bin/env bash
# Installs (or removes) eco for Codex - the CLI and Codex in the ChatGPT desktop
# app read the same files, so one install covers both.
#
# Two things get installed, and the order reflects which one does the work:
#
#   1. THE RULES, appended to $CODEX_HOME/AGENTS.md. Codex loads AGENTS.md into the
#      prompt itself, on every turn, at every reasoning effort, on every model. This
#      is the surface that measured an effect.
#   2. THE SKILLS (eco, eco-max) into the skills directory, for `$eco setup` and for
#      turning the mode on inside a single thread. Codex publishes only a skill's name
#      and description to the model; the body has to be read from disk with a shell
#      command first, which is one extra round trip - so this is the secondary path,
#      not the main one. `bench/preregistration/001-first-study.md` has the numbers.
#
# Usage
#   ./install.sh                 rules (global) + skills
#   ./install.sh --rules-only    just the AGENTS.md block
#   ./install.sh --skills-only   just the skills
#   ./install.sh --project       write the block into ./AGENTS.md instead of the global one
#   ./install.sh --full          install the complete rule block instead of the short one
#   ./install.sh --uninstall     remove the block and the skill directories
#   ./install.sh --help
#
# The old version copied over whatever was there, so a skill you had edited was
# gone without a trace and files removed from a newer release stayed behind for
# ever. This one moves the existing copy to a timestamped backup first - which
# also clears stale files, because the destination is recreated, not merged - and
# then verifies every installed byte against the source.
#
# Backups live in <parent of the skills dir>/.eco-backups, deliberately outside
# the skills directory: a copy named "eco-20260101-000000" sitting next to the
# real one would still say `name: eco` in its frontmatter, and the CLI would see
# two skills claiming one name.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_NAMES="eco eco-max"
SRC_ROOT="$REPO_ROOT/plugins/eco/skills"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
MODE="install"
DO_RULES=1
DO_SKILLS=1
RULES_SCOPE="global"
RULES_SRC="$REPO_ROOT/AGENTS.eco.lean.md"
RULES_LABEL="short"
BLOCK_START="<!-- codex-eco:start -->"
BLOCK_END="<!-- codex-eco:end -->"

usage() {
  cat <<'EOF'
Installs (or removes) eco for Codex. One install covers the CLI and Codex in the
ChatGPT desktop app, which read the same files.

  1. the rules, appended to $CODEX_HOME/AGENTS.md (default ~/.codex/AGENTS.md), which
     Codex loads into the prompt on every turn at no extra round trip;
  2. the skills eco and eco-max, into ${CODEX_SKILLS_DIR:-$HOME/.agents/skills}.

Usage
  ./install.sh                 rules (global) + skills
  ./install.sh --rules-only    just the AGENTS.md block
  ./install.sh --skills-only   just the skills
  ./install.sh --project       write the block into ./AGENTS.md instead of the global one
  ./install.sh --full          the complete rule block instead of the short one
  ./install.sh --uninstall     remove the block and the skill directories
  ./install.sh --help

The AGENTS.md block is delimited by <!-- codex-eco:start --> / <!-- codex-eco:end -->,
so re-running replaces it in place instead of appending a second copy, and --uninstall
removes exactly it and leaves the rest of your file alone. Any file about to change is
copied to <dir>/.eco-backups/<name>-<utc stamp> first, and skill trees are verified
byte for byte after the copy.
EOF
}

die() {
  echo "install.sh: $1" >&2
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --uninstall) MODE="uninstall" ;;
    --rules-only) DO_SKILLS=0 ;;
    --skills-only) DO_RULES=0 ;;
    --project) RULES_SCOPE="project" ;;
    --full)
      RULES_SRC="$REPO_ROOT/AGENTS.eco.md"
      RULES_LABEL="full"
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) die "unknown argument \"$1\" (try --help)" ;;
  esac
  shift
done

if [ -n "${CODEX_SKILLS_DIR:-}" ]; then
  DEST="$CODEX_SKILLS_DIR"
  ORIGIN="CODEX_SKILLS_DIR"
else
  [ -n "${HOME:-}" ] || die "neither CODEX_SKILLS_DIR nor HOME is set - point CODEX_SKILLS_DIR at your skills directory"
  DEST="$HOME/.agents/skills"
  ORIGIN="default"
fi
BACKUP_ROOT="$(dirname "$DEST")/.eco-backups"

# Same file list, same bytes - the check that answers both "is it already
# installed?" and "did the copy land intact?".
trees_match() {
  local a="$1" b="$2" rel list_a list_b
  [ -d "$a" ] && [ -d "$b" ] || return 1
  list_a="$(cd "$a" && find . -type f | LC_ALL=C sort)"
  list_b="$(cd "$b" && find . -type f | LC_ALL=C sort)"
  [ "$list_a" = "$list_b" ] || return 1
  while IFS= read -r rel; do
    [ -n "$rel" ] || continue
    cmp -s "$a/$rel" "$b/$rel" || return 1
  done <<< "$list_a"
  return 0
}

move_to_backup() {
  # Separate `local` statements on purpose: a variable assigned in the same
  # `local` is not reliably readable by the assignments after it (SC2318).
  local src="$1"
  local name="$2"
  local target="$BACKUP_ROOT/$name-$STAMP"
  local n=1
  # Two runs inside the same second must not nest one backup inside the other.
  while [ -e "$target" ]; do
    target="$BACKUP_ROOT/$name-$STAMP-$n"
    n=$((n + 1))
  done
  mkdir -p "$BACKUP_ROOT"
  mv "$src" "$target"
  printf '%s' "$target"
}

count_files() {
  find "$1" -type f | wc -l | tr -d ' '
}

# --- the rules block ------------------------------------------------------------

# Where the global AGENTS.md lives. Codex reads $CODEX_HOME/AGENTS.md for every
# session regardless of which project you are in; that was verified with
# `codex debug prompt-input`, which renders the exact model-visible prompt offline.
rules_target() {
  if [ "$RULES_SCOPE" = "project" ]; then
    printf '%s' "$PWD/AGENTS.md"
    return
  fi
  if [ -n "${CODEX_HOME:-}" ]; then
    printf '%s' "$CODEX_HOME/AGENTS.md"
  else
    [ -n "${HOME:-}" ] || die "neither CODEX_HOME nor HOME is set - set one, or use --project"
    printf '%s' "$HOME/.codex/AGENTS.md"
  fi
}

# Only the marker-delimited region, so the explanatory comment around it in the
# repository is not billed as tokens in every one of the user's turns.
extract_block() {
  awk -v s="$BLOCK_START" -v e="$BLOCK_END" '
    index($0, s) { inside = 1 }
    inside { print }
    index($0, e) { if (inside) exit }
  ' "$1"
}

# Everything except a previously installed block. Used both to replace on re-install
# and to remove on uninstall, so the two can never disagree about what the block is.
strip_block() {
  awk -v s="$BLOCK_START" -v e="$BLOCK_END" '
    index($0, s) { inside = 1; next }
    index($0, e) { if (inside) { inside = 0; next } }
    inside { next }
    { print }
  ' "$1"
}

has_block() {
  [ -f "$1" ] && grep -qF "$BLOCK_START" "$1"
}

backup_file() {
  local src="$1"
  local dir
  local target
  local n=1
  dir="$(dirname "$src")/.eco-backups"
  target="$dir/$(basename "$src")-$STAMP"
  while [ -e "$target" ]; do
    target="$dir/$(basename "$src")-$STAMP-$n"
    n=$((n + 1))
  done
  mkdir -p "$dir"
  cp "$src" "$target"
  printf '%s' "$target"
}

install_rules() {
  local target block tmp kept backup
  target="$(rules_target)"
  [ -f "$RULES_SRC" ] ||
    die "missing rule source: $RULES_SRC - run this from a full clone of the repository"
  block="$(extract_block "$RULES_SRC")"
  [ -n "$block" ] || die "no $BLOCK_START ... $BLOCK_END region in $RULES_SRC"

  mkdir -p "$(dirname "$target")"
  tmp="$(mktemp)"
  if [ -f "$target" ]; then
    backup="$(backup_file "$target")"
    kept="$(strip_block "$target")"
    # Trailing blank lines would multiply on every re-install.
    printf '%s
' "$kept" | sed -e :a -e '/^[[:space:]]*$/{$d;N;ba' -e '}' > "$tmp"
    if [ -s "$tmp" ]; then printf '
' >> "$tmp"; fi
    printf '%s
' "$block" >> "$tmp"
    mv "$tmp" "$target"
    if has_block "$backup"; then
      echo "  rules: block replaced in $target ($RULES_LABEL, $(wc -c < "$target" | tr -d ' ') bytes total; previous file at $backup)"
    else
      echo "  rules: block appended to $target ($RULES_LABEL; previous file at $backup)"
    fi
  else
    printf '%s
' "$block" > "$target"
    echo "  rules: created $target with the $RULES_LABEL block ($(wc -c < "$target" | tr -d ' ') bytes)"
  fi

  grep -qF "$BLOCK_START" "$target" ||
    die "verification failed: $BLOCK_START is not present in $target after writing"
  grep -qF "$BLOCK_END" "$target" ||
    die "verification failed: $BLOCK_END is not present in $target after writing"
}

uninstall_rules() {
  local target tmp backup
  target="$(rules_target)"
  if ! has_block "$target"; then
    echo "  rules: no codex-eco block in ${target} - nothing to remove"
    return
  fi
  backup="$(backup_file "$target")"
  tmp="$(mktemp)"
  strip_block "$target" | sed -e :a -e '/^[[:space:]]*$/{$d;N;ba' -e '}' > "$tmp"
  if [ -s "$tmp" ]; then
    printf '
' >> "$tmp"
    mv "$tmp" "$target"
    echo "  rules: block removed from $target (copy of the previous file at $backup)"
  else
    rm -f "$tmp"
    rm -f "$target"
    echo "  rules: block removed and $target deleted, since the block was all it contained (copy at $backup)"
  fi
  if [ -f "$target" ] && grep -qF "$BLOCK_START" "$target"; then
    die "verification failed: the block is still present in $target"
  fi
}



echo "codex-eco"
if [ "$DO_RULES" -eq 1 ]; then
  echo "  rules:      $(rules_target) ($RULES_SCOPE, $RULES_LABEL block)"
fi
if [ "$DO_SKILLS" -eq 1 ]; then
  echo "  source:     $SRC_ROOT"
  echo "  skills dir: $DEST ($ORIGIN)"
fi

if [ "$MODE" = "uninstall" ]; then
  if [ "$DO_RULES" -eq 1 ]; then
    uninstall_rules
  fi
  if [ "$DO_SKILLS" -eq 0 ]; then
    exit 0
  fi
  removed=0
  for name in $SKILL_NAMES; do
    dst="$DEST/$name"
    if [ -e "$dst" ]; then
      target="$(move_to_backup "$dst" "$name")"
      echo "  $name: removed (copy kept at $target)"
      removed=$((removed + 1))
    else
      echo "  $name: not installed, nothing to remove"
    fi
  done
  echo "Removed $removed of $(set -- $SKILL_NAMES; echo $#) skill directories from $DEST."
  exit 0
fi

if [ "$DO_RULES" -eq 1 ]; then
  install_rules
fi

if [ "$DO_SKILLS" -eq 0 ]; then
  echo 'The rules are on for every new Codex session. Nothing to invoke.'
  exit 0
fi

for name in $SKILL_NAMES; do
  [ -f "$SRC_ROOT/$name/SKILL.md" ] ||
    die "missing source skill: $SRC_ROOT/$name/SKILL.md - run this from a full clone of the repository"
done

mkdir -p "$DEST"
changed=0
STAGE_ROOT="$(mktemp -d)"
trap 'rm -rf "$STAGE_ROOT"' EXIT

for name in $SKILL_NAMES; do
  src="$STAGE_ROOT/$name"
  dst="$DEST/$name"
  cp -R "$SRC_ROOT/$name" "$src"
  if trees_match "$src" "$dst"; then
    echo "  $name: already up to date ($(count_files "$dst") files)"
    continue
  fi
  if [ -e "$dst" ]; then
    target="$(move_to_backup "$dst" "$name")"
    echo "  $name: previous copy backed up to $target"
  fi
  cp -R "$src" "$dst"
  trees_match "$src" "$dst" || die "copy verification failed: $dst does not match $src"
  echo "  $name: installed and verified ($(count_files "$dst") files)"
  changed=$((changed + 1))
done

total="$(set -- $SKILL_NAMES; echo $#)"
if [ "$changed" -eq 0 ]; then
  echo "Nothing to do - all $total skills were already current."
else
  echo "Installed $changed of $total skills to $DEST."
fi
if [ "$DO_RULES" -eq 1 ]; then
  echo 'The rules are on for every new Codex session - nothing to invoke.'
  echo 'The skills are there for `$eco setup` (config levers) and for switching the mode on'
  echo 'inside a single thread; note that invoking one costs an extra round trip to read it.'
else
  echo 'Start a new Codex session and type $eco (CLI) or @eco (desktop app) to activate.'
fi
