# Cask for the personal tap: copy to github.com/m44abdel/homebrew-tap as Casks/troy.rb
# and bump `version` for each release. Install with: brew install m44abdel/tap/troy
cask "troy" do
  arch arm: "arm64", intel: "x64"

  version "1.0.0"
  # ponytail: no checksum while releases are rebuilt often; pin per-arch sha256 once they settle.
  sha256 :no_check

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
