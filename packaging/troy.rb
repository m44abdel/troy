# Cask for the personal tap: copy to github.com/m44abdel/homebrew-tap as Casks/troy.rb
# and bump `version` and both `sha256` values (`shasum -a 256` of each zip) for each release. Install with: brew install m44abdel/tap/troy
cask "troy" do
  arch arm: "arm64", intel: "x64"

  version "1.0.0"
  sha256 arm:   "85ab5bfa7a7a8b162b432de463b9198f14f2a38bfe35cc6beaa376773a4959c1",
         intel: "d457abab5468ee4187691f13b12b55285c9a485daa598397ce6ead2e92b54877"

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
