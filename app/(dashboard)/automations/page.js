'use client';
// Automations — the built-in flows for the active country, each laid out as one
// horizontal row of steps: "first listing → free home display" (trigger → wait → gift
// email → ending-soon email), "listing getting views" and "unfinished draft reminders"
// (trigger → reminder steps → email), and "signed up, no listing yet" (trigger → wait →
// welcome email → optional second email). Each email step picks which template it sends.
// The buyer portal's hourly cron (/api/cron/automations) does the sending; this page
// only configures it.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { T, PageHeader, Banner, PendingMigration } from '@/components/automations/ui';
import { stepsFromHours, stepLabel } from '@/lib/automationAdmin';
import { profileStepFromHours, profileStepLabel, PROFILE_STEPS } from '@/lib/profileNudgeAdmin';
import { photoFaceStepFromHours, photoFaceStepLabel, photoWrongStepLabel, PHOTO_FACE_STEPS } from '@/lib/photoFaceAdmin';
import { useDialog } from '@/components/Dialog';
import NewsletterCard from '@/components/automations/NewsletterCard';
import ShareCards from '@/components/automations/ShareCards';

import { StepCard, Connector, TierList, DayField, DraftSteps, TemplatePicker, AutomationCard } from '@/components/automations/parts';

export default function AutomationsPage() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [vform, setVform] = useState(null);
  const [dform, setDform] = useState(null);
  const [xform, setXform] = useState(null);
  const [lform, setLform] = useState(null);   // "Listing deleted → ask why"
  const [nform, setNform] = useState(null);
  const [hform, setHform] = useState(null);
  const [sform, setSform] = useState(null);
  const [pform, setPform] = useState(null);
  const [rform, setRform] = useState(null);   // "Promote the referral program"
  const [prform, setPrform] = useState(null);  // "Personalize your profile"
  const [faform, setFaform] = useState(null);  // "Show your face"
  const { dialog, confirm } = useDialog();
  // "Switch … on?\n\nwhat happens" → the admin dialog (title + text), Switch on / Switch off.
  const ask = (text) => {
    const [title, ...rest] = String(text).split('\n\n');
    const off = /\boff\?$/.test(title);
    return confirm({ title, message: rest.join('\n\n'), confirmLabel: off ? 'Switch off' : /\bon\?$/.test(title) ? 'Switch on' : 'OK', tone: off ? 'danger' : undefined });
  };
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});   // { first: {...}, views: {...} }
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState({});       // { first: 'toggle'|'save', views: … }

  function apply(j) {
    setData(j);
    const a = j.automation;
    setForm({ wait_days: a.wait_days, free_days: a.free_days, remind_days_before: a.remind_days_before, first_tier_count: a.first_tier_count, later_free_days: a.later_free_days, free_tiers: Array.isArray(a.free_tiers) ? a.free_tiers.map((t) => ({ sellers: t.sellers, days: t.days })) : undefined, gift_template_id: a.gift_template_id || '', reminder_template_id: a.reminder_template_id || '' });
    const v = j.views?.automation;
    setVform(v ? { milestones: (v.milestones || []).join(', '), template_id: v.template_id || '' } : null);
    const d = j.drafts?.automation;
    setDform(d ? { steps: stepsFromHours(d.milestones), template_id: d.template_id || '' } : null);
    const x = j.duplicates?.automation;
    setXform(x ? { template_id: x.template_id || '' } : null);
    const l = j.deleted?.automation;
    setLform(l ? { template_id: l.template_id || '' } : null);
    const n = j.noListing?.settings;
    setNform(n ? { days: n.days, secondAfter: n.secondAfter, templateId: n.templateId, reminderTemplateId: n.reminderTemplateId } : null);
    const hs = j.listingHeld?.settings;
    setHform(hs ? { hours: hs.hours, reminderAfter: hs.reminderAfter } : null);
    const ps = j.paymentFollowup?.settings;
    setPform(ps ? { steps: stepsFromHours(ps.steps), reminderTemplateId: ps.reminderTemplateId || '', giftAfterDays: ps.giftAfterDays, giftTemplateId: ps.giftTemplateId || '', giftsPerPerson: ps.giftsPerPerson, giftWindowDays: ps.giftWindowDays, giftDays: ps.giftDays } : null);
    const rp = j.referralPromo?.settings;
    setRform(rp ? { firstAfterHours: rp.firstAfterHours, everyDays: rp.everyDays, maxSends: rp.maxSends, includeExisting: rp.includeExisting, perRun: rp.perRun, templateId: rp.templateId || '' } : null);
    const prs = j.profileNudge?.settings;
    setPrform(prs ? { steps: prs.steps.map(profileStepFromHours), templateId: prs.templateId || '', reminderTemplateId: prs.reminderTemplateId || '' } : null);
    const fas = j.photoFace?.settings;
    const fws = j.photoFace?.wrong?.settings;
    setFaform(fas ? {
      steps: fas.steps.map(photoFaceStepFromHours), templateId: fas.templateId || '', reminderTemplateId: fas.reminderTemplateId || '',
      // the wrong-photo part (row profile_photo_face_wrong)
      wrongOn: fws ? (fws.setUp ? fws.enabled : true) : true,
      wrongSteps: (fws?.steps || [2, 48, 168]).map(photoFaceStepFromHours),
      wrongTemplateId: fws?.templateId || '', wrongReminderTemplateId: fws?.reminderTemplateId || '', keptTemplateId: fws?.keptTemplateId || '',
    } : null);
    const ss = j.saves?.settings;
    setSform(ss ? { milestones: (ss.milestones || []).join(', '), template_id: ss.templateId || '' } : null);
  }

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/automations', { cache: 'no-store' });
        const j = await res.json();
        if (j.pending) { setPending(true); return; }
        if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
        apply(j);
      } catch (e) { setError(String(e.message || e)); }
    })();
  }, []);

  async function put(which, patch, okText) {
    setErrors({}); setNotice(''); setError('');
    const body = which === 'views' ? { id: 'listing_views_milestone', ...patch } : which === 'drafts' ? { id: 'draft_reminders', ...patch } : which === 'dups' ? { id: 'duplicate_listings', ...patch } : which === 'deleted' ? { id: 'listing_deleted', ...patch } : which === 'nolist' ? { id: 'no_listing_nudge', ...patch } : which === 'held' ? { id: 'listing_held', ...patch } : which === 'saves' ? { id: 'listing_saves_milestone', ...patch } : which === 'pay' ? { id: 'payment_followup', ...patch } : which === 'promo' ? { id: 'referral_promo', ...patch } : which === 'profile' ? { id: 'profile_personalization', ...patch } : which === 'face' ? { id: 'profile_photo_face', ...patch } : patch;
    const res = await fetch('/api/automations', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json();
    if (res.status === 400 && j.errors) { setErrors({ [which]: j.errors }); setError(j.errors.enabled || 'Fix the highlighted fields.'); return false; }
    if (!res.ok) { setError(j.error || `HTTP ${res.status}`); return false; }
    apply(j);
    if (okText) setNotice(okText);
    return true;
  }
  const run = async (which, kind, fn) => { setBusy((b) => ({ ...b, [which]: kind })); await fn(); setBusy((b) => ({ ...b, [which]: '' })); };

  if (pending) return <div className="space-y-5"><PageHeader title="Automations" /><PendingMigration /></div>;
  if (!data || !form) return <div className="space-y-5"><PageHeader title="Automations" />{error ? <Banner>{error}</Banner> : <p className="text-xs" style={{ color: T.textMuted }}>Loading…</p>}</div>;

  const a = data.automation;
  const e1 = errors.first || {};
  const setF = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const hasTiers = a.first_tier_count !== undefined && a.later_free_days !== undefined;   // migration 009
  const hasTierList = Array.isArray(a.free_tiers);   // migration 010
  const dirty = ['wait_days', 'free_days', 'remind_days_before', 'first_tier_count', 'later_free_days', 'gift_template_id', 'reminder_template_id']
    .some((k) => String(form[k] ?? '') !== String(a[k] ?? ''))
    || (hasTierList && JSON.stringify(form.free_tiers || []) !== JSON.stringify((a.free_tiers || []).map((t) => ({ sellers: t.sellers, days: t.days }))));
  // Only send the tier list once the column exists; before that the single-tier fields apply.
  const firstPatch = () => { const { free_tiers, ...rest } = form; return hasTierList ? { ...rest, free_tiers } : rest; };

  const toggleFirst = async () => {
    const on = !a.enabled;
    if (on && !(await ask('Switch the automation on?\n\nOnly sellers whose FIRST listing is published from now on get the free home display and the emails. Nobody who already published is affected.'))) return;
    if (!on && !(await ask('Switch the automation off?\n\nNobody new gets the gift. Sellers already on free display keep it until it ends, but won’t get the reminder email.'))) return;
    run('first', 'toggle', () => put('first', { enabled: on }, on ? 'First listing automation is on.' : 'First listing automation is off.'));
  };

  const va = data.views?.automation;
  const e2 = errors.views || {};
  const vDirty = !!(va && vform && (vform.milestones.replace(/\s/g, '') !== (va.milestones || []).join(',') || String(vform.template_id || '') !== String(va.template_id || '')));
  const toggleViews = async () => {
    const on = !va.enabled;
    if (on && !(await ask('Switch "Listing getting views" on?\n\nSellers get an email when their listing reaches your view numbers. Listings that already passed a number before now won’t be emailed for it.'))) return;
    run('views', 'toggle', () => put('views', { enabled: on }, on ? '“Listing getting views” is on.' : '“Listing getting views” is off.'));
  };

  const da = data.drafts?.automation;
  const e3 = errors.drafts || {};
  const savedSteps = da ? stepsFromHours(da.milestones) : [];
  const dDirty = !!(da && dform && (JSON.stringify(dform.steps.map((s) => ({ value: Number(s.value), unit: s.unit }))) !== JSON.stringify(savedSteps) || String(dform.template_id || '') !== String(da.template_id || '')));
  const toggleDrafts = async () => {
    const on = !da.enabled;
    const when = (da.milestones || []).map(stepLabel).join(', ');
    if (on && !(await ask(`Switch "Unfinished draft reminders" on?\n\nSellers with an unfinished draft get an email after ${when || 'your waits'} without changes, with a button that opens the draft. Drafts already waiting get ONE email for the latest reminder they reached (if it came due in the last 7 days).`))) return;
    run('drafts', 'toggle', () => put('drafts', { enabled: on }, on ? '“Unfinished draft reminders” is on.' : '“Unfinished draft reminders” is off.'));
  };
  const perStep = data.drafts?.perStep || {};
  const draftStats = [
    data.drafts?.sent ? `${data.drafts.sent.toLocaleString('en-US')} sent so far${Object.keys(perStep).length > 1 ? ` (${Object.keys(perStep).sort((x, y) => x - y).map((k) => `#${k}: ${perStep[k]}`).join(' · ')})` : ''}.` : '',
    data.drafts?.waiting != null ? `${data.drafts.waiting.toLocaleString('en-US')} unfinished ${data.drafts.waiting === 1 ? 'draft' : 'drafts'} right now.` : '',
  ].filter(Boolean).join(' ');

  const xa = data.duplicates?.automation;
  const xDirty = !!(xa && xform && String(xform.template_id || '') !== String(xa.template_id || ''));
  const toggleDups = async () => {
    const on = !xa.enabled;
    if (on && !(await ask('Switch "Same property listed twice" on?\n\nA listing that repeats one of the user\'s own (same details + half or more of the same photos) is held as "Under review — possible duplicate" instead of published, and the user is emailed right away.'))) return;
    run('dups', 'toggle', () => put('dups', { enabled: on }, on ? '“Same property listed twice” is on.' : '“Same property listed twice” is off.'));
  };

  const la = data.deleted?.automation;
  const lDirty = !!(la && lform && String(lform.template_id || '') !== String(la.template_id || ''));
  const toggleDeleted = async () => {
    const on = !la.enabled;
    if (on && !(await ask('Switch "Listing deleted → ask why" on?\n\nRight after a seller deletes one of their listings, they get this email asking why, with a link to a short feedback form. At most once per person every 7 days.'))) return;
    run('deleted', 'toggle', () => put('deleted', { enabled: on }, on ? '“Listing deleted → ask why” is on.' : '“Listing deleted → ask why” is off.'));
  };

  const nl = data.noListing;
  const ns = nl?.settings;
  const e5 = errors.nolist || {};
  const nDirty = !!(ns && nform && (['days', 'secondAfter', 'templateId', 'reminderTemplateId'].some((k) => String(nform[k] ?? '') !== String(ns[k] ?? ''))));
  const nHasSecond = !!(nform && nform.secondAfter !== '' && Number(nform.secondAfter) > 0);
  // "Personalize your profile" (lib/profileNudgeAdmin.js)
  const pn = data.profileNudge;
  const pns = pn?.settings;
  const ePr = errors.profile || {};
  const prHours = (steps) => steps.map((x) => Number(x.value) * (x.unit === 'days' ? 24 : 1));
  const prDirty = !!(pns && prform && (JSON.stringify(prHours(prform.steps)) !== JSON.stringify(pns.steps)
    || String(prform.templateId || '') !== String(pns.templateId || '') || String(prform.reminderTemplateId || '') !== String(pns.reminderTemplateId || '')));
  const prPatch = () => ({ steps: prHours(prform.steps), templateId: prform.templateId, reminderTemplateId: prform.reminderTemplateId });
  const toggleProfile = async () => {
    const on = !pns.enabled;
    const when = pns.steps.map(profileStepLabel).join(', ');
    if (on && !(await ask(`Switch "Personalize your profile" on?\n\nVerified users whose profile isn’t personalized (photo or logo, first and last name, title or company) get an email ${when}. It stops as soon as their profile is personalized; each email goes once. People who signed up earlier only get an email that came due in the last 7 days.${pn.setUp ? '' : '\n\nThis also creates the two default emails (Spanish) — edit them in Email templates.'}`))) return;
    run('profile', 'toggle', () => put('profile', pn.setUp ? { enabled: on } : { ...prPatch(), enabled: on }, on ? '“Personalize your profile” is on.' : '“Personalize your profile” is off.'));
  };
  const prPer = pn?.perStep || {};
  const prStats = pn?.sent ? ` ${pn.sent.toLocaleString('en-US')} sent so far${Object.keys(prPer).length > 1 ? ` (${Object.keys(prPer).sort((x, y) => x - y).map((k) => `#${k}: ${prPer[k]}`).join(' · ')})` : ''}.` : '';
  // "Show your face" (lib/photoFaceAdmin.js)
  const faData = data.photoFace;
  const faSet = faData?.settings;
  const eFa = errors.face || {};
  const fwSet = faData?.wrong?.settings;
  const fwDirty = !!(fwSet && faform && (!fwSet.setUp || !!faform.wrongOn !== !!fwSet.enabled
    || JSON.stringify(prHours(faform.wrongSteps)) !== JSON.stringify(fwSet.steps)
    || String(faform.wrongTemplateId || '') !== String(fwSet.templateId || '') || String(faform.wrongReminderTemplateId || '') !== String(fwSet.reminderTemplateId || '')
    || String(faform.keptTemplateId || '') !== String(fwSet.keptTemplateId || '')));
  const faDirty = !!(faSet && faform && (JSON.stringify(prHours(faform.steps)) !== JSON.stringify(faSet.steps)
    || String(faform.templateId || '') !== String(faSet.templateId || '') || String(faform.reminderTemplateId || '') !== String(faSet.reminderTemplateId || ''))) || fwDirty;
  const faPatch = () => ({
    steps: prHours(faform.steps), templateId: faform.templateId, reminderTemplateId: faform.reminderTemplateId,
    // empty template pickers on the first save → the three default emails are created
    wrong: {
      enabled: !!faform.wrongOn, steps: prHours(faform.wrongSteps),
      templateId: faform.wrongTemplateId || undefined, reminderTemplateId: faform.wrongReminderTemplateId || undefined, keptTemplateId: faform.keptTemplateId || undefined,
    },
  });
  // DraftSteps reads errors.step_<i>: map the wrong-photo part's keys onto it
  const eFw = Object.fromEntries(Object.entries(eFa).filter(([k]) => k.startsWith('wrong_step_')).map(([k, v]) => [k.slice(6), v]));
  const toggleFace = async () => {
    const on = !faSet.enabled;
    const when = faSet.steps.map(photoFaceStepLabel).join(', ');
    if (on && !(await ask(`Switch "Show your face" on?

Verified users whose approved profile photo is a logo (checked by AI) get an email ${when}. Before each email the photo is checked again: once it is a real photo of the person, nothing more is sent.${faform?.wrongOn ? `

Wrong photos: people whose upload was turned down (neither a face nor a logo) and people with a "?" photo get the wrong-photo emails ${prHours(faform.wrongSteps).map(photoWrongStepLabel).join(', ')}, until they have a face or a logo. People who still have a valid photo get ONE email that their new photo wasn't accepted.` : ''} Each email goes once; one more than 7 days late is skipped.${faData.setUp ? '' : `

This also creates the two default emails (Spanish) — edit them in Email templates.`}`))) return;
    run('face', 'toggle', () => put('face', faData.setUp ? { enabled: on } : { ...faPatch(), enabled: on }, on ? '“Show your face” is on.' : '“Show your face” is off.'));
  };
  const faPer = faData?.perStep || {};
  const faStats = faData?.sent ? ` ${faData.sent.toLocaleString('en-US')} sent so far${Object.keys(faPer).length > 1 ? ` (${Object.keys(faPer).sort((x, y) => x - y).map((k) => `#${k}: ${faPer[k]}`).join(' · ')})` : ''}.` : '';
  const fwPer = faData?.wrong?.perStep || {};
  const fwStats = faData?.wrong?.sent ? ` Wrong-photo emails: ${faData.wrong.sent.toLocaleString('en-US')} sent (${[...Object.keys(fwPer).sort((x, y) => x - y).map((k) => `#${k}: ${fwPer[k]}`), `new photo not accepted: ${faData.wrong.kept || 0}`].join(' · ')}).` : '';
  const toggleNoListing = async () => {
    const on = !ns.enabled;
    if (on && !(await ask(`Switch "Signed up, no listing yet" on?\n\nVerified users who signed up ${ns.days} ${ns.days === 1 ? 'day' : 'days'} ago or more and have no listing and no draft get the welcome email, once. People who signed up before now only get it if it came due in the last 7 days.${nl.setUp ? '' : '\n\nThis also creates the two default emails (Spanish) — edit them in Email templates.'}`))) return;
    run('nolist', 'toggle', () => put('nolist', { enabled: on }, on ? '“Signed up, no listing yet” is on.' : '“Signed up, no listing yet” is off.'));
  };
  const hl = data.listingHeld;
  const hs = hl?.settings;
  const e6 = errors.held || {};
  const hDirty = !!(hs && hform && ['hours', 'reminderAfter'].some((k) => String(hform[k] ?? '') !== String(hs[k] ?? '')));
  const hHasReminder = !!(hform && hform.reminderAfter !== '' && Number(hform.reminderAfter) > 0);
  const toggleHeld = async () => {
    const on = !hs.enabled;
    if (on && !(await ask(`Switch "Listing not published" on?\n\nOwners of user listings held off the site (waiting for payment, photos rejected, paused, missing details) get a message ${hs.hours} ${hs.hours === 1 ? 'hour' : 'hours'} later telling them why, with a button to My listings. Only listings created from now on.${hl.setUp ? '' : '\n\nThis also creates the four default emails (Spanish) — edit them in Templates.'}`))) return;
    run('held', 'toggle', () => put('held', { enabled: on }, on ? '“Listing not published” is on.' : '“Listing not published” is off.'));
  };
  const sv = data.saves;
  const ssv = sv?.settings;
  const e7 = errors.saves || {};
  const sDirty = !!(ssv && sform && (sform.milestones.replace(/s/g, '') !== (ssv.milestones || []).join(',') || String(sform.template_id || '') !== String(ssv.templateId || '')));
  const toggleSaves = async () => {
    const on = !ssv.enabled;
    if (on && !(await ask('Switch "Listing getting saved" on?\n\nSellers get a message when their listing reaches your numbers of saves (people with an account + visitors). Numbers a listing already passed before now are not sent.'))) return;
    run('saves', 'toggle', () => put('saves', { enabled: on, ...(sv.setUp ? {} : { milestones: sform.milestones }) }, on ? '“Listing getting saved” is on.' : '“Listing getting saved” is off.'));
  };
  // "Waiting for payment → free listing"
  const pf = data.paymentFollowup;
  const pfs = pf?.settings;
  const e8 = errors.pay || {};
  const toHours = (steps) => steps.map((s) => Number(s.value) * (s.unit === 'days' ? 24 : 1));
  const pPatch = () => pform && ({ steps: toHours(pform.steps), reminderTemplateId: pform.reminderTemplateId, giftAfterDays: pform.giftAfterDays === '' ? 0 : Number(pform.giftAfterDays), giftTemplateId: pform.giftTemplateId, giftsPerPerson: Number(pform.giftsPerPerson), giftWindowDays: Number(pform.giftWindowDays), giftDays: Number(pform.giftDays) });
  const pDirty = !!(pfs && pform && (JSON.stringify(toHours(pform.steps)) !== JSON.stringify(pfs.steps)
    || ['reminderTemplateId', 'giftAfterDays', 'giftTemplateId', 'giftsPerPerson', 'giftWindowDays', 'giftDays'].some((k) => String(pform[k] ?? '') !== String(pfs[k] ?? ''))));
  const pGift = !!(pform && Number(pform.giftAfterDays) > 0);
  const togglePay = async () => {
    const on = !pfs.enabled;
    if (on && !(await ask(`Switch "Waiting for payment → free listing" on?\n\nSellers whose listing is saved over the free listings of the month and not paid get payment reminders${pGift ? `, and after ${pform.giftAfterDays} days one email offering THAT listing for free (up to ${pform.giftsPerPerson} per person)` : ''}. Only listings saved from now on. While it is on, "Listing not published" stops sending its own payment message.${pf.setUp ? '' : '\n\nThis also creates the gift email (Spanish) — edit it in Templates.'}`))) return;
    run('pay', 'toggle', () => put('pay', { enabled: on, ...(pf.setUp ? {} : pPatch()) }, on ? '“Waiting for payment → free listing” is on.' : '“Waiting for payment → free listing” is off.'));
  };
  const pStats = pf ? [
    pf.reminders ? `${pf.reminders.toLocaleString('en-US')} reminders sent` : '',
    pf.offered ? `${pf.offered} ${pf.offered === 1 ? 'gift' : 'gifts'} offered · ${pf.claimed} taken` : '',
    pf.waiting != null ? `${pf.waiting} ${pf.waiting === 1 ? 'listing' : 'listings'} waiting for payment right now` : '',
  ].filter(Boolean).join(' · ') : '';
  // "Promote the referral program"
  const rpd = data.referralPromo;
  const rps = rpd?.settings;
  const e9 = errors.promo || {};
  const R_KEYS = ['firstAfterHours', 'everyDays', 'maxSends', 'includeExisting', 'perRun', 'templateId'];
  const rDirty = !!(rps && rform && R_KEYS.some((k) => String(rform[k] ?? '') !== String(rps[k] ?? '')));
  const rNum = (v) => (v === '' ? '' : Number(v));
  const rPatch = () => rform && ({ ...rform, firstAfterHours: rNum(rform.firstAfterHours), everyDays: rNum(rform.everyDays), maxSends: rNum(rform.maxSends), perRun: rNum(rform.perRun) });
  const rProgramOn = !!rpd?.program?.enabled;
  // "day 1 · day 8 · day 15" — when each email goes, counted from sign-up
  const rWhen = rform ? (() => {
    const h = Number(rform.firstAfterHours) || 0, every = Number(rform.everyDays) || 0, n = Math.max(1, Math.min(10, Number(rform.maxSends) || 1));
    const first = h % 24 === 0 ? `day ${h / 24}` : `${h} hours`;
    return [first, ...Array.from({ length: n - 1 }, (_, i) => `day ${Math.floor(h / 24) + every * (i + 1)}`)].join(' · ');
  })() : '';
  const togglePromo = async () => {
    const on = !rps.enabled;
    if (on && !(await ask(`Switch "Promote the referral program" on?\n\nVerified members get an email about the referral program with their own link: ${rpd.schedule}. ${rform.includeExisting ? `People who signed up before now are included too — at most ${rform.perRun} emails go out per hourly run, so they are worked through a batch at a time.` : 'Only people who sign up from now on.'}${rProgramOn ? '' : '\n\nThe referral program is OFF in this country, so nothing is sent until you switch it on (Referrals page).'}${rpd.setUp ? '' : '\n\nThis also creates the default email (Spanish) — edit it in Templates.'}`))) return;
    run('promo', 'toggle', () => put('promo', { enabled: on, ...(rpd.setUp ? {} : rPatch()) }, on ? '“Promote the referral program” is on.' : '“Promote the referral program” is off.'));
  };
  const rStats = rpd ? [
    rpd.sent ? `${rpd.sent.toLocaleString('en-US')} sent to ${rpd.people.toLocaleString('en-US')} ${rpd.people === 1 ? 'person' : 'people'}${Object.keys(rpd.perStep || {}).length > 1 ? ` (${Object.keys(rpd.perStep).sort((x, y) => x - y).map((k) => `#${k}: ${rpd.perStep[k]}`).join(' · ')})` : ''}` : '',
    rpd.optedOut ? `${rpd.optedOut} unsubscribed` : '',
    rpd.bounced ? `${rpd.bounced} stopped (bounced / spam)` : '',
  ].filter(Boolean).join(' · ') : '';
  const nPerStep = nl?.perStep || {};
  const nStats = nl?.sent ? ` ${nl.sent.toLocaleString('en-US')} sent so far${nPerStep['2'] ? ` (welcome: ${nPerStep['1'] || 0} · second: ${nPerStep['2']})` : ''}.` : '';

  return (
    <div className="space-y-5">
      {dialog}
      <PageHeader title="Automations" sub="Emails and rewards that run on their own, checked every hour." />
      {error && <Banner>{error}</Banner>}
      {notice && <div className="text-xs px-4 py-3 rounded-[14px]" style={{ background: T.successSurface, color: T.success }}>{notice}</div>}

      <AutomationCard
        title="First listing → free home display"
          channelId="first_listing_free_home"
        description="A thank-you for a seller’s first listing: free days on the home page, then an offer to extend for US$20."
        enabled={a.enabled} enabledAt={a.enabled_at} busy={busy.first}
        onToggle={toggleFirst} dirty={dirty} onSave={() => run('first', 'save', () => put('first', firstPatch(), 'Changes saved.'))}
        footnote="Paid home listings always come first; free ones only fill empty home slots. After the free days the listing stays live, just not on the home page."
      >
        <StepCard n={1} kind="Trigger" title="A seller publishes their first listing" />
        <Connector />
        <StepCard n={2} kind="Wait" title="Wait before the gift">
          <DayField value={form.wait_days} onChange={setF('wait_days')} min={0} max={60} error={e1.wait_days} suffix="days" />
        </StepCard>
        <Connector />
        <StepCard n={3} kind="Gift" title="Free home display + thank-you email">
          {hasTierList ? (
            <TierList tiers={form.free_tiers || []} later={form.later_free_days} errors={e1}
              onChange={(list) => setForm((f) => ({ ...f, free_tiers: list }))} onLater={setF('later_free_days')} />
          ) : hasTiers ? (
            <div className="space-y-2.5" data-testid="tiers">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: T.textSecondary }}>The first</p>
                <DayField value={form.first_tier_count} onChange={setF('first_tier_count')} min={0} max={100000} error={e1.first_tier_count} suffix="sellers to ever list get…" />
              </div>
              <DayField value={form.free_days} onChange={setF('free_days')} min={1} max={365} error={e1.free_days} suffix="days on the home page" />
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: T.textSecondary }}>After that, everyone gets</p>
                <DayField value={form.later_free_days} onChange={setF('later_free_days')} min={1} max={365} error={e1.later_free_days} suffix="days on the home page" />
              </div>
              <p className="text-[11px]" style={{ color: T.textMuted }}>Place in line counts every seller who ever published, including the early ones.</p>
            </div>
          ) : (
            <>
              <DayField value={form.free_days} onChange={setF('free_days')} min={1} max={365} error={e1.free_days} suffix="days on the home page" />
              <p className="text-[11px]" style={{ color: T.textMuted }}>Apply <span className="font-mono">migrations/009_first_listing_tiers.sql</span> (buyer portal repo) to set “first 25 get 30 days, then 7 days”.</p>
            </>
          )}
          <TemplatePicker label="Email sent" value={form.gift_template_id} templates={data.templates} onChange={setF('gift_template_id')} />
        </StepCard>
        <Connector />
        <StepCard n={4} kind="Reminder" title="Ending-soon email with the pay button">
          <DayField value={form.remind_days_before} onChange={setF('remind_days_before')} min={1} max={60} error={e1.remind_days_before} suffix="days before the end" />
          {Number(form.remind_days_before) === 1 && <p className="text-[11px]" style={{ color: T.textMuted }}>Sent on the last day — e.g. day 6 of a 7-day gift.</p>}
          <TemplatePicker label="Email sent" value={form.reminder_template_id} templates={data.templates} onChange={setF('reminder_template_id')} />
        </StepCard>
      </AutomationCard>

      {va && vform ? (
        <AutomationCard
          title="Listing getting views"
          channelId="listing_views_milestone"
          description="Tells a seller their listing is getting attention, with the view count, and invites them to list another property."
          enabled={va.enabled} enabledAt={va.enabled_at} busy={busy.views}
          onToggle={toggleViews} dirty={vDirty} onSave={() => run('views', 'save', () => put('views', vform, 'Changes saved.'))}
          footnote={`Views are the same count as Analytics → Property analytics. Only listings sellers published themselves.${data.views.sent ? ` ${data.views.sent.toLocaleString('en-US')} sent so far.` : ''}`}
        >
          <StepCard n={1} kind="Trigger" title="A seller’s listing reaches a number of views" />
          <Connector />
          <StepCard n={2} kind="Views" title="Email at these view counts">
            <div>
              <input value={vform.milestones} onChange={(e) => setVform((f) => ({ ...f, milestones: e.target.value }))} placeholder="50" aria-label="View numbers"
                className="w-full px-3 py-2 rounded-[10px] border text-[15px] font-bold outline-none focus:border-ink/60 tabular-nums"
                style={{ borderColor: e2.milestones ? T.danger : 'rgba(17,17,17,.2)', color: T.textPrimary }} />
              {e2.milestones
                ? <p className="text-[11px] mt-1" style={{ color: T.danger }}>{e2.milestones}</p>
                : <p className="text-[11px] mt-1" style={{ color: T.textMuted }}>One number, or several separated by commas (e.g. 25, 50, 100). Each is emailed once per listing.</p>}
            </div>
          </StepCard>
          <Connector />
          <StepCard n={3} kind="Email" title="Email to the seller">
            <TemplatePicker label="Email sent" value={vform.template_id} templates={data.templates} onChange={(v) => setVform((f) => ({ ...f, template_id: v }))} />
          </StepCard>
        </AutomationCard>
      ) : (
        <Banner tone="warning">
          <b>“Listing getting views” isn’t set up for this country yet.</b> Apply <span className="font-mono">migrations/006_views_automation.sql</span> (buyer portal repo) in the AiroBase SQL editor, then reload.
        </Banner>
      )}

      {ssv && sform ? (
        <AutomationCard
          title="Listing getting saved"
          channelId="listing_saves_milestone"
          description="Tells a seller that people are saving their listing — “10 personas guardaron tu propiedad” — with a button to it. Counts people with an account and visitors without one."
          enabled={ssv.enabled} enabledAt={ssv.enabledAt} busy={busy.saves}
          onToggle={toggleSaves} dirty={sDirty || !sv.setUp}
          onSave={() => run('saves', 'save', () => put('saves', { milestones: sform.milestones, ...(sv.setUp ? { template_id: sform.template_id } : {}) }, sv.setUp ? 'Changes saved.' : 'Saved — the default email was created (Templates).'))}
          footnote={`Only listings sellers published themselves. Each number is sent once per listing; a number already passed before it was switched on is skipped.${sv.setUp ? '' : ' Not set up for this country yet: saving creates it with a default email.'}${sv.sent ? ` ${sv.sent.toLocaleString('en-US')} sent so far.` : ''}`}
        >
          <StepCard n={1} kind="Trigger" title="People save a seller’s listing (♥)" />
          <Connector />
          <StepCard n={2} kind="Saves" title="Message at these numbers of saves">
            <div>
              <input value={sform.milestones} onChange={(e) => setSform((f) => ({ ...f, milestones: e.target.value }))} placeholder="5, 10, 25" aria-label="Save numbers" data-testid="saves-milestones"
                className="w-full px-3 py-2 rounded-[10px] border text-[15px] font-bold outline-none focus:border-ink/60 tabular-nums"
                style={{ borderColor: e7.milestones ? T.danger : 'rgba(17,17,17,.2)', color: T.textPrimary }} />
              {e7.milestones
                ? <p className="text-[11px] mt-1" style={{ color: T.danger }}>{e7.milestones}</p>
                : <p className="text-[11px] mt-1" style={{ color: T.textMuted }}>One number, or several separated by commas (e.g. 5, 10, 25). Each is sent once per listing.</p>}
            </div>
          </StepCard>
          <Connector />
          <StepCard n={3} kind="Message" title="Message to the seller">
            {sv.setUp
              ? <TemplatePicker label="Email sent" value={sform.template_id} templates={data.templates} onChange={(v) => setSform((f) => ({ ...f, template_id: v }))} />
              : <p className="text-[12px]" style={{ color: T.textMuted }}>A default email (Spanish) is created on save — edit it in Templates.</p>}
            <p className="text-[11px] leading-snug" style={{ color: T.textMuted }}>
              Use <span className="font-mono">{'{{saves}}'}</span> for the number of saves and <span className="font-mono">{'{{property_url}}'}</span> for the listing link. Email / WhatsApp / Both: the channel picker above.
            </p>
          </StepCard>
        </AutomationCard>
      ) : null}

      {da && dform ? (
        <AutomationCard
          title="Unfinished draft reminders"
          channelId="draft_reminders"
          description="Emails sellers who started a listing and left it as a draft, with a button that opens that draft so they can finish it."
          enabled={da.enabled} enabledAt={da.enabled_at} busy={busy.drafts}
          onToggle={toggleDrafts} dirty={dDirty}
          onSave={() => run('drafts', 'save', () => put('drafts', { steps: dform.steps, template_id: dform.template_id }, 'Changes saved.'))}
          footnote={`Signed-in sellers and guests who typed their email in the wizard. Stops as soon as the draft is published or deleted; at most one email per person per hour; a reminder more than 7 days late is skipped.${draftStats ? ` ${draftStats}` : ''}`}
        >
          <StepCard n={1} kind="Trigger" title="A seller leaves a listing unfinished (saved as a draft)" />
          <Connector />
          <StepCard n={2} kind="Reminders" title="Email after this long without changes">
            <DraftSteps steps={dform.steps} errors={e3} onChange={(steps) => setDform((f) => ({ ...f, steps }))} />
          </StepCard>
          <Connector />
          <StepCard n={3} kind="Email" title="Email with a button that opens the draft">
            <TemplatePicker label="Email sent at every reminder" value={dform.template_id} templates={data.templates} onChange={(v) => setDform((f) => ({ ...f, template_id: v }))} />
            <p className="text-[11px] leading-snug" style={{ color: T.textMuted }}>
              The button link is <span className="font-mono">{'{{draft_url}}'}</span> — My listings → Drafts, opening that draft in the wizard (after signing in, if needed).
            </p>
          </StepCard>
        </AutomationCard>
      ) : (
        <Banner tone="warning">
          <b>“Unfinished draft reminders” isn’t set up for this country yet.</b> Apply <span className="font-mono">migrations/013_draft_reminders.sql</span> (buyer portal repo) in the AiroBase SQL editor, then reload.
        </Banner>
      )}

      {xa && xform ? (
        <AutomationCard
          title="Same property listed twice"
          channelId="duplicate_listings"
          description="When a user publishes a listing that repeats one of their own, it is NOT published: it shows in My listings as “Under review — possible duplicate”, waits in Quarantine (Approve anyway publishes it) and the user gets this email right away."
          enabled={xa.enabled} enabledAt={xa.enabled_at} busy={busy.dups}
          onToggle={toggleDups} dirty={xDirty}
          onSave={() => run('dups', 'save', () => put('dups', { template_id: xform.template_id }, 'Changes saved.'))}
          footnote={`Repeat = every detail the same (type, rent/sale, price, currency, neighbourhood, city, areas, rooms, phone — the description may differ) AND half or more of the photos the same. Checked instantly when the listing is published. Off = repeats are published like any listing.${data.duplicates?.sent ? ` ${data.duplicates.sent.toLocaleString('en-US')} sent so far.` : ''}`}
        >
          <StepCard n={1} kind="Trigger" title="A user publishes a listing that repeats one of their own — it is held, not published" />
          <Connector />
          <StepCard n={2} kind="Email" title="Email with each copy's link and a My listings button">
            <TemplatePicker label="Email sent" value={xform.template_id} templates={data.templates} onChange={(v) => setXform((f) => ({ ...f, template_id: v }))} />
            <p className="text-[11px] leading-snug" style={{ color: T.textMuted }}>
              Use <span className="font-mono">{'{{listing_links}}'}</span> for the links to each copy and <span className="font-mono">{'{{my_listings_url}}'}</span> for the button.
            </p>
          </StepCard>
        </AutomationCard>
      ) : null}

      {la && lform ? (
        <AutomationCard
          title="Listing deleted → ask why"
          channelId="listing_deleted"
          description="Right after a seller deletes one of their listings, they get this email asking why — with a link to a short feedback form (one-tap reasons: sold it, no contacts, didn’t want to pay…). Answers land in Feedback with the source “listing_deleted”."
          enabled={la.enabled} enabledAt={la.enabled_at} busy={busy.deleted}
          onToggle={toggleDeleted} dirty={lDirty}
          onSave={() => run('deleted', 'save', () => put('deleted', { template_id: lform.template_id }, 'Changes saved.'))}
          footnote={`At most one email per person every 7 days (deleting three listings at once = one email). Listings the team deletes in Properties don't send it. Every deletion is recorded either way and shows on the person's activity page.${data.deleted?.deletions ? ` ${data.deleted.deletions.toLocaleString('en-US')} deletions recorded` : ''}${data.deleted?.sent ? ` · ${data.deleted.sent.toLocaleString('en-US')} emails sent.` : data.deleted?.deletions ? '.' : ''}`}
        >
          <StepCard n={1} kind="Trigger" title="A seller deletes one of their listings (My listings → Delete)" />
          <Connector />
          <StepCard n={2} kind="Email" title="Email asking why, with a button to the feedback form">
            <TemplatePicker label="Email sent" value={lform.template_id} templates={data.templates} onChange={(v) => setLform((f) => ({ ...f, template_id: v }))} />
            <p className="text-[11px] leading-snug" style={{ color: T.textMuted }}>
              Use <span className="font-mono">{'{{feedback_url}}'}</span> for the button (the feedback form, opened on “Why did you delete your listing?”), <span className="font-mono">{'{{property_title}}'}</span> for the listing and <span className="font-mono">{'{{publish_url}}'}</span> to list again.
            </p>
          </StepCard>
        </AutomationCard>
      ) : null}

      {ns && nform ? (
        <AutomationCard
          title="Signed up, no listing yet"
          channelId="no_listing_nudge"
          description="Welcomes verified users who created an account but never posted a listing — “Welcome to Casa Libre — post your first listing for free now” — with a button to the sell wizard."
          enabled={ns.enabled} enabledAt={ns.enabledAt} busy={busy.nolist}
          onToggle={toggleNoListing} dirty={nDirty || !nl.setUp}
          onSave={() => run('nolist', 'save', () => put('nolist', nform, nl.setUp ? 'Changes saved.' : 'Saved — the two default emails were created (Email templates).'))}
          footnote={`Skips anyone with a listing (any status) or an unfinished draft — drafts get the draft reminders instead. Each email goes once per person, in the daytime (9:00–21:00 local); one more than 7 days late is skipped.${nl.setUp ? '' : ' Not set up for this country yet: saving creates it with two default emails.'}${nStats}`}
        >
          <StepCard n={1} kind="Trigger" title="A verified user signs up and hasn’t posted a listing" />
          <Connector />
          <StepCard n={2} kind="Wait" title="Send the email this many days after sign-up">
            <DayField value={nform.days} onChange={(v) => setNform((f) => ({ ...f, days: v }))} min={1} max={60} error={e5.days} suffix="days after sign-up" />
          </StepCard>
          <Connector />
          <StepCard n={3} kind="Email" title="Welcome email with a button to publish for free">
            <TemplatePicker label="Email sent" value={nform.templateId} templates={data.templates} onChange={(v) => setNform((f) => ({ ...f, templateId: v }))} error={e5.templateId} />
            <p className="text-[11px] leading-snug" style={{ color: T.textMuted }}>
              The button link is <span className="font-mono">{'{{publish_url}}'}</span> — the sell wizard, tagged utm_campaign=no_listing_nudge.
            </p>
          </StepCard>
          <Connector />
          <StepCard n={4} kind="Optional" title="Second email if they still haven’t listed">
            <DayField value={nform.secondAfter} onChange={(v) => setNform((f) => ({ ...f, secondAfter: v }))} min={0} max={59} error={e5.secondAfter} suffix="more days later" />
            <p className="text-[11px]" style={{ color: T.textMuted }}>{nHasSecond ? `Sent ${Number(nform.days) + Number(nform.secondAfter)} days after sign-up.` : 'Leave empty (or 0) for no second email.'}</p>
            {nHasSecond && <TemplatePicker label="Email sent" value={nform.reminderTemplateId} templates={data.templates} onChange={(v) => setNform((f) => ({ ...f, reminderTemplateId: v }))} error={e5.reminderTemplateId} />}
          </StepCard>
        </AutomationCard>
      ) : null}

      {pns && prform ? (
        <AutomationCard
          title="Personalize your profile"
          channelId="profile_personalization"
          description="Emails verified users whose seller profile isn’t personalized yet: why it matters (buyers trust a seller they can see → more enquiries) and how, with a button to Settings."
          enabled={pns.enabled} enabledAt={pns.enabledAt} busy={busy.profile}
          onToggle={toggleProfile} dirty={prDirty || !pn.setUp}
          onSave={() => run('profile', 'save', () => put('profile', prPatch(), pn.setUp ? 'Changes saved.' : 'Saved — the two default emails were created (Email templates).'))}
          footnote={`Personalized = photo or logo + first and last name + title or company (or all 7 items) — the emails stop then. Covers people who started their profile but didn’t finish (the email says how far they got). Each email once per person; one more than 7 days late is skipped; people who unsubscribed or bounced are skipped.${pn.setUp ? '' : ' Not set up for this country yet: saving creates it with two default emails.'}${prStats}`}
        >
          <StepCard n={1} kind="Trigger" title="A verified user whose profile isn’t personalized" />
          <Connector />
          <StepCard n={2} kind="Emails" title="Send after this long since sign-up">
            <DraftSteps steps={prform.steps} errors={ePr} min={0} label="Email" max={PROFILE_STEPS.max}
              note={<>0 hours = right after sign-up (the next hourly run). Default: 0 h, 24 h, 48 h. Stops once the profile is personalized.</>}
              onChange={(steps) => setPrform((f) => ({ ...f, steps }))} />
          </StepCard>
          <Connector />
          <StepCard n={3} kind="Email" title="Email with a button to Settings → profile">
            <TemplatePicker label="First email" value={prform.templateId} templates={data.templates} onChange={(v) => setPrform((f) => ({ ...f, templateId: v }))} error={ePr.templateId} />
            <TemplatePicker label="Later emails" value={prform.reminderTemplateId} templates={data.templates} onChange={(v) => setPrform((f) => ({ ...f, reminderTemplateId: v }))} />
            <p className="text-[11px] leading-snug" style={{ color: T.textMuted }}>
              The button link is <span className="font-mono">{'{{settings_url}}'}</span> — /cuenta/ajustes, tagged utm_campaign=profile_personalization (signed-out people sign in and land there). <span className="font-mono">{'{{progress_line}}'}</span> says how far they got.
            </p>
          </StepCard>
        </AutomationCard>
      ) : null}

      {faSet && faform ? (
        <AutomationCard
          title="Show your face"
          channelId="profile_photo_face"
          description="Emails sellers whose profile photo is a logo, explaining that buyers want to know who they are dealing with. Logos are never blocked. Uploads that are neither a face nor a logo (a house, an apartment, an object…) are turned down on the spot; those people — and the older “?” photos — get the wrong-photo emails below until they upload their face or their logo."
          enabled={faSet.enabled} enabledAt={faSet.enabledAt} busy={busy.face}
          onToggle={toggleFace} dirty={faDirty || !faData.setUp}
          onSave={() => run('face', 'save', () => put('face', faPatch(), faData.setUp ? 'Changes saved.' : 'Saved — the two default emails were created (Email templates).'))}
          footnote={`The AI checks each upload (face / logo / other) and each approved photo once. Before every email the photo is read again: once it is a real photo of the person (or, for wrong photos, a face or a logo), nothing more is sent. Each email once per person; one more than 7 days late is skipped; people who unsubscribed or bounced are skipped. Turned-down uploads are recorded only after migration 014.${faData.setUp ? '' : ' Not set up for this country yet: saving creates it with the default emails.'}${faStats}${fwStats}`}
        >
          <StepCard n={1} kind="Trigger" title="An approved profile photo that is a logo" />
          <Connector />
          <StepCard n={2} kind="Emails" title="Send after this long since the photo was approved">
            <DraftSteps steps={faform.steps} errors={eFa} min={0} label="Email" max={PHOTO_FACE_STEPS.max}
              note={<>Default: 1 day, 3 days and 7 days. Add up to {PHOTO_FACE_STEPS.max} emails. Stops as soon as the photo is a real photo of the person.</>}
              onChange={(steps) => setFaform((f) => ({ ...f, steps }))} />
          </StepCard>
          <Connector />
          <StepCard n={3} kind="Email" title="Email with a button to Settings → profile photo">
            <TemplatePicker label="First email" value={faform.templateId} templates={data.templates} onChange={(v) => setFaform((f) => ({ ...f, templateId: v }))} error={eFa.templateId} />
            <TemplatePicker label="Later emails" value={faform.reminderTemplateId} templates={data.templates} onChange={(v) => setFaform((f) => ({ ...f, reminderTemplateId: v }))} />
            <p className="text-[11px] leading-snug" style={{ color: T.textMuted }}>
              The button link is <span className="font-mono">{'{{settings_url}}'}</span> — /cuenta/ajustes, tagged utm_campaign=profile_photo_face. <span className="font-mono">{'{{photo_line}}'}</span> says they have a logo instead of a photo of themselves.
            </p>
          </StepCard>
          <Connector />
          <StepCard n={4} kind="Trigger" title="Wrong photo: an upload turned down (neither a face nor a logo), or a “?” photo">
            <label className="flex items-center gap-2 text-[13px]" style={{ color: T.textPrimary }}>
              <input type="checkbox" checked={!!faform.wrongOn} onChange={(e) => setFaform((f) => ({ ...f, wrongOn: e.target.checked }))} data-testid="photo-wrong-on" />
              Send the wrong-photo emails (only while “Show your face” is on)
            </label>
            {fwSet && !fwSet.setUp ? <p className="text-[11px] mt-1" style={{ color: T.textMuted }}>Not set up for this country yet: saving creates it with three default emails (Spanish).</p> : null}
            {eFa.wrong_enabled ? <p className="text-[11px] mt-1" style={{ color: T.danger }}>{eFa.wrong_enabled}</p> : null}
          </StepCard>
          <Connector />
          <StepCard n={5} kind="Emails" title="Send after this long since the upload was turned down">
            <DraftSteps steps={faform.wrongSteps} errors={eFw} min={0} label="Email" max={PHOTO_FACE_STEPS.max}
              note={<>Default: 2 hours, 2 days and 7 days. For the “?” photos the clock starts when this is switched on. Stops as soon as they have a face or a logo (a logo then gets the “Show your face” emails above).{eFa.wrong_steps ? <b style={{ color: T.danger }}> {eFa.wrong_steps}</b> : null}</>}
              onChange={(wrongSteps) => setFaform((f) => ({ ...f, wrongSteps }))} />
          </StepCard>
          <Connector />
          <StepCard n={6} kind="Email" title="Wrong-photo emails">
            <TemplatePicker label="First email" value={faform.wrongTemplateId} templates={data.templates} onChange={(v) => setFaform((f) => ({ ...f, wrongTemplateId: v }))} />
            <TemplatePicker label="Later emails" value={faform.wrongReminderTemplateId} templates={data.templates} onChange={(v) => setFaform((f) => ({ ...f, wrongReminderTemplateId: v }))} />
            <TemplatePicker label="Still has a valid photo (one email: new photo not accepted)" value={faform.keptTemplateId} templates={data.templates} onChange={(v) => setFaform((f) => ({ ...f, keptTemplateId: v }))} />
            <p className="text-[11px] leading-snug" style={{ color: T.textMuted }}>
              <span className="font-mono">{'{{photo_line}}'}</span> says what happened: “La imagen que intentaste subir parece ser una foto de una casa…”, “La imagen de tu perfil no muestra tu cara ni el logo…” or “La nueva imagen que subiste parece ser una foto de… seguimos mostrando tu foto anterior”. The “new photo not accepted” email goes once (at the first step’s time), at most once per 30 days.
            </p>
          </StepCard>
        </AutomationCard>
      ) : null}

      {rps && rform ? (
        <AutomationCard
          title="Promote the referral program"
          description={<>Tells members about the referral program — “Invitá a alguien a publicar y ganá la insignia Verificada gratis + tu propiedad en la portada” — with their own referral link and a button to their Referrals page.{rProgramOn ? null : <b style={{ color: T.warning }}> The referral program is OFF in this country: nothing is sent until it is switched on (<Link href="/referrals" className="underline underline-offset-2">Referrals</Link>).</b>}{rProgramOn && rpd.program.referrerReward === false ? <b style={{ color: T.warning }}> The referrer reward is off on the Referrals page, so nothing is sent (the email promises it).</b> : null}</>}
          enabled={rps.enabled} enabledAt={rps.enabledAt} busy={busy.promo}
          onToggle={togglePromo} dirty={rDirty || !rpd.setUp}
          onSave={() => run('promo', 'save', () => put('promo', rPatch(), rpd.setUp ? 'Changes saved.' : 'Saved — the default email was created (Templates).'))}
          footnote={`Verified accounts only${rpd.program?.requireListing ? ', with a live listing (Referrals setting)' : ''}. Stops early when the person referred someone who signed up, replied BAJA on WhatsApp, closed or deleted their account, or their last email bounced or was marked as spam. Sends only while the referral program is on; the reward days and people count in the email are the Referrals page settings. Daytime only (9:00–19:00 local). Email only — no WhatsApp template carries the referral link yet.${rpd.setUp ? '' : ' Not set up for this country yet: saving creates it with the default email.'}${rStats ? ` ${rStats}.` : ''}`}
        >
          <StepCard n={1} kind="Trigger" title="A verified user signs up" />
          <Connector />
          <StepCard n={2} kind="Wait" title="First email this long after sign-up">
            <DayField value={rform.firstAfterHours} onChange={(v) => setRform((f) => ({ ...f, firstAfterHours: v }))} min={1} max={720} error={e9.firstAfterHours} suffix="hours after sign-up" />
            <p className="text-[11px]" style={{ color: T.textMuted }}>24 = the day after they sign up.</p>
          </StepCard>
          <Connector />
          <StepCard n={3} kind="Repeat" title="Then again, until they invite someone">
            <DayField value={rform.everyDays} onChange={(v) => setRform((f) => ({ ...f, everyDays: v }))} min={1} max={60} error={e9.everyDays} suffix="days between emails" />
            <DayField value={rform.maxSends} onChange={(v) => setRform((f) => ({ ...f, maxSends: v }))} min={1} max={10} error={e9.maxSends} suffix={Number(rform.maxSends) === 1 ? 'email at most' : 'emails at most'} />
            <p className="text-[11px]" style={{ color: T.textMuted }} data-testid="promo-when">Sent at: {rWhen} (counted from sign-up).</p>
          </StepCard>
          <Connector />
          <StepCard n={4} kind="Email" title="Email with their referral link">
            <TemplatePicker label="Email sent every time" value={rform.templateId} templates={data.templates} onChange={(v) => setRform((f) => ({ ...f, templateId: v }))} error={e9.enabled} />
            <p className="text-[11px] leading-snug" style={{ color: T.textMuted }}>
              <span className="font-mono">{'{{referral_url}}'}</span> = their link, <span className="font-mono">{'{{referrals_url}}'}</span> = their Referrals page, <span className="font-mono">{'{{reward_plan}}'}</span> / <span className="font-mono">{'{{reward_days}}'}</span> / <span className="font-mono">{'{{milestone_count}}'}</span> = the program settings.
            </p>
          </StepCard>
          <Connector />
          <StepCard n={5} kind="Existing users" title="People who signed up before it was switched on">
            <label className="flex items-start gap-2 text-[13px]" style={{ color: T.textBody }}>
              <input type="checkbox" className="mt-0.5" checked={!!rform.includeExisting} onChange={(e) => setRform((f) => ({ ...f, includeExisting: e.target.checked }))} data-testid="promo-existing" />
              <span>Also send to people who signed up before this was switched on</span>
            </label>
            <p className="text-[11px]" style={{ color: T.textMuted }}>{rform.includeExisting ? 'Their first email goes at the next run, then the same repeats.' : 'Only people who sign up after it is switched on.'}</p>
            <DayField value={rform.perRun} onChange={(v) => setRform((f) => ({ ...f, perRun: v }))} min={1} max={1000} error={e9.perRun} suffix="emails at most per hourly run" />
            <p className="text-[11px]" style={{ color: T.textMuted }}>Switching it on never sends to everyone at once: repeats and new sign-ups go first, then older accounts, newest first.</p>
          </StepCard>
        </AutomationCard>
      ) : null}

      {hs && hform ? (
        <AutomationCard
          title="Listing not published"
          channelId="listing_held"
          description="When a seller's listing is held off the site — waiting for payment, photos rejected, paused, or missing details — they get a message telling them why, with a button to My listings to fix it or pay."
          enabled={hs.enabled} enabledAt={hs.enabledAt} busy={busy.held}
          onToggle={toggleHeld} dirty={hDirty || !hl.setUp}
          onSave={() => run('held', 'save', () => put('held', hform, hl.setUp ? 'Changes saved.' : 'Saved — the four default emails were created (Templates).'))}
          footnote={`Only listings created after it is switched on. Stops as soon as the listing goes live. Duplicates and ended paid listings have their own emails. Daytime only (9:00–21:00 local).${hl.setUp ? '' : ' Not set up for this country yet: saving creates it with four default emails.'}${hl.sent ? ` ${hl.sent.toLocaleString('en-US')} sent so far (${hl.reasons.filter((r) => hl.perReason[r.reason]).map((r) => `${r.label.toLowerCase()}: ${hl.perReason[r.reason]}`).join(' · ')}).` : ''}`}
        >
          <StepCard n={1} kind="Trigger" title="A seller's listing is held — not on the site" />
          <Connector />
          <StepCard n={2} kind="Wait" title="Send the message this many hours later">
            <DayField value={hform.hours} onChange={(v) => setHform((f) => ({ ...f, hours: v }))} min={1} max={720} error={e6.hours} suffix="hours after it was held" />
            <p className="text-[11px]" style={{ color: T.textMuted }}>Gives them time to pay or fix it on the spot first.</p>
          </StepCard>
          <Connector />
          <StepCard n={3} kind="Message" title="One message per reason, with a My listings button">
            <div className="space-y-1.5">
              {hl.reasons.map((r) => (
                <div key={r.reason} className="flex items-center justify-between gap-2 text-[12px] px-2.5 py-1.5 rounded-[8px]" style={{ background: T.bgWhite, border: `1px solid ${T.borderLight}` }}>
                  <span style={{ color: T.textBody }}>{r.label}</span>
                  {r.template
                    ? <Link href={`/email-templates/${r.template.id}`} className="underline underline-offset-2 truncate max-w-[55%]" style={{ color: r.template.is_active === false ? T.textMuted : T.textSecondary }}>{r.template.is_active === false ? 'Off' : 'Edit email'}</Link>
                    : <span style={{ color: T.textMuted }}>{hl.setUp ? 'missing' : 'created on save'}</span>}
                </div>
              ))}
            </div>
            <p className="text-[11px] leading-snug" style={{ color: T.textMuted }}>Switch a reason off by switching its email off in Templates.</p>
          </StepCard>
          <Connector />
          <StepCard n={4} kind="Optional" title="Reminder if it's still not published">
            <DayField value={hform.reminderAfter} onChange={(v) => setHform((f) => ({ ...f, reminderAfter: v }))} min={0} max={719} error={e6.reminderAfter} suffix="more hours later" />
            <p className="text-[11px]" style={{ color: T.textMuted }}>{hHasReminder ? `Sent ${Number(hform.hours) + Number(hform.reminderAfter)} hours after it was held (same message).` : 'Leave empty (or 0) for no reminder.'}</p>
          </StepCard>
        </AutomationCard>
      ) : null}

      {/* Weekly newsletter (its own API + state: components/automations/NewsletterCard.js) */}
      <NewsletterCard />

      {/* Share your listing: nudges + reward (its own API + state: components/automations/ShareCards.js) */}
      <ShareCards />

      {pfs && pform ? (
        <AutomationCard
          title="Waiting for payment → free listing"
          channelId="payment_followup"
          description="A seller went over the free listings of the month, saw the payment and stopped. They get payment reminders; if they still don't pay, one email offers THAT listing for free (a gift that builds trust), with a limit per person so waiting doesn't become the way to skip paying."
          enabled={pfs.enabled} enabledAt={pfs.enabledAt} busy={busy.pay}
          onToggle={togglePay} dirty={pDirty || !pf.setUp}
          onSave={() => run('pay', 'save', () => put('pay', pPatch(), pf.setUp ? 'Changes saved.' : 'Saved — the gift email was created (Templates).'))}
          footnote={`Only listings saved after it is switched on. Stops the moment they pay. While this is on, "Listing not published" doesn't send its payment message. Daytime only.${pf.setUp ? '' : ' Not set up for this country yet: saving creates it and the gift email.'}${pStats ? ` ${pStats}.` : ''}`}
        >
          <StepCard n={1} kind="Trigger" title="A listing is saved over the free limit and not paid" />
          <Connector />
          <StepCard n={2} kind="Reminders" title="Payment reminders, after the listing was saved">
            <DraftSteps steps={pform.steps} errors={e8} onChange={(list) => setPform((f) => ({ ...f, steps: list }))}
              note="Each reminder goes once per listing (up to 6), only while it is still unpaid — e.g. every day for the first 6 days." max={6} />
            <TemplatePicker label="Reminder email" value={pform.reminderTemplateId} templates={data.templates} onChange={(v) => setPform((f) => ({ ...f, reminderTemplateId: v }))} error={e8.reminderTemplateId} />
          </StepCard>
          <Connector />
          <StepCard n={3} kind="Gift" title="Still not paid: publish THAT listing for free">
            <DayField value={pform.giftAfterDays} onChange={(v) => setPform((f) => ({ ...f, giftAfterDays: v }))} min={0} max={60} error={e8.giftAfterDays} suffix="days after it was saved" />
            <p className="text-[11px]" style={{ color: T.textMuted }}>{pGift ? `${pform.giftAfterDays} days after it was saved, if still unpaid: ONE email with a button that publishes that listing for free (only that seller, only that listing; valid 14 days). After it, no more reminders.` : '0 = no gift: reminders only. Set the days (after the last reminder, e.g. 8) to send this email.'}</p>
            <div style={{ opacity: pGift ? 1 : 0.55 }}>
              <TemplatePicker label={pGift ? 'Gift email' : 'Gift email (not sent while the days are 0)'} value={pform.giftTemplateId} templates={data.templates} onChange={(v) => setPform((f) => ({ ...f, giftTemplateId: v }))} error={e8.giftTemplateId} />
            </div>
            <p className="text-[11px] leading-snug" style={{ color: T.textMuted }}>Always by email (there is no WhatsApp template for the gift yet), even when Send by is WhatsApp.</p>
            {pGift && <DayField value={pform.giftDays} onChange={(v) => setPform((f) => ({ ...f, giftDays: v }))} min={1} max={365} error={e8.giftDays} suffix="days live (then it ends like a paid one)" />}
          </StepCard>
          <Connector />
          <StepCard n={4} kind="Limit" title="How many free gifts one person can get">
            <div className="flex flex-wrap items-center gap-2">
              <DayField value={pform.giftsPerPerson} onChange={(v) => setPform((f) => ({ ...f, giftsPerPerson: v }))} min={1} max={100} error={e8.giftsPerPerson} suffix={Number(pform.giftsPerPerson) === 1 ? 'gift' : 'gifts'} />
              <select value={pform.giftWindowDays} onChange={(e) => setPform((f) => ({ ...f, giftWindowDays: Number(e.target.value) }))} aria-label="Gift limit period"
                className="px-2 py-1.5 rounded-[10px] border text-[13px] font-medium outline-none focus:border-ink/60" style={{ borderColor: 'rgba(17,17,17,.2)', color: T.textPrimary, background: T.bgWhite }}>
                {[[0, 'ever'], [30, 'every 30 days'], [90, 'every 90 days'], [180, 'every 6 months'], [365, 'every year']].map(([d, l]) => <option key={d} value={d}>{l}</option>)}
              </select>
            </div>
            <p className="text-[11px] leading-snug" style={{ color: T.textMuted }}>
              Per person = their account plus any listing with the same phone. Over the limit, later listings only get the reminders — so a seller can&apos;t wait out every listing to get it free. Open and taken gifts count; an offer that expired untaken doesn&apos;t.
            </p>
          </StepCard>
        </AutomationCard>
      ) : null}
    </div>
  );
}
