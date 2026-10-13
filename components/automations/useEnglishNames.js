'use client';
// English names for a list of email templates (the list page and the template pickers).
// Built-in templates use the fixed names in lib/templateEnglish.js; custom ones are
// translated once through /api/email-templates/translate and remembered for the visit.
// Returns { [id]: english } — null = no English version (the service didn't answer),
// a missing id = still translating. Either way, show the Spanish name.
import { useEffect, useState } from 'react';
import { englishName } from '@/lib/templateEnglish';

const seen = new Map(); // Spanish name → English (null = the service didn't answer)
const asked = new Map(); // Spanish name → the request already on its way (pickers share it)

function translateNames(names) {
  const fresh = names.filter((n) => !seen.has(n) && !asked.has(n));
  if (fresh.length) {
    const req = fetch('/api/email-templates/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texts: fresh }) })
      .then(async (res) => { const j = await res.json(); if (!res.ok) throw new Error(j.message || 'failed'); return j.texts || []; })
      .then((texts) => fresh.forEach((n, i) => seen.set(n, texts[i] || null)))
      .catch(() => fresh.forEach((n) => seen.set(n, null)))
      .finally(() => fresh.forEach((n) => asked.delete(n)));
    fresh.forEach((n) => asked.set(n, req));
  }
  return Promise.all(names.map((n) => asked.get(n)));
}

export function useEnglishNames(templates) {
  const list = templates || [];
  const sig = list.map((t) => `${t.id}:${t.key || ''}:${t.name}`).join('|');
  const build = () => Object.fromEntries(list.map((t) => [t.id, englishName(t) ?? seen.get(t.name)]).filter(([, v]) => v !== undefined));
  const [names, setNames] = useState(build);

  useEffect(() => {
    setNames(build());
    const missing = [...new Set(list.filter((t) => !englishName(t) && t.name && !seen.has(t.name)).map((t) => t.name))];
    if (!missing.length) return undefined;
    let alive = true;
    translateNames(missing).then(() => { if (alive) setNames(build()); });
    return () => { alive = false; };
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  return names;
}
