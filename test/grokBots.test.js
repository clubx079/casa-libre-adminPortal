import { describe, it, expect } from 'vitest';
import { BOTS, COMMON_FIELDS, mergeBotSettings, validateBotSettings, scheduleLabel, botByKey } from '../lib/grokBots.js';

describe('grok bots registry', () => {
  it('has the six bots, each with defaults for every field', () => {
    expect(BOTS.map((b) => b.key)).toEqual(['lead-finder', 'visibility', 'competitor-watch', 'analyst-x', 'news-feed', 'football']);
    for (const b of BOTS) {
      for (const f of [...COMMON_FIELDS, ...b.fields]) expect(b.defaults, `${b.key}.${f.key}`).toHaveProperty(f.key);
      expect(validateBotSettings(b, b.defaults)).toEqual({});
      expect(b.defaults.enabled).toBe(false);
    }
  });
  it('merges stored settings safely', () => {
    const b = botByKey('lead-finder');
    const s = mergeBotSettings(b, { maxPerRun: 80, countries: ['bo'], requirePhone: 'yes', junk: 1 });
    expect(s.maxPerRun).toBe(80);
    expect(s.countries).toEqual(['bo']);
    expect(s.requirePhone).toBe(true);
    expect(s).not.toHaveProperty('junk');
    expect(mergeBotSettings(b, null)).toEqual(b.defaults);
  });
  it('validates numbers, lists and time', () => {
    const b = botByKey('visibility');
    const e = validateBotSettings(b, { ...b.defaults, monthlyCap: -1, assistants: [], questions: ' ', time: '25:00' });
    expect(Object.keys(e).sort()).toEqual(['assistants', 'monthlyCap', 'questions', 'time']);
  });
  it('labels the schedule', () => {
    expect(scheduleLabel({ frequency: 'weekly', day: 'monday', time: '08:00' })).toBe('Every Monday at 08:00');
    expect(scheduleLabel({ frequency: 'daily', time: '05:00' })).toBe('Every day at 05:00');
  });
});
