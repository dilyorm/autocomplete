# acomplete

Tab autocomplete for prompts you type into terminal coding agents (Claude Code, Codex).
Wraps the agent in a pseudo-terminal, watches your partial prompt, and shows a
context-aware suggestion on a dim status line at the bottom. **Tab** accepts it.

## Install

```
npm i -g .
```

## Use

```
acomplete claude      # or:  acomplete codex   (wraps any command)
```

Type a prompt, pause ~400ms, a suggestion appears at the bottom. Press **Tab** to accept.

## Auth modes (`acomplete config`)

- **auto** (default) — reuses your Claude Code login token (`~/.claude/.credentials.json`)
  to call Haiku. Zero setup. *(Undocumented token reuse; falls back silently on failure.)*
- **free** — calls a metered proxy (5 suggestions/hr). Needs `proxyUrl` set (proxy is step 2).
- **byo** — your own key:
  ```
  acomplete config mode=byo provider=deepseek apiKey=sk-... model=deepseek-chat
  ```
  Providers: `anthropic | deepseek | openai | gemini`.

## Status

v1: client wrapper, **auto + byo** working. Suggestion shows on a bottom status line
(not true inline ghost text — deferred). Free-tier proxy + per-user rate limit = next step.

See `docs/superpowers/specs/2026-06-25-terminal-prompt-autocomplete-design.md`.
