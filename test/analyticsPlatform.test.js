import { describe, it, expect } from 'vitest';
import {
  APP_LIB, IS_APP, isAppEvent, normPlatform, platformClause, APP_UKEY, ukeyFor, pageviewEvent,
  geoEventsClause, funnelSteps, summarySql, summaryFromRow,
} from '../lib/analyticsPlatform.js';
import { UKEY, CONTACT_IN } from '../lib/posthogSql.js';

describe('website vs app events', () => {
  it('an app event = the React Native SDK, platform mobile, or the app_opened ping', () => {
    expect(APP_LIB).toBe('posthog-react-native');
    expect(isAppEvent('property_viewed', { $lib: 'posthog-react-native' })).toBe(true);
    expect(isAppEvent('$screen', { platform: 'mobile' })).toBe(true);
    expect(isAppEvent('app_opened', { platform: 'android' })).toBe(true);
    expect(isAppEvent('property_viewed', { $lib: 'web' })).toBe(false);
    expect(isAppEvent('$pageview', {})).toBe(false);
    // the website's server-side events (no $lib) stay website
    expect(isAppEvent('account_created', {})).toBe(false);
    expect(isAppEvent('link_click', {})).toBe(false);
  });

  it('the HogQL rule says the same thing', () => {
    expect(IS_APP).toContain("properties.$lib, '') = 'posthog-react-native'");
    expect(IS_APP).toContain("properties.platform, '') = 'mobile'");
    expect(IS_APP).toContain("event = 'app_opened'");
  });

  it('platform names: web by default, mobile = app, garbage = fallback', () => {
    expect(normPlatform(undefined)).toBe('web');
    expect(normPlatform('APP')).toBe('app');
    expect(normPlatform('mobile')).toBe('app');
    expect(normPlatform('all')).toBe('all');
    expect(normPlatform("app' OR 1=1")).toBe('web');
    expect(normPlatform(null, 'all')).toBe('all');
  });

  it('the filter: website excludes app events, app keeps only them, all adds nothing', () => {
    expect(platformClause('web')).toBe(` AND NOT ${IS_APP}`);
    expect(platformClause()).toBe(` AND NOT ${IS_APP}`);
    expect(platformClause('app')).toBe(` AND ${IS_APP}`);
    expect(platformClause('all')).toBe('');
  });

  it('visitor key: website keeps the IP rule, the app counts a signed-out phone by its own id', () => {
    expect(ukeyFor('web')).toBe(UKEY);
    expect(ukeyFor('all')).toBe(UKEY);
    expect(ukeyFor('app')).toBe(APP_UKEY);
    expect(APP_UKEY).toContain('distinct_id');
    expect(APP_UKEY).not.toContain('$ip');
  });

  it('page views are $pageview on the website and $screen in the app', () => {
    expect(pageviewEvent('web')).toBe('$pageview');
    expect(pageviewEvent('app')).toBe('$screen');
  });

  it('geo cuts of the app leave out app_opened (it carries the server location)', () => {
    expect(geoEventsClause('app')).toBe(" AND event != 'app_opened'");
    expect(geoEventsClause('web')).toBe('');
  });
});

describe('summary + funnel', () => {
  it('the website funnel is unchanged', () => {
    expect(funnelSteps('web').map(([s]) => s)).toEqual([
      'Visited the site', 'Searched', 'Viewed a property', 'Saved a property', 'Contacted a seller', 'Listed a property', 'Clicked an app button',
    ]);
    expect(funnelSteps('web')[4][1]).toBe(CONTACT_IN);
  });

  it('the app funnel uses the same event names as the website', () => {
    const steps = funnelSteps('app');
    expect(steps.map(([s]) => s)).toEqual([
      'Opened the app', 'Searched', 'Viewed a property', 'Saved a property', 'Contacted a seller', 'Signed in', 'Tapped Publish',
    ]);
    expect(steps[2][1]).toBe("event = 'property_viewed'");
    expect(steps[4][1]).toBe(CONTACT_IN);
  });

  it('website SQL: the same columns the route used to send (pageviews, users, today, funnel)', () => {
    const sql = summarySql({ days: 7, where: 'X', platform: 'web' });
    expect(sql).toContain("countIf(event = '$pageview')");
    expect(sql).toContain(`uniqExact(${UKEY})`);
    expect(sql).toContain(`uniqExactIf(${UKEY}, event = 'search_applied')`);
    expect(sql).toContain(`uniqExactIf(${UKEY}, event = 'app_badge_clicked')`);
    expect(sql).toContain('INTERVAL 7 DAY AND X');
    expect(sql).not.toContain('$screen');
  });

  it('app SQL: $screen + the app key', () => {
    const sql = summarySql({ days: 30, where: 'Y', platform: 'app' });
    expect(sql).toContain("countIf(event = '$screen')");
    expect(sql).toContain(`uniqExact(${APP_UKEY})`);
    expect(sql).toContain(`uniqExactIf(${APP_UKEY}, event = 'publish_tapped')`);
    expect(sql).toContain('INTERVAL 30 DAY AND Y');
  });

  it('row → totals / today / funnel (top of the funnel = unique users)', () => {
    const out = summaryFromRow([120, 40, 9, 5, 40, 20, 18, 4, 3, 1, 2], 'web');
    expect(out.totals).toEqual({ pageviews: 120, uniqueUsers: 40 });
    expect(out.today).toEqual({ pageviews: 9, uniqueUsers: 5 });
    expect(out.funnel[0]).toEqual({ step: 'Visited the site', persons: 40 });
    expect(out.funnel[6]).toEqual({ step: 'Clicked an app button', persons: 2 });
    const empty = summaryFromRow(undefined, 'app');
    expect(empty.totals).toEqual({ pageviews: 0, uniqueUsers: 0 });
    expect(empty.funnel).toHaveLength(7);
    expect(empty.funnel.every((s) => s.persons === 0)).toBe(true);
  });
});
