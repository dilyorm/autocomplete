# acomplete

**Inline Tab autocomplete for the prompts you type into terminal coding agents** — Claude Code, Codex, or any CLI. As you type, a grey ghost-text suggestion appears right after your cursor. Press **Tab** to accept, keep typing to ignore.

[![npm](https://img.shields.io/npm/v/acomplete.svg)](https://www.npmjs.com/package/acomplete)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)

```
❯ add a dark mode toggle␣that persists the preference in localStorage
  └ you typed ──────────┘ └─ grey ghost text, press Tab ──────────────┘
```

## Why

Terminal agents own their input box — there's no plugin hook for autocomplete. `acomplete` wraps the agent in a pseudo-terminal, watches what you type, and renders context-aware suggestions inline. It works with **any** terminal program; it's tuned for coding agents.

## Features

- **Inline ghost text** — dim suggestion at the cursor, not a popup.
- **Context-aware** — uses your partial prompt, the recent conversation on screen, and your installed Claude Code skills.
- **One key** — `Tab` accepts, `Shift+Backspace` undoes the last accepted suggestion, typing dismisses.
- **Zero-setup auth** — reuses your existing Claude Code login by default. No API key needed.
- **Bring your own model** — or plug in Anthropic / DeepSeek / OpenAI / Gemini.
- **Never in your way** — on any error it degrades to a plain transparent passthrough.

## Install

```bash
npm install -g acomplete
```

Or straight from GitHub:

```bash
npm install -g github:dilyorm/autocomplete
```

Requires Node ≥ 18.

## Usage

Wrap any agent:

```bash
acomplete claude     # Claude Code
acomplete codex      # Codex
acomplete <anything> # any CLI
```

Type a prompt, pause briefly, and a grey suggestion appears. **Tab** to accept.

| Key | Action |
| --- | --- |
| `Tab` | accept the suggestion |
| `Shift+Backspace` | undo the last accepted suggestion *(Windows)* |
| *keep typing* | dismiss / refine |

## Configuration

```bash
acomplete config                       # show current config
acomplete config <key>=<value> ...     # set values
```

| Key | Values | Default |
| --- | --- | --- |
| `mode` | `auto` · `free` · `byo` | `auto` |
| `provider` | `anthropic` · `deepseek` · `openai` · `gemini` | `anthropic` |
| `apiKey` | your provider key (for `byo`) | – |
| `model` | model id (blank = a fast default) | – |
| `debounceMs` | ms of idle before suggesting | `400` |

**Auth modes**

- **`auto`** *(default)* — reuses the Claude Code login token in `~/.claude/.credentials.json` to call a fast model. Zero setup.
- **`byo`** — your own provider key:
  ```bash
  acomplete config mode=byo provider=deepseek apiKey=sk-... model=deepseek-chat
  ```
- **`free`** — a hosted, rate-limited proxy (set `proxyUrl`). *(optional / self-host)*

## How it works

```
your keyboard ──▶ acomplete (PTY wrapper) ──▶ agent (claude / codex)
                     │  mirrors your prompt buffer from keystrokes
                     │  debounced call to a fast model for a completion
                     ▼
              grey ghost text drawn at the cursor; Tab injects it
```

It mirrors your input from raw keystrokes (decoding Windows `win32-input-mode` records), so it never has to parse the agent's screen. Suggestions come from a separate fast model call — the agent's own loop is too slow for live completion.

## Limitations

- **Inline render assumes a single-line prompt.** Very long / wrapped input degrades gracefully (skips the draw).
- **`Shift+Backspace` undo is Windows-only** for now (relies on `win32-input-mode` modifier reporting).
- **`auto` mode reuses the Claude Code login token** — convenient but undocumented; it falls back silently if the token is missing or rejected.
- Bracketed-paste and Ctrl-modified characters are best-effort in the buffer mirror.

## Roadmap

- [ ] Cross-platform `Shift+Backspace` undo
- [ ] Word-at-a-time accept (`→`)
- [ ] Multi-line / wrapped prompt rendering
- [ ] Self-hostable free-tier proxy
- [ ] Demo GIF

## Contributing

Issues and PRs welcome. Run the tests:

```bash
npm test
```

Debug log (writes to `~/.acomplete/debug.log`):

```bash
ACOMPLETE_DEBUG=1 acomplete claude
```

## License

MIT © dilyorm
