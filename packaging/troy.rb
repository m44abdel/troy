# Homebrew cask for Troy. Install with: brew install m44abdel/tap/troy
# The tap's Casks/troy.rb is made from packaging/troy.rb in m44abdel/troy whenever a release is
# published: .github/workflows/cask.yml fills in the version and checksums. Edit it there.
cask "troy" do
  arch arm: "arm64", intel: "x64"

  version "__VERSION__"
  sha256 arm:   "__SHA256_ARM64__",
         intel: "__SHA256_X64__"

  url "https://github.com/m44abdel/troy/releases/download/v#{version}/Troy-#{version}-mac-#{arch}.zip"
  name "Troy"
  desc "Run coding agents side by side in git worktrees"
  homepage "https://github.com/m44abdel/troy"

  depends_on macos: ">= :monterey"

  app "Troy.app"

  # Troy is ad-hoc signed but not notarized, so clear the quarantine flag Homebrew sets.
  postflight do
    system_command "/usr/bin/xattr", args: ["-cr", "#{appdir}/Troy.app"]
  end

  zap trash: "~/Library/Application Support/Troy"
end
