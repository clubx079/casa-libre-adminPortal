import { describe, it, expect } from 'vitest';
import { botReason } from '../lib/feedbackBot.js';

describe('feedback bots', () => {
  it("flags Google Play's pre-launch robot and random names, not people", () => {
    expect(botReason({ name: 'xalyqe', email: 'crawlerrobo@gmail.com', rating: 1 })).toMatch(/Automated tester/);
    expect(botReason({ name: 'ekkezo', message: 'naovjf' })).toMatch(/Random generated name/);
    expect(botReason({ name: 'Carmen Da Costa', email: 'carmen@gmail.com', message: 'He pagado…' })).toBeNull();
    expect(botReason({ name: 'roberto', message: 'Excelente' })).toBeNull();
    expect(botReason({ name: 'carlos' })).toBeNull();
    expect(botReason({ name: 'xalyqe', user_id: 'u1' })).toBeNull();
  });
});
