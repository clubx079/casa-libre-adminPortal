'use client';
// "Share nudges" and "Share reward" cards on the Automations page (their own API:
// /api/automations/share, lib/shareAdmin.js). The website's hourly cron sends the nudge emails and
// grants the reward; the share sheet itself is on the website and in the app. Numbers on the
// Listing shares page (/shares).
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { T, Banner } from '@/components/automations/ui';
import { StepCard, Connector, DayField, DraftSteps, TemplatePicker, AutomationCard } from '@/components/automations/parts';
import { useDialog } from '@/components/Dialog';
import { REWARD_TYPES, SHARE_STEPS, shareStepFromHours, shareStepToHours, shareStepLabel, shareRewardText } from '@/lib/shareAdmin';

const sel = 'px-2.5 py-1.5 rounded-[10px] border text-[13px] font-medium outline-none focus:border-ink/60';
const selStyle = { borderColor: 'rgba(17,17,17,.2)', color: T.textPrimary, background: T.bgWhite };

const nudgeForm = (s) => ({
  steps: s.steps.map(shareStepFromHours), templateId: s.templateId || '', lowViewsTemplateId: s.lowViewsTemplateId || '',
  lowOn: s.lowViews.enabled, threshold: s.lowViews.threshold, lowAfter: shareStepFromHours(s.lowViews.afterHours),
});
const nudgePatch = (f) => ({
  steps: f.steps.map(shareStepToHours), templateId: f.templateId, lowViewsTemplateId: f.lowViewsTemplateId,
  lowViews: { enabled: !!f.lowOn, threshold: f.threshold, afterHours: shareStepToHours(f.lowAfter) },
});
const rewardForm = (s) => ({ visits: s.visits, reward: s.reward, days: s.days, templateId: s.templateId || '' });

export default function ShareCards() {
  const [data, setData] = useState(null);
  const [nform, setNform] = useState(null);
  const [rform, setRform] = useState(null);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({ nudge: {}, reward: {} });
  const [notice, setNotice] = useState({ nudge: '', reward: '' });
  const [busy, setBusy] = useState({});
  const { dialog, confirm } = useDialog();

  const apply = (j) => {
    setData(j);
    setNform(nudgeForm(j.nudge.settings));
    setRform(rewardForm(j.reward.settings));
  };
  useEffect(() => {
    fetch('/api/automations/share', { cache: 'no-store' }).then((r) => r.json())
      .then((j) => (j.error || j.pending ? setError(j.pending ? 'Automations are not set up for this country yet.' : j.error) : apply(j)))
      .catch((e) => setError(String(e.message || e)));
  }, []);

  async function save(which, patch, ok) {
    setErrors((e) => ({ ...e, [which]: {} })); setNotice((n) => ({ ...n, [which]: '' }));
    const id = which === 'nudge' ? 'share_nudge' : 'share_reward';
    const res = await fetch('/api/automations/share', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...patch }) });
    const j = await res.json().catch(() => ({}));
    if (res.status === 400 && j.errors) {
      setErrors((e) => ({ ...e, [which]: j.errors }));
      setNotice((n) => ({ ...n, [which]: j.errors.enabled || 'Fix the highlighted fields.' }));
      return false;
    }
    if (!res.ok) { setNotice((n) => ({ ...n, [which]: j.message || j.error || `HTTP ${res.status}` })); return false; }
    apply(j);
    setNotice((n) => ({ ...n, [which]: ok }));
    return true;
  }
  const run = async (which, kind, fn) => { setBusy((b) => ({ ...b, [which]: kind })); try { await fn(); } finally { setBusy((b) => ({ ...b, [which]: '' })); } };
  const ask = (title, message, on) => confirm({ title, message, confirmLabel: on ? 'Switch on' : 'Switch off', tone: on ? undefined : 'danger' });

  if (error && !data) return <Banner>Share automations: {error}</Banner>;
  if (!data || !nform || !rform) return null;

  const n = data.nudge.settings;
  const r = data.reward.settings;
  const e1 = errors.nudge;
  const e2 = errors.reward;
  const nDirty = JSON.stringify(nform) !== JSON.stringify(nudgeForm(n));
  const rDirty = JSON.stringify(rform) !== JSON.stringify(rewardForm(r));
  const stepHours = nform.steps.map(shareStepToHours).filter((h) => Number.isFinite(h));

  const toggleNudge = () => run('nudge', 'toggle', async () => {
    const on = !n.enabled;
    const when = stepHours.map(shareStepLabel).join(', ');
    const go = await ask(on ? 'Switch the share nudges on?' : 'Switch the share nudges off?', on
      ? `Owners of listings that go live from now on get an email asking them to share it: ${when || '—'}.${nform.lowOn ? ` A listing with fewer than ${nform.threshold} views ${shareStepToHours(nform.lowAfter)} hours after going live also gets the low-views email (once).` : ''} Each email once per listing, daytime only.`
      : 'No more share emails go out until you switch it on again.', on);
    if (!go) return;
    await save('nudge', nDirty || !n.setUp ? { ...nudgePatch(nform), enabled: on } : { enabled: on }, on ? 'Share nudges are on.' : 'Share nudges are off.');
  });
  const toggleReward = () => run('reward', 'toggle', async () => {
    const on = !r.enabled;
    const text = shareRewardText({ ...r, ...rform, visits: Number(rform.visits), days: Number(rform.days) });
    const go = await ask(on ? 'Switch the share reward on?' : 'Switch the share reward off?', on
      ? `${text}. The website grants it with the referral program's reward (same badge / home-page spot) and sends the "you earned it" email.`
      : 'No more rewards are granted. Rewards already granted keep running until they end.', on);
    if (!go) return;
    await save('reward', rDirty || !r.setUp ? { ...rform, enabled: on } : { enabled: on }, on ? 'Share reward is on.' : 'Share reward is off.');
  });

  const nStats = `${data.nudge.published} "share your listing" and ${data.nudge.lowViews} low-views emails sent so far`;
  return (
    <div id="share" className="space-y-6 scroll-mt-6">
      {dialog}
      <AutomationCard
        title="Share nudges"
        description={<>A listing just went live: ask its owner to share it on WhatsApp, Instagram or Facebook (one tap from the share sheet on the website and in the app). Listings with few views get one more nudge. See what sharing brings on <Link href="/shares" className="underline">Listing shares</Link>.</>}
        enabled={n.enabled} enabledAt={n.enabledAt} busy={busy.nudge}
        onToggle={toggleNudge} dirty={nDirty || !n.setUp}
        onSave={() => run('nudge', 'save', () => save('nudge', nudgePatch(nform), n.setUp ? 'Changes saved.' : 'Saved — the two emails were created (Templates).'))}
        footnote={`${notice.nudge ? `${notice.nudge} ` : ''}Only listings that go live after it is switched on. Each email once per listing; daytime only.${n.setUp ? ` ${nStats}.` : ' Not set up for this country yet: saving creates it (off) and its two emails.'}`}
      >
        <StepCard n={1} kind="Trigger" title="An owner's listing goes live" />
        <Connector />
        <StepCard n={2} kind="Emails" title="Ask them to share it, after it went live">
          <DraftSteps steps={nform.steps} errors={e1} label="Email" min={1} max={SHARE_STEPS.max}
            onChange={(list) => setNform((f) => ({ ...f, steps: list }))}
            note={`Counted from when the listing went live (e.g. 1 day and 7 days). Up to ${SHARE_STEPS.max} emails, each once per listing.`} />
          <TemplatePicker label="Share email" value={nform.templateId} templates={data.templates} onChange={(v) => setNform((f) => ({ ...f, templateId: v }))} error={e1.templateId} />
        </StepCard>
        <Connector />
        <StepCard n={3} kind="Low views" title="Few views? One more nudge">
          <label className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: T.textBody }}>
            <input type="checkbox" checked={!!nform.lowOn} onChange={(ev) => setNform((f) => ({ ...f, lowOn: ev.target.checked }))} />
            Send the low-views email
          </label>
          <div style={{ opacity: nform.lowOn ? 1 : 0.55 }} className="space-y-3">
            <DayField value={nform.threshold} onChange={(v) => setNform((f) => ({ ...f, threshold: v }))} min={1} max={10000} error={e1.lowViewsThreshold} suffix="views or fewer…" />
            <div className="flex flex-wrap items-center gap-2">
              <input type="number" min={1} max={nform.lowAfter.unit === 'days' ? 60 : 1440} value={nform.lowAfter.value} aria-label="Low views: wait"
                onChange={(ev) => setNform((f) => ({ ...f, lowAfter: { ...f.lowAfter, value: ev.target.value === '' ? '' : Number(ev.target.value) } }))}
                className="w-[64px] px-2 py-1.5 rounded-[10px] border text-[15px] font-bold text-center outline-none focus:border-ink/60 tabular-nums"
                style={{ borderColor: e1.lowViewsAfterHours ? T.danger : 'rgba(17,17,17,.2)', color: T.textPrimary }} />
              <select value={nform.lowAfter.unit} onChange={(ev) => setNform((f) => ({ ...f, lowAfter: { ...f.lowAfter, unit: ev.target.value } }))} aria-label="Low views: hours or days" className={sel} style={selStyle}>
                <option value="hours">hours</option>
                <option value="days">days</option>
              </select>
              <span className="text-[13px]" style={{ color: T.textSecondary }}>after it went live</span>
            </div>
            {e1.lowViewsAfterHours ? <p className="text-[11px]" style={{ color: T.danger }}>{e1.lowViewsAfterHours}</p> : null}
            <p className="text-[11px] leading-snug" style={{ color: T.textMuted }}>Fewer views than this at that moment → one email, once per listing. Views = the listing&apos;s view count (website + app).</p>
            <TemplatePicker label="Low-views email" value={nform.lowViewsTemplateId} templates={data.templates} onChange={(v) => setNform((f) => ({ ...f, lowViewsTemplateId: v }))} error={e1.lowViewsTemplateId} />
          </div>
        </StepCard>
      </AutomationCard>

      <AutomationCard
        title="Share reward"
        description="Owners who bring visitors to their listing through their own share links earn a reward: the Verified badge, or a home-page spot, for a few days — once per listing. Granted with the referral program's rewards."
        enabled={r.enabled} enabledAt={r.enabledAt} busy={busy.reward}
        onToggle={toggleReward} dirty={rDirty || !r.setUp}
        onSave={() => run('reward', 'save', () => save('reward', rform, r.setUp ? 'Changes saved.' : 'Saved (off) — the "you earned it" email was created (Templates).'))}
        footnote={`${notice.reward ? `${notice.reward} ` : ''}Visits = people opening the listing through the owner's share links (website /l/<code> redirect).${r.setUp ? ` ${data.reward.granted} granted so far, ${data.reward.grantedWeek} in the last 7 days.` : ' Not set up for this country yet: saving creates it, switched off.'}`}
      >
        <StepCard n={1} kind="Trigger" title="Visitors arrive through the owner's share links">
          <DayField value={rform.visits} onChange={(v) => setRform((f) => ({ ...f, visits: v }))} min={1} max={100000} error={e2.visits} suffix="visits needed" />
          <p className="text-[11px] leading-snug" style={{ color: T.textMuted }}>Counted per listing, from the share link clicks (/l/&lt;code&gt;).</p>
        </StepCard>
        <Connector />
        <StepCard n={2} kind="Reward" title="What they earn">
          <select value={rform.reward} onChange={(ev) => setRform((f) => ({ ...f, reward: ev.target.value }))} aria-label="Reward type" className={`${sel} w-full`} style={selStyle}>
            {REWARD_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          {e2.reward ? <p className="text-[11px]" style={{ color: T.danger }}>{e2.reward}</p> : null}
          <DayField value={rform.days} onChange={(v) => setRform((f) => ({ ...f, days: v }))} min={1} max={365} error={e2.days} suffix="days" />
          <p className="text-[11px] leading-snug" style={{ color: T.textMuted }}>Once per listing, granted the same way as a referral reward.</p>
        </StepCard>
        <Connector />
        <StepCard n={3} kind="Email" title="Tell them they earned it">
          <TemplatePicker label={'"You earned it" email'} value={rform.templateId} templates={data.templates} onChange={(v) => setRform((f) => ({ ...f, templateId: v }))} error={e2.templateId} />
        </StepCard>
      </AutomationCard>
    </div>
  );
}
