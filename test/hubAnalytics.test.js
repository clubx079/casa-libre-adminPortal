import { describe, it, expect } from 'vitest';
import {
  hubWhere, normHubDays, HUB_EVENTS, summarySql, summaryFromRow, dailyFromRows, countryOfHref, HREF_COUNTRY_EXPR,
  sendsSql, pagesSql, articlesSql, sendsFromRows, articlesFromRows,
} from '../lib/hubAnalytics.js';
import { IS_HUB } from '../lib/analyticsSite.js';

describe('hub analytics', () => {
  it('scopes to hub events only, with a whitelisted window', () => {
    const w = hubWhere({ days: 28 });
    expect(w).toContain('INTERVAL 28 DAY');
    expect(w).toContain(IS_HUB);
    expect(w).toContain('Pakistan');
    for (const e of HUB_EVENTS) expect(w).toContain(`'${e}'`);
    expect(hubWhere({ days: '1; DROP' })).toContain('INTERVAL 7 DAY');
    expect(normHubDays(30)).toBe(30);
    expect(normHubDays(90)).toBe(90);
    expect(normHubDays(5)).toBe(7);
  });

  it('summary row → totals, with pages per visitor', () => {
    expect(summarySql('1')).toContain("countIf(event = 'call_confirmed')");
    const t = summaryFromRow([10, 25, 6, 4, 3, 5, 2, 1, 3, 2, 1, 1, 0, 1, 2]);
    expect(t).toMatchObject({ visitors: 10, pageviews: 25, pagesPerVisitor: 2.5, articleViews: 6, countryClicks: 4, clClicks: 5, formStarts: 3, formSubmits: 1, callsConfirmed: 1, langSwitches: 2 });
    expect(summaryFromRow(undefined)).toMatchObject({ visitors: 0, pagesPerVisitor: 0 });
  });

  it('daily series fills every day', () => {
    const d = dailyFromRows([['2026-11-14', 3, 5, 1, 2]], 7, '2026-11-15');
    expect(d).toHaveLength(7);
    expect(d[0].date).toBe('2026-11-09');
    expect(d[5]).toEqual({ date: '2026-11-14', visitors: 3, pageviews: 5, articleViews: 1, sends: 2 });
    expect(d[6].visitors).toBe(0);
  });

  it('link → country site', () => {
    expect(countryOfHref('https://casa-libre.com.py/propiedades?utm_source=hub')).toBe('py');
    expect(countryOfHref('https://casa-libre.com.bo/')).toBe('bo');
    expect(countryOfHref('https://uy.casa-libre.com/x')).toBe('uy');
    expect(countryOfHref('https://sv.casa-libre.com')).toBe('sv');
    expect(countryOfHref('https://casa-libre.com.ve/a')).toBe('ve');
    expect(countryOfHref('https://casa-libre.com/blog')).toBe('other');
    expect(HREF_COUNTRY_EXPR).toContain(String.raw`casa-libre\\.com\\.py`);
  });

  it('queries are limited to their events', () => {
    expect(sendsSql('W')).toContain("event IN ('hub_country_click', 'cl_click')");
    expect(pagesSql('W')).toContain("event = '$pageview'");
    expect(articlesSql('W')).toContain("event = 'blog_article_view'");
    expect(sendsFromRows([['py', 3, 2, 4]])).toEqual([{ country: 'py', countryClicks: 3, clClicks: 2, people: 4 }]);
    expect(articlesFromRows([['guia', 'py', 'vender', 9, 7]])[0]).toMatchObject({ slug: 'guia', country: 'py', views: 9, visitors: 7 });
  });
});
