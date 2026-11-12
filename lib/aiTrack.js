// The logged AI clients (lib/aiUsage.js), loaded only when a call is really made — so modules
// that unit tests or plain-node scripts import (translation, the Admin Manager) don't pull in the
// server-only database client. If logging can't load, the call still goes out, unlogged.
//   const client = await claudeClient({ feature: 'manager_brief', country }, { timeout: 60000 })
//   const fetchImpl = await groqFetchFor({ feature: 'translate' })
export async function claudeClient(meta = {}, opts = {}) {
  try {
    const { anthropicClient } = await import('./aiUsage.js');
    return anthropicClient({ ...meta, ...opts });
  } catch {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, ...opts });
  }
}

export async function groqFetchFor(meta = {}) {
  if (!process.env.GROQ_API_KEY) return fetch;   // no Groq call will be made
  try {
    const { groqFetch } = await import('./aiUsage.js');
    return groqFetch(meta);
  } catch {
    return fetch;
  }
}
