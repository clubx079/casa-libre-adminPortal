'use client';
import { useRouter } from 'next/navigation';
import { LANGS, LANG_COOKIE } from '@/lib/i18n';

// The Casa Libre ES/EN pill toggle. Persists the choice in a cookie and
// refreshes so server components re-render in the new language.
export default function LangSwitcher({ lang, tone = 'light' }) {
  const router = useRouter();

  function set(l) {
    if (l === lang) return;
    document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  const border = tone === 'dark' ? 'border-paper/40' : 'border-ink/30';
  const inactive = tone === 'dark' ? 'text-paper/55' : 'text-ink/55';
  const activeCls = tone === 'dark' ? 'bg-paper text-ink' : 'bg-ink text-paper';

  return (
    <div className={`inline-flex items-center border ${border} rounded-pill p-[3px] text-[12px] font-semibold`}>
      {LANGS.map((l) => (
        <button
          key={l}
          onClick={() => set(l)}
          className={`px-3 py-1 rounded-pill cursor-pointer uppercase ${lang === l ? activeCls : inactive}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
