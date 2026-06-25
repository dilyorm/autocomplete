#!/usr/bin/env node
import { load, configCli } from '../src/config.js';
import { startRelay } from '../src/relay.js';

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '-h' || args[0] === '--help') {
  console.log(`acomplete — Tab autocomplete for terminal coding agents

usage:
  acomplete <agent...>     wrap an agent, e.g.  acomplete claude   |   acomplete codex
  acomplete config         show config
  acomplete config k=v ... set config (mode, provider, apiKey, model, proxyUrl, debounceMs)

modes: auto (reuse Claude login token) | free (proxy) | byo (your key)`);
  process.exit(0);
}

if (args[0] === 'config') {
  configCli(args.slice(1));
  process.exit(0);
}

startRelay(args, load());
