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
  'You autocomplete prompts a user is typing to a terminal coding agent. ' +
  'Given their PARTIAL prompt plus context, output ONLY the text that should ' +
  'continue from where they stopped — do NOT repeat what they typed. Either a ' +
  'short word/phrase or a fuller useful continuation, your choice. Output ' +
  'nothing if no good completion. No quotes, no markdown, no explanation.';

function userMsg({ buffer, conversation, skills }) {
  return [
    skills?.length ? `Installed skills:\n${skills.join('\n')}` : '',
    conversation ? `Recent conversation:\n${conversation}` : '',
    `Partial prompt (complete its continuation):\n${buffer}`
  ].filter(Boolean).join('\n\n');
}

// Strip a leading echo of the buffer if the model repeated it anyway.
function clean(text, buffer) {
  let t = (text || '').replace(/^["'`]|["'`]$/g, '').trim();
  if (buffer && t.toLowerCase().startsWith(buffer.toLowerCase())) t = t.slice(buffer.length);
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

async function anthropic({ token, apiKey, model, ctx }) {
  const headers = { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' };
  if (apiKey) headers['x-api-key'] = apiKey;
  else headers['authorization'] = `Bearer ${token}`;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers,
    body: JSON.stringify({
      model: model || FAST.anthropic, max_tokens: 64, system: SYSTEM,
      messages: [{ role: 'user', content: userMsg(ctx) }]
    })
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}`);
  const j = await r.json();
  return j?.content?.[0]?.text || '';
}

async function openaiLike({ url, apiKey, model, ctx, fallbackModel }) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: model || fallbackModel, max_tokens: 64,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userMsg(ctx) }]
    })
  });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  const j = await r.json();
  return j?.choices?.[0]?.message?.content || '';
}

async function gemini({ apiKey, model, ctx }) {
  const m = model || FAST.gemini;
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`,
    {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: userMsg(ctx) }] }],
        generationConfig: { maxOutputTokens: 64 }
      })
    });
  if (!r.ok) throw new Error(`gemini ${r.status}`);
  const j = await r.json();
  return j?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function callProvider(provider, { apiKey, model, ctx }) {
  switch (provider) {
    case 'anthropic': return anthropic({ apiKey, model, ctx });
    case 'deepseek': return openaiLike({ url: 'https://api.deepseek.com/chat/completions', apiKey, model, ctx, fallbackModel: FAST.deepseek });
    case 'openai': return openaiLike({ url: 'https://api.openai.com/v1/chat/completions', apiKey, model, ctx, fallbackModel: FAST.openai });
    case 'gemini': return gemini({ apiKey, model, ctx });
    default: throw new Error(`unknown provider ${provider}`);
  }
}

// Returns the cleaned completion suffix, or '' on any failure (never throws).
export async function complete(cfg, ctx) {
  try {
    let text = '';
    if (cfg.mode === 'auto') {
      const token = claudeToken();
      if (!token) throw new Error('no claude token');
      text = await anthropic({ token, model: cfg.model, ctx });
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
      text = await callProvider(cfg.provider, { apiKey: cfg.apiKey, model: cfg.model, ctx });
    }
    return clean(text, ctx.buffer);
  } catch {
    return '';
  }
}

export const _internal = { clean, claudeToken };
