import { describe, it, expect } from 'vitest';
import { activityTimeline, mergeTimeline, textsToTranslate, betterStatus, relaySender, chatLink, timelineCounts, answerKey } from '../lib/userTimeline.js';
import { answerRef } from '../lib/aiLinks.js';

const PHONE = '+595981123456';
const english = new Map([
  ['Hola, ¿cómo publico mi casa?', 'Hi, how do I list my house?'],
  ['Te ayudo enseguida, Juan del equipo.', 'I will help you right away, Juan from the team.'],
  ['Gracias por tu mensaje. Alguien de nuestro equipo te va a responder en breve.', 'Thanks for your message. Someone from our team will reply shortly.'],
  ['Quiero un reembolso', 'I want a refund'],
  ['Muy lento, no me gustó', 'Very slow, I did not like it'],
  ['Tu publicación en Casa-Libre', 'Your listing on Casa-Libre'],
]);

const messages = [
  { id: 'msg_in1', direction: 'inbound', type: 'text', text: 'Hola, ¿cómo publico mi casa?', timestamps: { created: '2026-11-01T10:00:00Z' } },
  { id: 'msg_ai1', direction: 'outbound', type: 'text', kind: 'text', sent_by: 'api', status: 'read', text: 'Publicá en casa-libre.com.py/r/ai?u=/publicar', metadata: { source: 'inbox_ai' }, timestamps: { created: '2026-11-01T10:00:20Z' } },
  { id: 'msg_in2', direction: 'inbound', type: 'text', text: 'Quiero un reembolso', timestamps: { created: '2026-11-02T09:00:00Z' } },
  { id: 'msg_hold', direction: 'outbound', type: 'text', kind: 'text', sent_by: 'api', status: 'delivered', text: 'Gracias por tu mensaje. Alguien de nuestro equipo te va a responder en breve.', metadata: { source: 'inbox_ai_person' }, timestamps: { created: '2026-11-02T09:00:15Z' } },
  { id: 'msg_team', direction: 'outbound', type: 'text', kind: 'text', sent_by: 'roland@casa-libre.com', status: 'read', text: 'Te ayudo enseguida, Juan del equipo.', timestamps: { created: '2026-11-02T11:00:00Z' } },
  { id: 'msg_tpl', direction: 'outbound', type: 'template', kind: 'template', sent_by: 'api', status: 'read', template: { name: 'cl_draft_reminder' }, text: 'Tu borrador te espera', timestamps: { created: '2026-10-30T12:00:00Z' } },
];

const logRows = [
  { id: 101, automation_id: 'inbox_ai', channel: 'whatsapp', to_email: 'juan@example.com', to_phone: PHONE, subject: 'publish', status: 'sent', relay_message_id: 'msg_ai1', created_at: '2026-11-01T10:00:21Z',
    error: JSON.stringify({ inbound_id: 'msg_in1', question: 'Hola, ¿cómo publico mi casa?', english: 'Publish at casa-libre.com.py/publicar', topic: 'publish', answer_ref: 'ans123' }) },
  { id: 102, automation_id: 'inbox_ai_person', channel: 'whatsapp', to_email: 'juan@example.com', to_phone: PHONE, subject: 'refund', status: 'sent', relay_message_id: 'msg_hold', created_at: '2026-11-02T09:00:16Z',
    error: JSON.stringify({ inbound_id: 'msg_in2', question: 'Quiero un reembolso', english: 'We will check your refund.', reason: 'refund request', topic: 'refund', action: 'person', holding: 'Gracias por tu mensaje. Alguien de nuestro equipo te va a responder en breve.', draft: 'Vamos a revisar tu reembolso.' }) },
  { id: 103, automation_id: 'manager', template_key: 'manager_negative_feedback', channel: 'email', to_email: 'juan@example.com', subject: 'Tu publicación en Casa-Libre', status: 'sent', resend_id: 're_mgr1', run_id: 'rep-7', created_at: '2026-11-03T08:00:00Z' },
];

const feedback = [{ id: 'fb1', user_id: 'u1', email: 'juan@example.com', rating: 2, message: 'Muy lento, no me gustó', source: 'publish', created_at: '2026-11-02T20:00:00Z' }];
const clicks = [{ answer: 'ans123', path: '/publicar', at: '2026-11-01T10:05:00', n: 1 }];

describe('userTimeline — activity (server side)', () => {
  const items = activityTimeline({ messages, logRows, feedback, clicks, english });
  const byKey = Object.fromEntries(items.map((i) => [i.key, i]));

  it('is sorted newest first', () => {
    const ats = items.map((i) => i.at);
    expect([...ats].sort().reverse()).toEqual(ats);
    expect(items[0].key).toBe('log-103');
  });

  it('shows what they wrote, in English with the original', () => {
    const inbound = byKey['relay-msg_in1'];
    expect(inbound).toMatchObject({ who: 'them', whoLabel: 'Them', channel: 'whatsapp', title: 'Wrote to us', text: 'Hi, how do I list my house?', original: 'Hola, ¿cómo publico mi casa?', status: null });
  });

  it('shows the team member who replied, by name', () => {
    expect(byKey['relay-msg_team']).toMatchObject({ who: 'team', whoLabel: 'roland@casa-libre.com', title: 'Team reply', text: 'I will help you right away, Juan from the team.', status: 'read' });
  });

  it('an AI reply: English text, read status from its Relay message, and the click on its link', () => {
    const ai = byKey['log-101'];
    expect(ai).toMatchObject({ who: 'ai', whoLabel: 'AI assistant', title: 'AI assistant replied', text: 'Publish at casa-libre.com.py/publicar', status: 'clicked', answer: 'ans123' });
    expect(ai.original).toContain('Publicá');
    expect(ai.clicks).toEqual([{ at: '2026-11-01T10:05:00', path: '/publicar', n: 1 }]);
    expect(ai.detail[0]).toBe('Their message: “Hi, how do I list my house?”');
    // its Relay message is not listed a second time
    expect(byKey['relay-msg_ai1']).toBeUndefined();
  });

  it('a hand-over: the reason + the holding message in English, delivered', () => {
    const h = byKey['log-102'];
    expect(h).toMatchObject({ who: 'ai', title: 'Handed to a person — refund request', text: 'Thanks for your message. Someone from our team will reply shortly.', status: 'delivered', handover: true });
    expect(h.original).toMatch(/^Gracias/);
    expect(h.detail.some((d) => d.includes('We will check your refund.'))).toBe(true);
    expect(byKey['relay-msg_hold']).toBeUndefined();
  });

  it('an Admin Manager email: named, English subject, linked to its report', () => {
    expect(byKey['log-103']).toMatchObject({ who: 'manager', whoLabel: 'Admin Manager', channel: 'email', title: 'Admin Manager: Reply to feedback', text: 'Your listing on Casa-Libre', original: 'Tu publicación en Casa-Libre', reportId: 'rep-7', status: 'sent' });
    expect(byKey['log-103'].matchIds).toEqual(['103', 're_mgr1']);
  });

  it('feedback with 2 stars', () => {
    expect(byKey['feedback-fb1']).toMatchObject({ who: 'feedback', whoLabel: 'Feedback', channel: 'feedback', title: 'Gave 2 stars', stars: 2, text: 'Very slow, I did not like it', original: 'Muy lento, no me gustó' });
  });

  it('a click on an AI link whose reply is not known shows on its own', () => {
    const out = activityTimeline({ clicks: [{ answer: 'zzz', path: '/cuenta', at: '2026-11-03T00:00:00', n: 2 }] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ who: 'them', title: 'Clicked a link from the AI assistant', text: '/cuenta', status: 'clicked' });
  });

  it('the reply code falls back to the answered message id (lib/aiLinks answerRef)', () => {
    expect(answerKey({ inbound_id: 'msg_ABCDEF1234567' })).toBe(answerRef('msg_ABCDEF1234567'));
    expect(answerKey({ answer_ref: 'x1', inbound_id: 'msg_1' })).toBe('x1');
    expect(answerKey({})).toBe('');
  });

  it('open issue rows: the English the team wrote, who sent it', () => {
    const out = activityTimeline({ logRows: [{ id: 9, automation_id: 'open_issue', channel: 'whatsapp', to_phone: PHONE, subject: 'Paid but not live', status: 'sent', relay_message_id: 'm9', created_at: '2026-11-03T01:00:00Z', error: JSON.stringify({ action: 'whatsapp', by: 'ops@casa-libre.com', text: 'Ya está publicada', english: 'It is live now' }) }],
      messages: [{ id: 'm9', direction: 'outbound', sent_by: 'api', status: 'read', text: 'Ya está publicada', timestamps: { created: '2026-11-03T01:00:00Z' } }] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ who: 'manager', whoLabel: 'Admin Manager · sent by ops@casa-libre.com', channel: 'whatsapp', title: 'Open issue · Paid but not live', text: 'It is live now', original: 'Ya está publicada', status: 'read' });
  });

  it('lists the texts to translate (no English AI replies, no duplicates)', () => {
    const t = textsToTranslate({ messages, logRows, feedback });
    expect(t).toContain('Hola, ¿cómo publico mi casa?');
    expect(t).toContain('Muy lento, no me gustó');
    expect(t).toContain('Tu publicación en Casa-Libre');
    expect(t).not.toContain('Publish at casa-libre.com.py/publicar');
    expect(new Set(t).size).toBe(t.length);
  });
});

describe('userTimeline — merged with the emails / WhatsApp / paywall cards', () => {
  const activity = activityTimeline({ messages, logRows, feedback, clicks, english });
  const emails = [
    { id: 're_mgr1', at: '2026-11-03T08:00:00Z', subject: 'Tu publicación en Casa-Libre', type: 'Admin Manager: Reply to feedback', manager: true, status: 'opened', automation: true },
    { id: 're_code', at: '2026-10-29T08:00:00Z', subject: 'Tu código', type: 'Sign-in code', status: 'delivered' },
    { id: 101, at: '2026-11-01T10:00:21Z', subject: 'publish', type: 'Automation', status: 'sent', automation: true, untracked: 'log' }, // the AI row leaking into the email list
  ];
  const whatsapp = [
    { id: 55, at: '2026-10-30T12:00:01Z', template: 'cl_draft_reminder', type: 'Draft reminder', status: 'delivered', text: 'Tu borrador te espera', text_en: 'Your draft is waiting', clicked: false },
    { id: 101, at: '2026-11-01T10:00:21Z', template: 'publish', type: 'publish', status: 'sent' }, // the AI row as a WhatsApp automation
  ];
  const steps = [{ at: '2026-11-02T15:00:00Z', kind: 'paywall', listingId: 'p1', title: 'Wanted to publish their 4th listing this month — the payment step came up' }];
  const items = mergeTimeline(activity, { emails, whatsapp, steps, relayOf: { 55: 'msg_tpl' } });
  const keys = items.map((i) => i.key);

  it('each thing shows once', () => {
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain('email-re_mgr1');
    expect(keys).not.toContain('email-101');
    expect(keys).not.toContain('wa-101');
    expect(keys).not.toContain('relay-msg_tpl');   // the template is the draft-reminder automation row
    expect(keys).toContain('wa-55');
    expect(keys).toContain('email-re_code');
  });

  it('takes the best status either side knows', () => {
    expect(items.find((i) => i.key === 'log-103').status).toBe('opened');   // Resend saw it opened
    expect(items.find((i) => i.key === 'wa-55').status).toBe('read');       // Relay saw it read
    expect(items.find((i) => i.key === 'log-101').status).toBe('clicked');  // still clicked
  });

  it('keeps the existing rows in English with labels', () => {
    expect(items.find((i) => i.key === 'wa-55')).toMatchObject({ who: 'automation', whoLabel: 'Automation', title: 'Draft reminder', text: 'Your draft is waiting', original: 'Tu borrador te espera' });
    expect(items.find((i) => i.key === 'email-re_code')).toMatchObject({ who: 'automation', channel: 'email', title: 'Sign-in code' });
    expect(items.find((i) => i.key.startsWith('step-paywall'))).toMatchObject({ who: 'them', channel: 'activity' });
  });

  it('is sorted newest first and counted per channel / who', () => {
    const ats = items.map((i) => i.at);
    expect([...ats].sort().reverse()).toEqual(ats);
    const c = timelineCounts(items);
    expect(c.all).toBe(items.length);
    expect(c.feedback).toBe(1);
    expect(c['who:ai']).toBe(2);
    expect(c['who:team']).toBe(1);
  });
});

describe('userTimeline — helpers', () => {
  it('betterStatus', () => {
    expect(betterStatus('sent', 'read')).toBe('read');
    expect(betterStatus('read', 'delivered')).toBe('read');
    expect(betterStatus('sent', 'failed')).toBe('failed');
    expect(betterStatus('failed', 'read')).toBe('read');
    expect(betterStatus(null, 'clicked')).toBe('clicked');
    expect(betterStatus('opened', 'clicked')).toBe('clicked');
  });
  it('relaySender', () => {
    expect(relaySender({ sent_by: 'ana@x.com' })).toEqual({ who: 'team', name: 'ana@x.com' });
    expect(relaySender({ sent_by: 'api', metadata: { agent: 'omar@x.com' } })).toEqual({ who: 'team', name: 'omar@x.com' });
    expect(relaySender({ sent_by: 'api', metadata: { source: 'inbox_ai' } }).who).toBe('ai');
    expect(relaySender({ sent_by: 'api', kind: 'otp' }).who).toBe('automation');
  });
  it('chatLink', () => {
    expect(chatLink('+595 981 123 456')).toBe('/inbox?phone=595981123456');
    expect(chatLink('+595981123456', 'test')).toBe('/inbox?phone=595981123456&mode=test');
    expect(chatLink('')).toBeNull();
  });
});
