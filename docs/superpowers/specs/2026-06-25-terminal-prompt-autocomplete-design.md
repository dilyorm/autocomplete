# Terminal Prompt Autocomplete — Design

**Date:** 2026-06-25
**Status:** Approved for planning

## Goal

A Tab-to-accept autocomplete/suggester for the prompt you type into terminal
coding agents (**Claude Code**, **Codex**). As you write a prompt, a suggestion
appears; pressing **Tab** accepts it. Suggestions are context-aware: they use
the conversation so far, the agent's installed skills, and the partial prompt
already typed. Easy to install, maximum comfort.

## Hard constraints discovered (why the design is shaped this way)

These were verified against current Claude Code docs, not assumed:

1. **No keystroke / ghost-text / autocomplete extension point exists.** Claude
   Code hooks (`UserPromptSubmit`, `UserPromptExpansion`) fire only on submit /
   slash-expansion, never per keystroke, and cannot inject text into the prompt
   box. **Therefore a plugin/skill/hook cannot do this. A PTY wrapper is the
   only path.**
2. **`claude -p` headless ≈ 12 s per call.** The agent's own model loop is far
   too slow for autocomplete. **The suggestion engine must be a separate fast
   call** (small model, debounced).
3. **Subscription auth only cleanly drives the heavy agent subprocess.** A fast
   completion needs a direct Messages-style API call. Reusing the Claude Code
   login token for that is **undocumented / gray-area** but accepted here.

## Architecture

Two independently shippable pieces:

- **A. Client wrapper** (`acomplete`) — the terminal tool the user runs.
- **B. Proxy server** — a tiny always-on endpoint that holds the shared
  DeepSeek key and meters the free tier. Deploys on an existing box
  (ctf / oracle per project memory).

### A. Client wrapper

Launched as `acomplete claude` or `acomplete codex` (wraps any command).
Single global install (`npm i -g`), no changes to the agent's own config.

Stack: **Node.js + `node-pty`** (ConPTY on Windows, pty elsewhere). Chosen for
ergonomic cross-platform PTY + ANSI control and easy `npm` distribution.

Components:

1. **PTY relay** — spawns the agent in a pseudo-terminal, pipes the agent's
   output straight to the real terminal and the user's keystrokes into the
   agent. Fully transparent when idle.
2. **Input tracker** — because we own the outer stdin, we mirror the user's
   current prompt buffer directly from their keystrokes (printable chars,
   Backspace, Enter→clear, Tab→accept). We do **not** parse the agent's
   redraws. *ponytail ceiling:* a state machine over keystrokes; edge cases
   (paste, history nav, multiline) handled best-effort, refined if they bite.
3. **Prompt-readiness heuristic** — only suggest when the agent is awaiting a
   prompt (not mid-stream). *ponytail ceiling:* detect "response settled"
   from an idle gap in agent output after the last Enter; upgrade if flaky.
4. **Context builder** — assembles for the model: the partial buffer + recent
   conversation (scraped from a ring buffer of the last N lines of PTY output)
   + installed skills (read from `~/.claude/skills` and plugin config) + recent
   prompt history.
5. **Suggestion engine** — debounced ~400 ms after typing stops (or on an
   explicit hotkey). Calls the configured provider/model for a completion.
   Results cached by buffer prefix. The model is instructed to return **either
   a short word completion or a fuller prompt continuation**, its choice, and
   empty when nothing is worth suggesting.
6. **Renderer** — *ponytail ceiling:* the suggestion is drawn on a **reserved
   dim status line at the bottom** of the terminal (we own the outer screen),
   via save-cursor → move to last row → write dim text → restore-cursor. **Not**
   true inline ghost text — inline would mean fighting the agent's own TUI
   redraws, which is the genuinely hard part and is deferred. **Tab** injects
   the suggestion into the agent as if typed; submit/keystroke clears it.

### B. Proxy server

Tiny HTTP service holding the shared DeepSeek key.

- `POST /suggest` `{ userId, context }` → meters **5 suggestions / hour /
  userId**, forwards to DeepSeek (`deepseek-chat` — note: DeepSeek has no
  "flash" model; that name is Gemini's), returns the completion text.
- `userId` = a stable hash of the client machine id (best-effort; not
  abuse-proof, but the key stays server-side and the rate window caps spend).
- Rate store: *ponytail ceiling:* in-memory map with an hourly sliding window;
  move to Redis only if it ever runs multi-instance.
- The DeepSeek key lives **only** on the server; the client never sees it.

## Auth / provider model

Three tiers, in order:

1. **Auto mode (default, zero setup)** — read the existing Claude Code OAuth
   token from `%USERPROFILE%\.claude\.credentials.json`, call the Anthropic
   Messages API directly with a fast model (Haiku). On 401/403/429 or missing
   token, fall through. *Gray area, accepted.*
2. **Free tier (fallback)** — call the **proxy** (tier B), DeepSeek
   `deepseek-chat`, capped 5/hr/user. On cap reached, show a one-line notice:
   *"Automode off — connect your own API key (`acomplete config`)."*
3. **Bring-your-own key** — user configures one of **Anthropic / DeepSeek /
   OpenAI / Gemini**, with a model choice. Stored in `~/.acomplete/config.json`.

A small **provider abstraction** routes a single `complete(context) → text`
call to the active tier. Adding a provider = one adapter.

## Config

`~/.acomplete/config.json`: `{ mode, provider, apiKey, model, proxyUrl,
debounceMs }`. `acomplete config` edits it.

## Error handling

- Network / provider error → silent, no suggestion (never blocks typing).
- Free-tier cap → one-line status notice with the BYO-key hint.
- Invalid/expired Claude token → drop to next tier, notify once.
- The wrapper must **never** corrupt or block the agent's I/O; on any internal
  error it degrades to a plain transparent relay.

## Testing

Unit (one runnable self-check each, no frameworks):

- Input tracker: keystroke stream → expected buffer state (incl. Backspace,
  Enter-clears, Tab-accept).
- Context builder: given a fake ring buffer + skills dir → expected context.
- Rate limiter: 6 calls in an hour → 6th rejected; window resets after an hour.
- Provider router: tier selection given config + simulated failures.

Manual: PTY relay transparency, status-line rendering, Tab injection — verified
live against real `claude` and `codex`.

## Build order

1. Client wrapper with **Auto mode + BYO key** (no proxy dependency) — provable
   end to end against a real agent.
2. Proxy server + **Free tier** wiring.
3. Renderer polish; optional word-by-word accept (Right-arrow); inline
   ghost-text upgrade if redraw-tracking proves reliable.

## Deferred (YAGNI for v1)

- True inline ghost text (vs bottom status line).
- Word-at-a-time partial accept.
- Per-agent deep state parsing (multiline editors, paste blocks).
- Non-Claude/Codex agents (architecture allows it; not targeted yet).
