# Troy

Run coding agents (Claude Code, Codex, Gemini, …) side by side, each in its own git worktree, in a desktop app that never steals your terminal shortcuts.

> Early development. Today: add repos, create and archive worktrees, run an agent plus a shell in each, review the diff and ship it, and see how full each agent's context window is.

## Worktrees

**⌘N** asks for a branch, a base branch (defaults to the remote's default branch), an agent CLI and an optional first prompt. Troy fetches the base, runs `git worktree add` into a sibling directory `<repo>.<branch>`, then bootstraps it:

- copies untracked files matching the globs in `.troy/copy` (default `.env*`) from the main checkout
- gives each worktree its own `PORT_BASE` (3100, 3200, …) so dev servers don't collide
- runs `.troy/setup.sh` in the shell pane if the worktree has one (e.g. `npm i`)

The agent pane waits for Enter before starting, so setup can finish first. The sidebar dot shows the agent's state: running (output flowing), waiting (quiet or rang the bell), done, or error (non-zero exit).

## Context window

For Claude Code and Codex, Troy reads the agent's own session logs (`~/.claude/projects`, `~/.codex/sessions`; read-only, no API keys) and shows how full the context window is: a thin bar under each worktree in the sidebar, and the **Context** tab with tokens used, window size and a warning from 80%. Other CLIs show as unknown rather than a guess.

## Review and finish

The **Diff** tab (**⌘D**) shows everything the worktree changed since it branched off its base: commits, uncommitted edits and new files. Click a line number to leave a comment; **⌘Enter** pastes all comments into the agent as one message for you to send. The toolbar commits everything, pushes the branch, or opens its pull request in the browser via the [GitHub CLI](https://cli.github.com) (`gh`), creating one if it doesn't exist yet.

**⌘W** archives the worktree (`git worktree remove`, optionally deleting the branch). Git refuses if there are uncommitted changes, and the primary checkout can't be archived.

## Keyboard

App shortcuts use **⌘** on macOS (**Ctrl+Shift** on Linux/Windows). Every Ctrl and Alt chord goes straight to the terminal, so Ctrl-P, Ctrl-T, Ctrl-O, Alt-f and friends keep working inside your shell and agent.

| Shortcut | Action |
| --- | --- |
| ⌘O | Add a repository |
| ⌘N | New worktree |
| ⌘W | Archive worktree |
| ⌘1–9 | Jump to worktree |
| ⌘[ / ⌘] | Previous / next worktree |
| ⌘J / ⌘E | Focus agent / shell |
| ⌘D | Show the diff |
| ⌘Enter | Send review comments to the agent |
| ⌘\\ | Toggle the right column |

## Development

```bash
npm install
npm run dev        # run the app with hot reload
npm test           # unit tests
npm run test:e2e   # build, then drive the real app with Playwright
npm run build:mac  # package a .dmg
```

## License

[MIT](LICENSE)
