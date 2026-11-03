#!/bin/sh
# Prints the Homebrew cask for a release: packaging/troy.rb with the version and the
# checksums of its two zips filled in. The Cask workflow pushes the result to the tap.
# Usage: scripts/cask.sh 1.2.0 Troy-1.2.0-mac-arm64.zip Troy-1.2.0-mac-x64.zip
set -eu

template="$(dirname "$0")/../packaging/troy.rb"
version=$1

# It goes into a sed pattern and a URL, so only plain release numbers.
case $version in
  '' | *[!0-9.]*) echo "cask.sh: $version is not a release version" >&2; exit 1 ;;
esac
# A template with real values pasted back in would push stale checksums without a word.
for placeholder in __VERSION__ __SHA256_ARM64__ __SHA256_X64__; do
  grep -q "$placeholder" "$template" || {
    echo "cask.sh: $placeholder is missing from packaging/troy.rb" >&2
    exit 1
  }
done

# No pipe: a missing zip must stop the script, not leave an empty checksum.
arm=$(shasum -a 256 "$2")
x64=$(shasum -a 256 "$3")
arm=${arm%% *}
x64=${x64%% *}
sed -e "s/__VERSION__/$version/g" -e "s/__SHA256_ARM64__/$arm/g" -e "s/__SHA256_X64__/$x64/g" \
  "$template"
