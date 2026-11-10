'use client';
// Referrals — the referral program of the active country. Tabs:
//   Program   on/off, rewards (who gets what plan for how long), the home-page milestone,
//             reminders, eligibility, the message people share, the emails
//   Invite    the verified users the invite goes to, the message, send
//   Referrers every link: clicks, sign-ups, qualified, rewards
//   People    who referred whom, with status; approve a same-person rejection or reject
//   Rewards   every reward with its listing and end date; grant manually, revoke
// The website runs the program (link, sign-up, hourly engine); this page sets it up.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { T, CARD, PageHeader, Banner, Pill, fmtDate, inputCls, btnPrimary, btnSecondary } from '@/components/automations/ui';
import { ChannelControl } from '@/components/automations/WhatsAppChannels';
import { useDialog } from '@/components/Dialog';
import { STATE_LABEL, HOLD_LABEL, REASON_LABEL, TYPE_LABEL, PLAN_LABEL } from '@/lib/referralsLabels';

const TABS = [['program', 'Program'], ['invite', 'Invite'], ['referrers', 'Referrers'], ['people', 'People'], ['rewards', 'Rewards']];
const TONE = { qualified: 'success', granted: 'success', signed_up: 'info', pending: 'warning', rejected: 'danger', revoked: 'danger', expired: 'neutral' };

function Field({ label, help, error, children }) {
  return (
    <label className="block">
      <span className="block text-[13px] font-semibold mb-1" style={{ color: T.textPrimary }}>{label}</span>
      {children}
      {help && <span className="block text-[12px] mt-1 leading-snug" style={{ color: T.textSecondary }}>{help}</span>}
      {error && <span className="block text-[12px] mt-1 font-medium" style={{ color: T.danger }}>{error}</span>}
    </label>
  );
}
function Stat({ label, value, hint }) {
  return (
    <div className="rounded-[14px] p-4" style={CARD}>
      <div className="text-[11px] font-mono uppercase tracking-label" style={{ color: T.textMuted }}>{label}</div>
      <div className="text-[24px] font-bold tracking-head mt-1" style={{ color: T.textPrimary }}>{value}</div>
      {hint && <div className="text-[11.5px] mt-0.5" style={{ color: T.textSecondary }}>{hint}</div>}
    </div>
  );
}
function Card({ title, sub, children, action }) {
  return (
    <section className="rounded-[14px]" style={CARD}>
      <div className="px-5 md:px-6 py-4 border-b flex items-start justify-between gap-3" style={{ borderColor: T.borderLight }}>
        <div>
          <h2 className="text-[15px] font-bold" style={{ color: T.textPrimary }}>{title}</h2>
          {sub && <p className="text-[12.5px] mt-0.5" style={{ color: T.textSecondary }}>{sub}</p>}
        </div>
        {action}
      </div>
      <div className="px-5 md:px-6 py-4">{children}</div>
    </section>
  );
}
const Th = ({ children }) => <th className="py-2 pr-3 font-medium whitespace-nowrap">{children}</th>;
const Person = ({ p }) => (
  <a href={`/analytics?user=${encodeURIComponent(p.id)}${p.email ? `&email=${encodeURIComponent(p.email)}` : ''}`} className="font-medium underline underline-offset-2" style={{ color: T.textPrimary }}>
    {p.name || p.email || String(p.id || '').slice(0, 8)}
    {p.name && p.email ? <span className="block text-[11.5px] no-underline font-normal" style={{ color: T.textMuted }}>{p.email}</span> : null}
  </a>
);

// ── Program ────────────────────────────────────────────────────────────────────────
function RewardFields({ title, help, value, onChange, errors, prefix, extra }) {
  return (
    <div className="rounded-[12px] p-4" style={{ background: T.bgSurface, border: `1px solid ${T.borderLight}` }}>
      <label className="flex items-center gap-2 text-[13.5px] font-semibold" style={{ color: T.textPrimary }}>
        <input type="checkbox" checked={!!value.enabled} onChange={(e) => onChange({ ...value, enabled: e.target.checked })} /> {title}
      </label>
      <p className="text-[12px] mt-1 mb-3" style={{ color: T.textSecondary }}>{help}</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Plan" error={errors[`${prefix}.plan`]}>
          <select className={inputCls} value={value.plan} onChange={(e) => onChange({ ...value, plan: e.target.value })} disabled={!value.enabled}>
            <option value="verified">Verified (badge)</option>
            <option value="home">Verified + home page</option>
          </select>
        </Field>
        <Field label="Days" error={errors[`${prefix}.days`]}>
          <input className={inputCls} type="number" min="1" max="365" value={value.days} onChange={(e) => onChange({ ...value, days: e.target.value })} disabled={!value.enabled} />
        </Field>
        {extra}
      </div>
    </div>
  );
}

function ProgramTab({ data, reload }) {
  const s = data.settings;
  const [f, setF] = useState(() => ({
    enabled: s.enabled, attributionDays: s.attributionDays, referrer: { ...s.referrer }, newUser: { ...s.newUser }, milestone: { ...s.milestone },
    remindDays: s.remindDays.join(', '), maxRewardsPerReferrer: s.maxRewardsPerReferrer, requireReferrerListing: s.requireReferrerListing,
    inviteChannel: s.inviteChannel, inviteWaTemplate: s.inviteWaTemplate, shareText: s.shareText,
  }));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const num = (v) => (v === '' || v == null ? v : Number(v));
  async function save(extra = {}) {
    setSaving(true); setMsg(null); setErrors({});
    const body = {
      ...f, ...extra, attributionDays: num(f.attributionDays), maxRewardsPerReferrer: num(f.maxRewardsPerReferrer),
      referrer: { ...f.referrer, days: num(f.referrer.days) }, newUser: { ...f.newUser, days: num(f.newUser.days) },
      milestone: { ...f.milestone, days: num(f.milestone.days), every: num(f.milestone.every) },
    };
    const r = await fetch('/api/referrals', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => ({ error: 'network' }));
    setSaving(false);
    if (r.errors) { setErrors(r.errors); setMsg({ tone: 'error', text: 'Some settings need fixing (see below).' }); return; }
    if (r.error) { setMsg({ tone: 'error', text: `Could not save: ${r.error}` }); return; }
    if (extra.enabled !== undefined) setF((x) => ({ ...x, enabled: extra.enabled }));
    setMsg({ tone: 'ok', text: r.created ? `Saved. The program and ${r.templatesCreated} emails were created for this country.` : 'Saved.' });
    reload();
  }
  const preview = f.shareText.replace(/\{\{\s*link\s*\}\}/g, `${data.site}/ref/abcd2345`).replace(/\{\{\s*country\s*\}\}/g, data.countryName || 'Paraguay').replace(/\{\{\s*new_user_days\s*\}\}/g, String(f.newUser.days)).replace(/\{\{\s*reward_days\s*\}\}/g, String(f.referrer.days));

  return (
    <div className="space-y-5">
      <Card
        title={f.enabled ? 'The program is ON in this country' : 'The program is OFF in this country'}
        sub={f.enabled
          ? 'New referrals count and rewards are given. Switching off stops new referrals and rewards; rewards already given still end on time.'
          : data.setUp ? 'No referral counts and no reward is given while it is off. Links still open the site.' : 'Nothing is set up here yet. The first save creates the program and its five emails (in Spanish) for this country.'}
        action={<button className={btnPrimary} disabled={saving} onClick={() => save({ enabled: !f.enabled })}>{f.enabled ? 'Switch off' : 'Switch on'}</button>}
      >
        <div className="grid md:grid-cols-3 gap-3">
          <RewardFields title="New member reward" prefix="newUser" help="The person who signs up with a link and publishes: their listing gets this, free." value={f.newUser} onChange={set('newUser')} errors={errors} />
          <RewardFields title="Referrer reward" prefix="referrer" help="For each qualified referral, one of the referrer’s live listings gets this (the newest without a promotion; otherwise the days are added on)." value={f.referrer} onChange={set('referrer')} errors={errors} />
          <RewardFields
            title="Milestone reward" prefix="milestone" help="When the referrer reaches this many qualified referrals. In addition to the per-referral reward." value={f.milestone} onChange={set('milestone')} errors={errors}
            extra={<>
              <Field label="After how many referrals" error={errors['milestone.every']}>
                <input className={inputCls} type="number" min="1" max="100" value={f.milestone.every} onChange={(e) => set('milestone')({ ...f.milestone, every: e.target.value })} disabled={!f.milestone.enabled} />
              </Field>
              <label className="flex items-end gap-2 text-[12.5px] pb-3" style={{ color: T.textBody }}>
                <input type="checkbox" checked={!!f.milestone.repeat} onChange={(e) => set('milestone')({ ...f.milestone, repeat: e.target.checked })} disabled={!f.milestone.enabled} /> Again every {f.milestone.every || 'N'} more
              </label>
            </>}
          />
        </div>
        <div className="grid md:grid-cols-4 gap-4 mt-5">
          <Field label="Link remembered for (days)" help="Time between the first click and the sign-up. The first link a person used wins." error={errors.attributionDays}>
            <input className={inputCls} type="number" min="1" max="365" value={f.attributionDays} onChange={(e) => set('attributionDays')(e.target.value)} />
          </Field>
          <Field label="Reminder emails (days before the end)" help="e.g. 3, 1 — encourages a paid renewal." error={errors.remindDays}>
            <input className={inputCls} value={f.remindDays} onChange={(e) => set('remindDays')(e.target.value)} />
          </Field>
          <Field label="Max rewarded referrals per person" help="0 = no limit. Past it, the new member still gets theirs." error={errors.maxRewardsPerReferrer}>
            <input className={inputCls} type="number" min="0" value={f.maxRewardsPerReferrer} onChange={(e) => set('maxRewardsPerReferrer')(e.target.value)} />
          </Field>
          <Field label="Who can refer" help="Always verified accounts only.">
            <label className="flex items-center gap-2 text-[13px] mt-2" style={{ color: T.textBody }}>
              <input type="checkbox" checked={!!f.requireReferrerListing} onChange={(e) => set('requireReferrerListing')(e.target.checked)} /> Only people with a live listing
            </label>
          </Field>
        </div>
      </Card>

      <Card title="The message people share" sub="Shown on each person’s Referrals page with a WhatsApp share button. Use {{link}} for their link; {{country}}, {{new_user_days}} and {{reward_days}} are filled in too.">
        <Field error={errors.shareText}>
          <textarea className={`${inputCls} min-h-[96px]`} value={f.shareText} onChange={(e) => set('shareText')(e.target.value)} />
        </Field>
        <div className="mt-3 text-[12.5px] rounded-[12px] p-3 whitespace-pre-wrap" style={{ background: T.bgSurface, color: T.textBody }}><span className="font-mono text-[10px] uppercase tracking-label mr-2" style={{ color: T.textMuted }}>Preview</span>{preview}</div>
      </Card>

      <Card title="Invite channel" sub="How the invite to existing users goes out (Invite tab). WhatsApp needs a Meta-approved Relay template; its button should open https://<site>/ref/{{1}}.">
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Send the invite by" error={errors.inviteChannel}>
            <select className={inputCls} value={f.inviteChannel} onChange={(e) => set('inviteChannel')(e.target.value)}>
              <option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="both">Email and WhatsApp</option>
            </select>
          </Field>
          <Field label="WhatsApp template name" help="e.g. cl_referidos_invitacion (body {{1}} = first name)." error={errors.inviteWaTemplate}>
            <input className={inputCls} value={f.inviteWaTemplate} onChange={(e) => set('inviteWaTemplate')(e.target.value)} placeholder="not set" />
          </Field>
        </div>
      </Card>

      <Card title="Emails" sub="Edit the Spanish text in Templates (with the English preview). The website sends them; each one goes once.">
        <div className="divide-y" style={{ borderColor: T.borderLight }}>
          {data.templates.map((t) => (
            <div key={t.key} className="py-2.5 flex items-center justify-between gap-3">
              <div>
                <div className="text-[13.5px] font-medium" style={{ color: T.textPrimary }}>{t.name || t.key}</div>
                <div className="text-[12px]" style={{ color: T.textMuted }}>{t.subject || 'Created on the first save'}</div>
              </div>
              {t.id ? <a className={btnSecondary} style={{ borderColor: T.borderLight }} href={`/email-templates/${t.id}`}>Edit</a> : <Pill>not created</Pill>}
            </div>
          ))}
        </div>
      </Card>
      {data.setUp && <section className="rounded-[14px] overflow-hidden" style={CARD}><ChannelControl id="referrals" /></section>}

      <div className="flex items-center gap-3">
        <button className={btnPrimary} disabled={saving} onClick={() => save()}>{saving ? 'Saving…' : 'Save settings'}</button>
        {msg && <span className="text-[13px]" style={{ color: msg.tone === 'ok' ? T.success : T.danger }}>{msg.text}</span>}
      </div>
    </div>
  );
}

// ── Invite ─────────────────────────────────────────────────────────────────────────
function InviteTab({ data, reload, confirm }) {
  const [aud, setAud] = useState(null);
  const [sel, setSel] = useState(new Set());
  const [channel, setChannel] = useState(data.settings.inviteChannel);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const load = useCallback(() => fetch('/api/referrals?view=audience', { cache: 'no-store' }).then((r) => r.json()).then((d) => {
    setAud(d);
    setSel(new Set((d.people || []).filter((p) => !p.invited).map((p) => p.id)));
  }), []);
  useEffect(() => { load(); }, [load]);
  if (!data.setUp) return <Banner tone="warning">Save the program settings first (Program tab).</Banner>;
  if (!aud) return <div className="text-[13px]" style={{ color: T.textMuted }}>Loading the audience…</div>;
  const people = aud.people || [];
  const toggle = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const live = aud.sendMode === 'live';
  async function send() {
    const n = sel.size;
    const ok = await confirm({
      title: live ? `Send the invite to ${n} people?` : `Record the invite for ${n} people?`,
      message: live ? `This sends real ${channel === 'both' ? 'emails and WhatsApp messages' : channel === 'whatsapp' ? 'WhatsApp messages' : 'emails'} now. It can’t be undone.` : 'Sending is not switched on for this server (REFERRAL_SEND_MODE). Nothing is sent: each invite is recorded with its link, so you can check the batch.',
      confirmLabel: live ? 'Send now' : 'Record',
      tone: live ? 'danger' : undefined,
    });
    if (!ok) return;
    setBusy(true); setResult(null);
    const r = await fetch('/api/referrals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'send', ids: [...sel], channel }) }).then((x) => x.json()).catch(() => ({ error: 'network' }));
    setBusy(false); setResult(r); load(); reload();
  }
  return (
    <div className="space-y-5">
      {live
        ? <Banner>Sending is LIVE on this server: the invite goes to real people.</Banner>
        : <Banner tone="warning"><b>Preview mode.</b> This server does not send invites (REFERRAL_SEND_MODE is not &quot;live&quot;). Sending only records each invite and its link.</Banner>}
      <div className="grid lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-5">
        <Card
          title={`Audience · ${people.length} verified users`}
          sub="Verified account (email or WhatsApp proven), active, not blocked, not deleted, not the team’s own accounts."
          action={<div className="flex gap-2">
            <button className={btnSecondary} style={{ borderColor: T.borderLight }} onClick={() => setSel(new Set(people.map((p) => p.id)))}>All</button>
            <button className={btnSecondary} style={{ borderColor: T.borderLight }} onClick={() => setSel(new Set(people.filter((p) => !p.invited).map((p) => p.id)))}>Not invited yet</button>
            <button className={btnSecondary} style={{ borderColor: T.borderLight }} onClick={() => setSel(new Set())}>None</button>
          </div>}
        >
          <div className="max-h-[460px] overflow-auto">
            <table className="w-full text-[13px]">
              <thead><tr className="text-left" style={{ color: T.textMuted }}><Th /><Th>Person</Th><Th>WhatsApp</Th><Th>Live listings</Th><Th>Link</Th></tr></thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id} className="border-t align-top" style={{ borderColor: T.borderLight }} data-testid="audience-row">
                    <td className="py-2 pr-2"><input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} /></td>
                    <td className="py-2 pr-3"><span className="font-medium" style={{ color: T.textPrimary }}>{p.name || p.email}</span>{p.name && <span className="block text-[11.5px]" style={{ color: T.textMuted }}>{p.email}</span>}{p.invited && <span className="block mt-0.5"><Pill>invited before</Pill></span>}</td>
                    <td className="py-2 pr-3 text-[12px]" style={{ color: T.textSecondary }}>{p.phone ? `${p.phone}${p.phoneVerified ? ' ✓' : ''}` : '—'}</td>
                    <td className="py-2 pr-3 tabular-nums">{p.liveListings}</td>
                    <td className="py-2 font-mono text-[11.5px]" style={{ color: T.textSecondary }}>{p.link.replace(/^https?:\/\//, '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Message" sub={aud.preview ? `Subject: ${aud.preview.subject}` : 'The invite email is created on the first save.'}>
          {aud.preview && <iframe title="Invite preview" srcDoc={aud.preview.html} className="w-full h-[420px] rounded-[10px]" style={{ border: `1px solid ${T.borderLight}`, background: '#fff' }} />}
          <p className="text-[12px] mt-2" style={{ color: T.textSecondary }}>Shown for {aud.preview?.to || 'a sample person'}. Each person gets their own link. Edit the text in Templates → “Referrals — invite”.</p>
        </Card>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <select className={`${inputCls} max-w-[220px]`} value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="email">By email</option>
          <option value="whatsapp" disabled={!aud.waTemplate}>By WhatsApp{aud.waTemplate ? '' : ' (no template set)'}</option>
          <option value="both" disabled={!aud.waTemplate}>Email and WhatsApp</option>
        </select>
        <button className={btnPrimary} disabled={busy || !sel.size} onClick={send}>{busy ? 'Working…' : live ? `Send to ${sel.size} people` : `Record invite for ${sel.size} people`}</button>
        <span className="text-[12px]" style={{ color: T.textMuted }}>People already invited are skipped.</span>
      </div>
      {result && (result.error ? <Banner>Could not send: {result.error}</Banner> : (
        <Banner tone="warning">Batch {result.batch}: {result.people} people{result.mode === 'live' ? ` · ${result.emails} emails · ${result.whatsapp} WhatsApp · ${result.failed} failed` : ` recorded (nothing sent)`}{result.skipped ? ` · ${result.skipped} skipped (invited before)` : ''}.</Banner>
      ))}
      {data.batches.length > 0 && (
        <Card title="Past invites">
          <table className="w-full text-[13px]">
            <thead><tr className="text-left" style={{ color: T.textMuted }}><Th>When</Th><Th>Batch</Th><Th>Channel</Th><Th>People</Th><Th>Result</Th></tr></thead>
            <tbody>{data.batches.map((b) => (
              <tr key={b.id} className="border-t" style={{ borderColor: T.borderLight }}>
                <td className="py-2 pr-3">{fmtDate(b.at, true)}</td><td className="py-2 pr-3 font-mono text-[12px]">{b.id}</td><td className="py-2 pr-3">{b.channel}</td><td className="py-2 pr-3 tabular-nums">{b.people}</td>
                <td className="py-2">{b.mode === 'live' ? `${b.emails} emails · ${b.whatsapp} WhatsApp${b.failed ? ` · ${b.failed} failed` : ''}` : <Pill>recorded only</Pill>}</td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// ── Referrers / People / Rewards ─────────────────────────────────────────────────────
function ReferrersTab({ data }) {
  const [copied, setCopied] = useState(null);
  if (!data.referrers.length) return <Banner tone="warning">No referral links yet. A person’s link is created when they open their Referrals page or get the invite.</Banner>;
  return (
    <Card title={`${data.referrers.length} referrers`} sub="Everyone with a link, most successful first.">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead><tr className="text-left" style={{ color: T.textMuted }}><Th>Referrer</Th><Th>Link</Th><Th>Clicks</Th><Th>Signed up</Th><Th>Waiting</Th><Th>Qualified</Th><Th>Not counted</Th><Th>Rewards</Th><Th>Last activity</Th></tr></thead>
          <tbody>{data.referrers.map((r) => (
            <tr key={r.userId} className="border-t align-top" style={{ borderColor: T.borderLight }} data-testid="referrer-row">
              <td className="py-2 pr-3"><Person p={{ id: r.userId, name: r.name, email: r.email }} /></td>
              <td className="py-2 pr-3 font-mono text-[11.5px]">{r.link ? <button className="underline underline-offset-2" onClick={() => { navigator.clipboard?.writeText(r.link); setCopied(r.userId); }}>{copied === r.userId ? 'copied' : r.link.replace(/^https?:\/\//, '')}</button> : '—'}</td>
              <td className="py-2 pr-3 tabular-nums">{r.clicks}</td><td className="py-2 pr-3 tabular-nums">{r.signups}</td><td className="py-2 pr-3 tabular-nums">{r.waiting}</td>
              <td className="py-2 pr-3 tabular-nums font-semibold">{r.qualified}</td><td className="py-2 pr-3 tabular-nums">{r.rejected}</td>
              <td className="py-2 pr-3 tabular-nums">{r.granted}{r.pending ? <span style={{ color: T.warning }}> +{r.pending} pending</span> : ''}</td>
              <td className="py-2">{fmtDate(r.last, true)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </Card>
  );
}

function PeopleTab({ data, act }) {
  if (!data.people.length) return <Banner tone="warning">Nobody has signed up through a referral link yet.</Banner>;
  return (
    <Card title={`${data.people.length} people who signed up with a link`} sub="A referral counts when the person’s first listing is live (photos passed, not a held duplicate) and they are not the same person as the referrer.">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead><tr className="text-left" style={{ color: T.textMuted }}><Th>New member</Th><Th>Referred by</Th><Th>Signed up</Th><Th>Status</Th><Th>Listing</Th><Th /></tr></thead>
          <tbody>{data.people.map((p) => (
            <tr key={p.id} className="border-t align-top" style={{ borderColor: T.borderLight }} data-testid="person-row">
              <td className="py-2 pr-3"><Person p={p.referred} /></td>
              <td className="py-2 pr-3"><Person p={p.referrer} /></td>
              <td className="py-2 pr-3">{fmtDate(p.joinedAt, true)}<span className="block text-[11.5px]" style={{ color: T.textMuted }}>{p.method || ''}{p.clickedAt ? ` · clicked ${fmtDate(p.clickedAt)}` : ''}</span></td>
              <td className="py-2 pr-3">
                <Pill tone={TONE[p.state]}>{STATE_LABEL[p.state] || p.state}</Pill>
                {p.state === 'signed_up' && p.hold && <span className="block text-[11.5px] mt-1" style={{ color: T.textSecondary }}>{HOLD_LABEL[p.hold] || p.hold}</span>}
                {p.state === 'rejected' && <span className="block text-[11.5px] mt-1" style={{ color: T.danger }}>{REASON_LABEL[p.reason] || p.reason}{p.matched?.length ? ` (${p.matched.join(', ')})` : ''}</span>}
                {p.override && <span className="block text-[11.5px] mt-1" style={{ color: T.textSecondary }}>approved by an admin</span>}
              </td>
              <td className="py-2 pr-3">{p.listingId ? <a className="underline underline-offset-2" href={`/properties?q=${encodeURIComponent(p.listingId)}`}>{String(p.listingId).slice(0, 8)}</a> : '—'}</td>
              <td className="py-2 text-right whitespace-nowrap">
                {p.state === 'rejected' && <button className={btnSecondary} style={{ borderColor: T.borderLight }} onClick={() => act({ action: 'approve', personId: p.id }, 'Approve this referral anyway?', 'It counts at the website’s next run (within the hour), and both rewards are given.')}>Approve anyway</button>}
                {p.state === 'signed_up' && <button className={btnSecondary} style={{ borderColor: T.borderLight, color: T.danger }} onClick={() => act({ action: 'reject', personId: p.id }, 'Reject this referral?', 'It will never count, even if they publish.', 'danger')}>Reject</button>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </Card>
  );
}

function RewardsTab({ data, act, reload }) {
  const [g, setG] = useState({ email: '', plan: 'verified', days: 30, propertyId: '' });
  const [msg, setMsg] = useState(null);
  async function grant() {
    setMsg(null);
    const r = await fetch('/api/referrals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'grant', ...g, days: Number(g.days) }) }).then((x) => x.json()).catch(() => ({ error: 'network' }));
    const why = { user_not_found: 'No account with that email in this country.', no_live_listing: 'That person has no live listing.', listing_not_live: 'That listing is not live.', grant_failed: 'The listing could not be updated.', bad_days: 'Days must be 1 to 365.' };
    setMsg(r.error ? { tone: 'error', text: why[r.error] || r.error } : { tone: 'ok', text: `Granted until ${fmtDate(r.until)}.` });
    if (!r.error) reload();
  }
  return (
    <div className="space-y-5">
      <Card title="Grant a reward by hand" sub="Goes on the person’s newest live listing without a promotion (or a listing id you give). Works like any reward: badge, home page, reminders, end date.">
        <div className="grid md:grid-cols-5 gap-3 items-end">
          <Field label="Account email"><input className={inputCls} value={g.email} onChange={(e) => setG({ ...g, email: e.target.value })} placeholder="name@example.com" /></Field>
          <Field label="Plan"><select className={inputCls} value={g.plan} onChange={(e) => setG({ ...g, plan: e.target.value })}><option value="verified">Verified</option><option value="home">Verified + home page</option></select></Field>
          <Field label="Days"><input className={inputCls} type="number" min="1" max="365" value={g.days} onChange={(e) => setG({ ...g, days: e.target.value })} /></Field>
          <Field label="Listing id (optional)"><input className={inputCls} value={g.propertyId} onChange={(e) => setG({ ...g, propertyId: e.target.value })} /></Field>
          <button className={btnPrimary} disabled={!g.email} onClick={grant}>Grant</button>
        </div>
        {msg && <p className="text-[13px] mt-2" style={{ color: msg.tone === 'ok' ? T.success : T.danger }}>{msg.text}</p>}
      </Card>
      <Card title={`${data.rewards.length} rewards`}>
        {!data.rewards.length ? <p className="text-[13px]" style={{ color: T.textMuted }}>No rewards yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr className="text-left" style={{ color: T.textMuted }}><Th>Person</Th><Th>Reward</Th><Th>Listing</Th><Th>Status</Th><Th>Ends</Th><Th>Emails</Th><Th /></tr></thead>
              <tbody>{data.rewards.map((r) => (
                <tr key={r.id} className="border-t align-top" style={{ borderColor: T.borderLight }} data-testid="reward-row">
                  <td className="py-2 pr-3"><Person p={r.user} /></td>
                  <td className="py-2 pr-3"><span className="font-medium" style={{ color: T.textPrimary }}>{TYPE_LABEL[r.type] || r.type}</span><span className="block text-[11.5px]" style={{ color: T.textMuted }}>{PLAN_LABEL[r.plan] || r.plan} · {r.days} days{r.referredName ? ` · for ${r.referredName}` : ''}</span></td>
                  <td className="py-2 pr-3">{r.listing ? <a className="underline underline-offset-2" href={`/properties?q=${encodeURIComponent(r.listing.id)}`}>{r.listing.title || String(r.listing.id).slice(0, 8)}</a> : '—'}</td>
                  <td className="py-2 pr-3"><Pill tone={TONE[r.state]}>{STATE_LABEL[r.state] || r.state}</Pill>{r.state === 'pending' && r.wait && <span className="block text-[11.5px] mt-1" style={{ color: T.textSecondary }}>{r.wait === 'no_live_listing' ? 'waiting for a live listing' : 'their listing is not live'}</span>}{r.lastError && <span className="block text-[11.5px] mt-1" style={{ color: T.danger }}>{r.lastError}</span>}</td>
                  <td className="py-2 pr-3">{r.until ? fmtDate(r.until) : '—'}</td>
                  <td className="py-2 pr-3 text-[12px]" style={{ color: T.textSecondary }}>{r.emailed === true ? 'reward email sent' : r.type === 'manual' ? '—' : 'not yet'}{r.reminded?.length ? ` · reminders: ${r.reminded.join(', ')} d` : ''}</td>
                  <td className="py-2 text-right">{['pending', 'granted'].includes(r.state) && <button className={btnSecondary} style={{ borderColor: T.borderLight, color: T.danger }} onClick={() => act({ action: 'revoke', id: r.id }, 'Revoke this reward?', r.state === 'granted' ? `Its ${r.days} days are taken off the listing now.` : 'It will not be given.', 'danger')}>Revoke</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export default function ReferralsPage() {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('program');
  const [err, setErr] = useState(null);
  const { dialog, confirm } = useDialog();
  const reload = useCallback(() => fetch('/api/referrals', { cache: 'no-store' }).then((r) => r.json()).then((d) => { if (d.error) setErr(d.error); else setData(d); }).catch((e) => setErr(String(e))), []);
  useEffect(() => {
    try { const t = new URLSearchParams(window.location.search).get('tab'); if (TABS.some(([k]) => k === t)) setTab(t); } catch {}
    reload();
  }, [reload]);
  const go = (k) => { setTab(k); try { const u = new URL(window.location.href); u.searchParams.set('tab', k); window.history.replaceState(null, '', u); } catch {} };
  async function act(body, title, message, tone) {
    if (!(await confirm({ title, message, confirmLabel: 'Yes', tone }))) return;
    const r = await fetch('/api/referrals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => ({ error: 'network' }));
    if (r.error) setErr(r.error); else { setErr(null); reload(); }
  }
  const t = data?.totals;
  const countryName = useMemo(() => ({ py: 'Paraguay', bo: 'Bolivia', uy: 'Uruguay', ve: 'Venezuela', sv: 'El Salvador' }[data?.country] || 'Paraguay'), [data?.country]);

  return (
    <div className="space-y-5">
      {dialog}
      <PageHeader title="Referrals" sub="Verified users invite others. Each person who signs up with a link and publishes a live listing earns both of them free promotion days." />
      {err && <Banner>{err === 'migration_pending' ? 'This country’s database is missing the automations tables (migration 005).' : `Error: ${err}`}</Banner>}
      {!data ? <div className="text-[13px]" style={{ color: T.textMuted }}>Loading…</div> : data.pending ? <Banner tone="warning">This country’s database is not set up for automations yet (migration 005).</Banner> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <Stat label="Links" value={t.links} />
            <Stat label="Clicks" value={t.clicks} hint="one per visitor per day" />
            <Stat label="Signed up" value={t.signups} hint={`${t.waiting} waiting for a listing`} />
            <Stat label="Qualified" value={t.qualified} hint={t.rejected ? `${t.rejected} not counted` : null} />
            <Stat label="Rewards given" value={t.rewardsGranted} hint={`${t.rewardsActive} active now`} />
            <Stat label="Rewards pending" value={t.rewardsPending} />
          </div>
          <div className="flex gap-1 border-b" style={{ borderColor: T.borderLight }}>
            {TABS.map(([k, label]) => (
              <button key={k} onClick={() => go(k)} className="px-3.5 py-2 text-[13.5px] font-medium -mb-px border-b-2" style={{ borderColor: tab === k ? T.primary : 'transparent', color: tab === k ? T.textPrimary : T.textSecondary }}>{label}</button>
            ))}
          </div>
          {tab === 'program' && <ProgramTab key={data.settings.enabled ? 'on' : 'off'} data={{ ...data, countryName }} reload={reload} />}
          {tab === 'invite' && <InviteTab data={data} reload={reload} confirm={confirm} />}
          {tab === 'referrers' && <ReferrersTab data={data} />}
          {tab === 'people' && <PeopleTab data={data} act={act} />}
          {tab === 'rewards' && <RewardsTab data={data} act={act} reload={reload} />}
        </>
      )}
    </div>
  );
}
