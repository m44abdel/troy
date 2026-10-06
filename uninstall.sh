#!/bin/sh
# Removes exactly what install.sh installed, as listed in its manifest.
#
#   sh uninstall.sh             # remove Troy
#   sh uninstall.sh --dry-run   # print every step, change nothing
#
# Your settings in ~/Library/Application Support/Troy are kept.
set -eu

STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/troy"
MANIFEST="$STATE_DIR/install-manifest"
DRY_RUN=0

for arg in "$@"; do
  case $arg in
    --dry-run) DRY_RUN=1 ;;
    -h | --help)
      sed -n '2,7s/^# \{0,1\}//p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (try --help)" >&2
      exit 2
      ;;
  esac
done

say() { printf '%s\n' "$*"; }
run() {
  if [ "$DRY_RUN" = 1 ]; then say "would run: $*"; else "$@"; fi
}

if [ ! -f "$MANIFEST" ]; then
  say "Nothing to uninstall: no install manifest at $MANIFEST."
  exit 0
fi

while IFS= read -r path; do
  # Only ever delete a Troy.app bundle, whatever the manifest says.
  case $path in
    /*/Troy.app) ;;
    *)
      say "Skipping unexpected manifest entry: $path"
      continue
      ;;
  esac
  if [ -e "$path" ]; then
    run rm -rf "$path"
  else
    say "Already gone: $path"
  fi
done <"$MANIFEST"

run rm -f "$MANIFEST"
run rmdir "$STATE_DIR" 2>/dev/null || true
say "Troy is uninstalled. Settings remain in ~/Library/Application Support/Troy."
