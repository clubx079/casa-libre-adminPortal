// Shown the moment a sidebar link is clicked, while the server builds the next page
// (Properties, Overview, Runs… read the database before they can render). Without it
// the old page just sat there until the new one was ready, which read as "frozen".
const T = { line: '#EFEAE1', border: '#E7E1D6' };
const CARD = { border: `1px solid ${T.border}`, borderRadius: '14px' };

export default function DashboardLoading() {
  return (
    <div className="space-y-5 animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <div className="h-7 w-48 rounded-md" style={{ background: T.line }} />
        <div className="h-3.5 w-72 max-w-full rounded" style={{ background: T.line }} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-white p-5 space-y-3" style={CARD}>
            <div className="h-3 w-20 rounded" style={{ background: T.line }} />
            <div className="h-8 w-16 rounded" style={{ background: T.line }} />
          </div>
        ))}
      </div>
      <div className="bg-white" style={CARD}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-3 px-5 py-3.5" style={{ borderTop: i ? `1px solid ${T.border}` : 'none' }}>
            <div className="h-8 w-8 rounded-full shrink-0" style={{ background: T.line }} />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-1/3 rounded" style={{ background: T.line }} />
              <div className="h-2.5 w-1/2 rounded" style={{ background: T.line }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
