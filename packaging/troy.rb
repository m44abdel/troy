# Cask for the personal tap: copy to github.com/m44abdel/homebrew-tap as Casks/troy.rb
# and bump `version` and both `sha256` values (`shasum -a 256` of each zip) for each release. Install with: brew install m44abdel/tap/troy
cask "troy" do
  arch arm: "arm64", intel: "x64"

  version "1.0.1"
  sha256 arm:   "058c8dd852a0f413d75520a6ca3b184bc0fe353313bde4fb242c1810641eac51",
         intel: "0deaaf34ba7bc7959a7ccb6a83ed4fafba09265987b93204824425c3c1939645"

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
