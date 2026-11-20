// The admin's section card: same border, radius, header bar and link style on every page that
// uses it (Overview, Email campaigns). Server- and client-safe (no hooks).
import Link from 'next/link';

export function Card({ title, sub, aside, children, className = '', id }) {
  return (
    <section id={id} className={`bg-white rounded-[16px] border border-ink/12 flex flex-col overflow-hidden ${className}`}>
      <div className="px-5 min-h-[54px] py-2.5 shrink-0 border-b border-ink/10 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold text-ink truncate">{title}</h2>
          {sub ? <p className="text-[12px] text-ink/50 mt-0.5">{sub}</p> : null}
        </div>
        {aside}
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </section>
  );
}

export const CardLink = ({ href, children }) => (
  <Link href={href} className="shrink-0 text-[12.5px] font-medium text-ink/60 underline decoration-ink/20 underline-offset-2 hover:text-ink hover:decoration-ink">{children}</Link>
);
export const CardNote = ({ children }) => <span className="hidden sm:inline text-[12px] text-ink/45 truncate">{children}</span>;

const UP = '#2F6B3A';
const DOWN = '#B23A3A';
// "+12%" / "−8%" against the week before (or "new"); nothing when there is nothing to compare.
export function WeekChange({ now, before, invert = false, unit = '%' }) {
  if (now == null || before == null) return null;
  if (!before) return now ? <span className="text-[11.5px] font-semibold" style={{ color: UP }}>new</span> : null;
  const pct = Math.round(((now - before) / before) * 100);
  if (!pct) return <span className="text-[11.5px] text-ink/40">same</span>;
  const good = invert ? pct < 0 : pct > 0;
  return <span className="text-[11.5px] font-semibold whitespace-nowrap" style={{ color: good ? UP : DOWN }}>{pct > 0 ? '+' : '−'}{Math.abs(pct)}{unit}</span>;
}
// a rate (in points) against the week before: "+3.2 pts"
export function RateChange({ now, before }) {
  if (now == null || before == null) return null;
  const d = Math.round((now - before) * 10) / 10;
  if (!d) return <span className="text-[11.5px] text-ink/40">same</span>;
  return <span className="text-[11.5px] font-semibold whitespace-nowrap" style={{ color: d > 0 ? UP : DOWN }}>{d > 0 ? '+' : '−'}{Math.abs(d)} pts</span>;
}
