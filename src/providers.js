import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const FAST = {
  anthropic: 'claude-haiku-4-5',
  deepseek: 'deepseek-chat',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.0-flash'
};

const SYSTEM =
  'You are an inline autocomplete for prompts a developer is typing to a ' +
  'terminal coding agent. Output ONLY the raw text that should continue from ' +
  'the cursor — do NOT repeat what they typed. No preamble, no explanation, no ' +
  'questions, no quotes, no markdown. If you cannot confidently continue, ' +
  'output NOTHING (an empty response). Never describe or comment on the input. ' +
  'Keep it natural: a few words up to one sentence.';

const REPHRASE_SYSTEM =
  'You rewrite a prompt a developer is typing to a terminal coding agent so it ' +
  'is clearer, more specific, and well-structured, while preserving their intent ' +
  'and every concrete detail. Output ONLY the rewritten prompt as plain text — ' +
  'no preamble, no quotes, no markdown, no explanation, no extra options.';

// Reject chatty refusals / meta-commentary the model emits instead of a completion.
const JUNK = [
  "i don't", "i do not", "i can't", "i cannot", "i'm unable", "i am unable",
  'enough context', 'not enough', 'could you', 'please provide', 'provide more',
  'partial prompt', 'appears to', 'i need', "i'm not sure", 'as an ai',
  'no good completion', 'unclear', "let me know"
];
function isJunk(t) {
  if (!t) return true;
  const l = t.toLowerCase();
  if (t.trim().endsWith('?')) return true;
  return JUNK.some(p => l.includes(p));
}

function userMsg({ buffer, conversation, skills }) {
  return [
    skills?.length ? `Installed skills:\n${skills.join('\n')}` : '',
    conversation ? `Recent conversation:\n${conversation}` : '',
    `Partial prompt (complete its continuation):\n${buffer}`
  ].filter(Boolean).join('\n\n');
}

function rewriteMsg({ buffer, conversation, skills }) {
  return [
    skills?.length ? `Installed skills:\n${skills.join('\n')}` : '',
    conversation ? `Recent conversation:\n${conversation}` : '',
    `Prompt to rewrite:\n${buffer}`
  ].filter(Boolean).join('\n\n');
}

// Trim a rewrite to a bare prompt: drop wrapping quotes/whitespace. Unlike the
// completion path we do NOT run isJunk — a rewrite legitimately restates intent.
function cleanRewrite(t) {
  return (t || '').replace(/^[\r\n]+/, '').trim()
    .replace(/^["'`]+/, '').replace(/["'`]+$/, '').trim();
}

// Strip a leading echo of the buffer if the model repeated it anyway.
// Keep a leading space (so "add" + " a toggle" doesn't glue), trim only the end.
function clean(text, buffer) {
  let t = (text || '').replace(/^[\r\n]+/, '').replace(/\s+$/, '');
  t = t.replace(/^["'`]/, '').replace(/["'`]$/, '');
  if (buffer && t.toLowerCase().startsWith(buffer.toLowerCase())) t = t.slice(buffer.length);
  if (isJunk(t)) return '';
  return t;
}

function claudeToken() {
  const f = join(homedir(), '.claude', '.credentials.json');
  if (!existsSync(f)) return '';
  try {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    return j?.claudeAiOauth?.accessToken || j?.accessToken || '';
  } catch { return ''; }
}

async function anthropic({ token, apiKey, model, system, content, maxTokens }) {
  const headers = { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' };
  if (apiKey) headers['x-api-key'] = apiKey;
  else headers['authorization'] = `Bearer ${token}`;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers,
    body: JSON.stringify({
      model: model || FAST.anthropic, max_tokens: maxTokens, system,
      messages: [{ role: 'user', content }]
    })
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}`);
  const j = await r.json();
  return j?.content?.[0]?.text || '';
}

async function openaiLike({ url, apiKey, model, system, content, maxTokens, fallbackModel }) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: model || fallbackModel, max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, { role: 'user', content }]
    })
  });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  const j = await r.json();
  return j?.choices?.[0]?.message?.content || '';
}

async function gemini({ apiKey, model, system, content, maxTokens }) {
  const m = model || FAST.gemini;
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`,
    {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: content }] }],
        generationConfig: { maxOutputTokens: maxTokens }
      })
    });
  if (!r.ok) throw new Error(`gemini ${r.status}`);
  const j = await r.json();
  return j?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function callProvider(provider, { apiKey, model, system, content, maxTokens }) {
  switch (provider) {
    case 'anthropic': return anthropic({ apiKey, model, system, content, maxTokens });
    case 'deepseek': return openaiLike({ url: 'https://api.deepseek.com/chat/completions', apiKey, model, system, content, maxTokens, fallbackModel: FAST.deepseek });
    case 'openai': return openaiLike({ url: 'https://api.openai.com/v1/chat/completions', apiKey, model, system, content, maxTokens, fallbackModel: FAST.openai });
    case 'gemini': return gemini({ apiKey, model, system, content, maxTokens });
    default: throw new Error(`unknown provider ${provider}`);
  }
}

// Returns the cleaned completion suffix, or '' on any failure (never throws).
export async function complete(cfg, ctx) {
  try {
    const system = SYSTEM, content = userMsg(ctx), maxTokens = 64;
    let text = '';
    if (cfg.mode === 'auto') {
      const token = claudeToken();
      if (!token) throw new Error('no claude token');
      text = await anthropic({ token, model: cfg.model, system, content, maxTokens });
    } else if (cfg.mode === 'free') {
      if (!cfg.proxyUrl) throw new Error('no proxyUrl');     // proxy wired in step 2
      const r = await fetch(cfg.proxyUrl, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: cfg.userId || 'anon', context: ctx })
      });
      if (r.status === 429) throw new Error('free-limit');
      if (!r.ok) throw new Error(`proxy ${r.status}`);
      text = (await r.json())?.text || '';
    } else { // byo
      if (!cfg.apiKey) throw new Error('no apiKey');
      text = await callProvider(cfg.provider, { apiKey: cfg.apiKey, model: cfg.model, system, content, maxTokens });
    }
    return clean(text, ctx.buffer);
  } catch {
    return '';
  }
}

// Returns a rewritten version of the whole prompt, or '' on any failure.
// free (proxy) mode doesn't support rephrase yet, so it no-ops there.
export async function rephrase(cfg, ctx) {
  try {
    const system = REPHRASE_SYSTEM, content = rewriteMsg(ctx), maxTokens = 256;
    let text = '';
    if (cfg.mode === 'auto') {
      const token = claudeToken();
      if (!token) return '';
      text = await anthropic({ token, model: cfg.model, system, content, maxTokens });
    } else if (cfg.mode === 'byo') {
      if (!cfg.apiKey) return '';
      text = await callProvider(cfg.provider, { apiKey: cfg.apiKey, model: cfg.model, system, content, maxTokens });
    } else {
      return '';   // free proxy: unsupported, leave the prompt as-is
    }
    return cleanRewrite(text);
  } catch {
    return '';
  }
}

export const _internal = { clean, cleanRewrite, claudeToken };
