'use client';
// Leads → "Agency websites" tab: one row per agency / developer (app/api/leads/agencies).
import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Search, Download, Globe } from 'lucide-react';
import { SOURCES, waDigits } from '@/lib/potentialLeads';

const T = {
  textPrimary: '#111111', textBody: '#3A3A37', textSecondary: '#6B6862', textMuted: '#9C978C',
  borderLight: '#E7E1D6', bgSurface: '#FAF7F1',
  success: '#0F6E56', successSurface: '#E4F1E9', warning: '#8A5A12', warningSurface: '#F5EAD5',
  info: '#2A5B8A', infoSurface: '#E1ECF5', danger: '#B23A3A', dangerSurface: '#F6E4E1',
};
const CARD = { border: `1px solid ${T.borderLight}`, borderRadius: '14px' };
const Pill = ({ bg, fg, children, title }) => <span title={title} className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap" style={{ background: bg, color: fg }}>{children}</span>;

// listings on their own site → 'yes' | 'none' | 'down' | 'unchecked' | 'nosite'
export const siteState = (a) => (!a.website ? 'nosite' : !a.site ? 'unchecked' : !a.site.ok ? 'down' : (a.site.listings || 0) >= 3 ? 'yes' : 'none');
const onCL = (a) => (a.onCasaLibre?.accounts || 0) + (a.onCasaLibre?.listings || 0) > 0;

function SiteCell({ a }) {
  const s = siteState(a);
  if (s === 'yes') return <a href={a.site.page || a.website} target="_blank" rel="noreferrer"><Pill bg={T.successSurface} fg={T.success} title="Listing links found on their site">Yes · ~{a.site.listings}</Pill></a>;
  if (s === 'none') return <Pill bg={T.bgSurface} fg={T.textSecondary} title="Site works, no listing links found on the home / properties page">None found</Pill>;
  if (s === 'down') return <Pill bg={T.dangerSurface} fg={T.danger} title={`Site did not load (${a.site.status || 'no answer'})`}>Site down</Pill>;
  if (s === 'unchecked') return <span className="text-[11px]" style={{ color: T.textMuted }}>Not checked yet</span>;
  return <span className="text-[11px]" style={{ color: T.textMuted }}>—</span>;
}

function csv(list) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Agency', 'Type', 'Website', 'Network', 'Found via', 'Agents found', 'Listings on their site', 'On Casa-Libre (accounts)', 'Casa-Libre listings', 'WhatsApp', 'Phones', 'Emails', 'Location'];
  const lines = list.map((a) => [a.name, a.type, a.website || '', a.network || '', a.sources.map((s) => SOURCES[s]?.label || s).join(' / '), a.agents,
    siteState(a) === 'yes' ? a.site.listings : siteState(a), a.onCasaLibre?.accounts || 0, a.onCasaLibre?.listings || 0, a.whatsapp || '', a.phones.join(' / '), a.emails.join(' / '), a.location || ''].map(q).join(','));
  return [head.map(q).join(','), ...lines].join('\n');
}

export default function AgencySites({ onCount }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [q, setQ] = useState('');
  const [via, setVia] = useState('all');
  const [site, setSite] = useState('all');      // listings on their site: all | yes | none | down
  const [web, setWeb] = useState('all');        // website: all | own | network | nosite
  const [kind, setKind] = useState('all');      // all | agency | developer
  const [contact, setContact] = useState('all'); // all | whatsapp | email | none
  const [cl, setCl] = useState('all');
  const [sort, setSort] = useState('agents');   // agents | listings | name

  useEffect(() => {
    fetch('/api/leads/agencies', { cache: 'no-store' }).then((r) => r.json()).then((j) => { if (j.error) setError(true); else { setData(j); onCount?.(j.agencies?.length || 0); } }).catch(() => setError(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const all = data?.agencies || [];
  const sources = useMemo(() => [...new Set(all.flatMap((a) => a.sources))], [all]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const webOf = (a) => (a.website ? 'own' : a.network ? 'network' : 'nosite');
    const list = all.filter((a) => (via === 'all' || a.sources.includes(via))
      && (site === 'all' || siteState(a) === site)
      && (web === 'all' || webOf(a) === web)
      && (kind === 'all' || a.type === kind)
      && (contact === 'all' || (contact === 'whatsapp' ? !!a.whatsapp : contact === 'email' ? a.emails.length > 0 : !a.whatsapp && !a.phones.length && !a.emails.length))
      && (cl === 'all' || (cl === 'yes' ? onCL(a) : !onCL(a)))
      && (!s || [a.name, a.host, a.network, a.location, ...a.phones, ...a.emails].some((v) => String(v || '').toLowerCase().includes(s))));
    const lst = (a) => (siteState(a) === 'yes' ? a.site.listings : -1);
    return [...list].sort(sort === 'name' ? (a, b) => String(a.name).localeCompare(String(b.name))
      : sort === 'listings' ? (a, b) => lst(b) - lst(a) || b.agents - a.agents
        : (a, b) => b.agents - a.agents || b.leads - a.leads);
  }, [all, q, via, site, web, kind, contact, cl, sort]);
  const n = (f) => all.filter(f).length;

  const exportCsv = () => {
    const blob = new Blob([csv(shown)], { type: 'text/csv;charset=utf-8' });
    const el = document.createElement('a');
    el.href = URL.createObjectURL(blob); el.download = `agency-websites-${data?.country || ''}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(el.href), 1000);
  };

  const Drop = ({ label, value, set, opts }) => (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider pl-1" style={{ color: T.textSecondary }}>{label}</span>
      <select value={value} onChange={(e) => set(e.target.value)} className="min-w-[150px] px-3 py-2 bg-white rounded-full text-[12.5px] cursor-pointer"
        style={{ border: `1px solid ${value === 'all' ? T.borderLight : T.textPrimary}`, color: T.textPrimary, fontWeight: value === 'all' ? 400 : 600 }}>
        {opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    </label>
  );

  return (
    <div className="space-y-4" data-testid="agency-sites">
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            ['Agencies & developers', all.length],
            ['With their own website', n((a) => !!a.website)],
            ['Listings on their site', n((a) => siteState(a) === 'yes')],
            ['Already on Casa-Libre', n(onCL)],
            ['Targets: listings, not on Casa-Libre', n((a) => siteState(a) === 'yes' && !onCL(a))],
          ].map(([label, v]) => (
            <div key={label} className="bg-white px-4 py-3" style={CARD}>
              <p className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: T.textSecondary }}>{label}</p>
              <p className="text-2xl font-bold mt-0.5" style={{ color: T.textPrimary }}>{v}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-2">
        <label className="flex-1 flex items-center gap-2 px-3 py-2 bg-white rounded-full" style={{ border: `1px solid ${T.borderLight}` }}>
          <Search className="w-4 h-4" style={{ color: T.textMuted }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search agency, website, location, phone…" className="flex-1 bg-transparent outline-none text-[13px]" />
        </label>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="px-3 py-2 bg-white rounded-full text-[12.5px]" style={{ border: `1px solid ${T.borderLight}` }} aria-label="Sort">
          <option value="agents">Sort: most agents</option>
          <option value="listings">Sort: most listings on their site</option>
          <option value="name">Sort: name A–Z</option>
        </select>
      </div>
      <div className="flex flex-wrap gap-2 items-end">
        <Drop label="Found via" value={via} set={setVia} opts={[['all', 'All sources'], ...sources.map((s) => [s, s === 'grok' ? 'Grok bot' : SOURCES[s]?.label || s])]} />
        <Drop label="Type" value={kind} set={setKind} opts={[['all', 'All types'], ['agency', 'Agencies'], ['developer', 'Developers']]} />
        <Drop label="Website" value={web} set={setWeb} opts={[['all', 'Any'], ['own', 'Own website'], ['network', 'RE/MAX · C21 office'], ['nosite', 'No website']]} />
        <Drop label="Listings on their site" value={site} set={setSite} opts={[['all', 'Any'], ['yes', 'Has listings'], ['none', 'None found'], ['down', 'Site down'], ['unchecked', 'Not checked yet']]} />
        <Drop label="On Casa-Libre" value={cl} set={setCl} opts={[['all', 'Any'], ['no', 'Not on Casa-Libre'], ['yes', 'Already on Casa-Libre']]} />
        <Drop label="Contact" value={contact} set={setContact} opts={[['all', 'Any'], ['whatsapp', 'Has WhatsApp'], ['email', 'Has email'], ['none', 'No contact']]} />
        {[via, kind, web, site, cl, contact].some((v) => v !== 'all') && (
          <button onClick={() => { setVia('all'); setKind('all'); setWeb('all'); setSite('all'); setCl('all'); setContact('all'); }} className="px-3 py-2 text-[12.5px] font-medium hover:underline" style={{ color: T.textSecondary }}>Clear filters</button>
        )}
        <button onClick={exportCsv} disabled={!shown.length} className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-[12.5px] font-semibold disabled:opacity-40"
          style={{ border: `1px solid ${T.textPrimary}`, color: T.textPrimary, background: '#fff' }}>
          <Download className="w-3.5 h-3.5" />CSV ({shown.length})
        </button>
      </div>

      <div className="bg-white overflow-hidden" style={CARD}>
        <div className="cl-scroll" style={{ maxHeight: 640, overflow: 'auto' }}>
          <table className="w-full min-w-[1040px]">
            <thead className="sticky top-0 z-10" style={{ background: T.bgSurface, borderBottom: `1px solid ${T.borderLight}` }}>
              <tr>
                {['Agency', 'Website', 'Found via', 'Agents', 'Listings on their site', 'On Casa-Libre', 'Contact'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-left" style={{ color: T.textSecondary, background: T.bgSurface }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!data && !error ? (
                [...Array(6)].map((_, i) => (
                  <tr key={i} className="border-b animate-pulse" style={{ borderColor: T.borderLight }}>
                    {[...Array(7)].map((__, j) => (<td key={j} className="px-4 py-3"><div className="h-3 rounded" style={{ width: j === 0 ? '150px' : '70px', background: T.bgSurface }} /></td>))}
                  </tr>
                ))
              ) : error || data?.pending ? (
                <tr><td colSpan={7} className="px-6 py-12 text-center text-sm" style={{ color: T.textMuted }}>Couldn&apos;t load agencies. Check the DB connection.</td></tr>
              ) : shown.length === 0 ? (
                <tr><td colSpan={7} className="px-6 py-12 text-center text-sm" style={{ color: T.textSecondary }}>{all.length ? 'No agencies match these filters' : 'No agencies yet'}</td></tr>
              ) : shown.map((a) => (
                <tr key={a.key} className="border-b hover:bg-[#FAF7F1]" style={{ borderColor: T.borderLight }} data-testid="agency-row">
                  <td className="px-4 py-3 max-w-[240px]">
                    <p className="text-[13px] font-medium truncate" style={{ color: T.textPrimary }} title={a.name}>{a.name}</p>
                    <p className="text-[11px] truncate" style={{ color: T.textMuted }}>{a.type === 'developer' ? 'Developer' : 'Agency'}{a.location ? ` · ${a.location}` : ''}</p>
                  </td>
                  <td className="px-4 py-3 text-xs max-w-[220px]">
                    {a.website ? (
                      <a href={a.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline truncate" style={{ color: T.info }} title={a.website}>
                        <Globe className="w-3 h-3 shrink-0" />{a.host}<ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                    ) : a.network ? (
                      <a href={a.networkUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline" style={{ color: T.textSecondary }} title="Office page on the network's site">{a.network} office page<ExternalLink className="w-3 h-3" /></a>
                    ) : <span style={{ color: T.textMuted }}>No website found</span>}
                    {a.socials.length > 0 && (
                      <div className="flex gap-2 mt-0.5">
                        {a.socials.map((s) => <a key={s} href={s} target="_blank" rel="noreferrer" className="text-[11px] hover:underline" style={{ color: T.textSecondary }}>{/instagram/.test(s) ? 'Instagram' : /facebook|fb\.com/.test(s) ? 'Facebook' : 'Social'}</a>)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <div className="flex flex-wrap gap-1">
                      {a.sources.map((s) => (
                        <Pill key={s} bg={s === 'wasi' ? T.infoSurface : s === 'grok' ? T.warningSurface : T.bgSurface} fg={s === 'wasi' ? T.info : s === 'grok' ? T.warning : T.textBody}>
                          {s === 'grok' ? 'Grok bot' : SOURCES[s]?.label || s}
                        </Pill>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs font-mono" style={{ color: T.textBody }}>{a.agents || '—'}</td>
                  <td className="px-4 py-3 text-xs"><SiteCell a={a} /></td>
                  <td className="px-4 py-3 text-xs">
                    {onCL(a)
                      ? <Pill bg={T.infoSurface} fg={T.info} title={`Matched by ${a.onCasaLibre.via}`}>Yes{a.onCasaLibre.listings ? ` · ${a.onCasaLibre.listings} listing${a.onCasaLibre.listings === 1 ? '' : 's'}` : ' · account'}</Pill>
                      : <span style={{ color: T.textMuted }}>No</span>}
                  </td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap">
                    {a.whatsapp ? <a href={`https://wa.me/${waDigits(a.whatsapp)}`} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: T.success }}>WA {a.whatsapp}</a>
                      : a.phones[0] ? <span style={{ color: T.textBody }}>{a.phones[0]}</span> : null}
                    {a.emails[0] && <div><a href={`mailto:${a.emails[0]}`} className="hover:underline" style={{ color: T.textBody }}>{a.emails[0]}</a></div>}
                    {!a.whatsapp && !a.phones[0] && !a.emails[0] && <span style={{ color: T.textMuted }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {data && <p className="text-[11px]" style={{ color: T.textMuted }}>{data.leads} leads grouped into {all.length} agencies · {data.independent} independent agents without an agency or website are not listed here · website check: {data.checkedSites} sites checked (listing links on the home page and its properties page).</p>}
    </div>
  );
}
