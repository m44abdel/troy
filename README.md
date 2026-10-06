# Troy

Run coding agents (Claude Code, Codex, Gemini, …) side by side, each in its own git worktree, in a desktop app that never steals your terminal shortcuts.

> Early development. Today: add repos and get a real terminal per repo.

## Keyboard

App shortcuts use **⌘** on macOS (**Ctrl+Shift** on Linux/Windows). Every Ctrl and Alt chord goes straight to the terminal, so Ctrl-P, Ctrl-T, Ctrl-O, Alt-f and friends keep working inside your shell and agent.

| Shortcut | Action |
| --- | --- |
| ⌘O | Add a repository |
| ⌘1–9 | Jump to repository |
| ⌘[ / ⌘] | Previous / next repository |

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
