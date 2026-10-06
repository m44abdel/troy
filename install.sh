#!/bin/sh
# Installs the latest Troy release into /Applications, without the Gatekeeper prompt.
#
#   curl -fsSL https://raw.githubusercontent.com/m44abdel/troy/main/install.sh | sh
#   sh install.sh --dry-run     # print every step, change nothing
#
# Re-running is safe: if that version is already installed, nothing changes.
# What it installs is recorded in a manifest, so uninstall.sh removes exactly that.
set -eu

REPO="${TROY_REPO:-m44abdel/troy}"
RELEASES="${TROY_RELEASES_URL:-https://github.com/$REPO/releases}"
APP_DIR="${TROY_APP_DIR:-/Applications}"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/troy"
MANIFEST="$STATE_DIR/install-manifest"
DRY_RUN=0

for arg in "$@"; do
  case $arg in
    --dry-run) DRY_RUN=1 ;;
    -h | --help)
      sed -n '2,8s/^# \{0,1\}//p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (try --help)" >&2
      exit 2
      ;;
  esac
done

say() { printf '%s\n' "$*"; }
fail() {
  say "Error: $*" >&2
  exit 1
}
run() {
  if [ "$DRY_RUN" = 1 ]; then say "would run: $*"; else "$@"; fi
}

[ "$(uname -s)" = Darwin ] || fail "the installer is macOS-only for now."
case $(uname -m) in
  arm64) ARCH=arm64 ;;
  x86_64) ARCH=x64 ;;
  *) fail "unsupported CPU: $(uname -m)" ;;
esac

if [ -n "${TROY_VERSION:-}" ]; then
  VERSION=$TROY_VERSION
else
  # GitHub redirects releases/latest to .../tag/v<version>.
  LATEST=$(curl -fsSLI -o /dev/null -w '%{url_effective}' "$RELEASES/latest") ||
    fail "could not reach $RELEASES"
  VERSION=${LATEST##*/v}
fi
case $VERSION in
  '' | *[!0-9A-Za-z.-]*) fail "could not work out the latest version (got '$VERSION')." ;;
esac

APP="$APP_DIR/Troy.app"
INSTALLED=$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' \
  "$APP/Contents/Info.plist" 2>/dev/null || true)
if [ "$INSTALLED" = "$VERSION" ]; then
  say "Troy $VERSION is already installed at $APP. Nothing to do."
  exit 0
fi

if [ ! -d "$APP_DIR" ] || [ ! -w "$APP_DIR" ]; then
  fail "$APP_DIR is not writable. Re-run with TROY_APP_DIR=\"\$HOME/Applications\"."
fi

ZIP="Troy-$VERSION-mac-$ARCH.zip"
URL="$RELEASES/download/v$VERSION/$ZIP"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

say "Installing Troy $VERSION ($ARCH)${INSTALLED:+, replacing $INSTALLED,} into $APP_DIR"
run curl -fSL --progress-bar -o "$TMP/$ZIP" "$URL"
run ditto -x -k "$TMP/$ZIP" "$TMP/unpacked"
# Troy is ad-hoc signed, not notarized; without the quarantine flag macOS opens it directly.
run xattr -cr "$TMP/unpacked/Troy.app"
if [ -e "$APP" ]; then run rm -rf "$APP"; fi
run mv "$TMP/unpacked/Troy.app" "$APP"
run mkdir -p "$STATE_DIR"
if [ "$DRY_RUN" = 1 ]; then
  say "would record $APP in $MANIFEST"
else
  printf '%s\n' "$APP" >"$MANIFEST"
fi

say "Done. Open Troy from $APP_DIR, or run: open \"$APP\""
