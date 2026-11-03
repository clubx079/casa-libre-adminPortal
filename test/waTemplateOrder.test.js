import { describe, it, expect } from 'vitest';
import { newestFirst, setOf } from '../lib/waTemplateOrder.js';

const at = (ms) => `2026-11-02T19:54:${String(Math.floor(ms / 1000)).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}Z`;
// the real sync of 2026-11-02 (Meta lists newest first; the video was stamped 5 s late)
const SYNC = [
  ['casa_libre_otp', 888], ['cl_borrador', 818], ['cl_porfin_gif_estadisticas', 609], ['cl_porfin_gif_mascota', 617],
  ['cl_porfin_texto', 624], ['cl_porfin_video', 5934], ['cl_publica_gif_v2', 642], ['cl_publica_imagen_v2', 632],
  ['cl_publica_texto', 709], ['portal_launch_promo', 873],
].map(([name, ms]) => ({ name, updated_at: at(ms) }));

describe('newestFirst', () => {
  it('newest set on top, its late-stamped video kept with it, the oldest last', () => {
    const names = newestFirst(SYNC).map((x) => x.name);
    expect(names.slice(0, 4)).toEqual(['cl_porfin_gif_estadisticas', 'cl_porfin_gif_mascota', 'cl_porfin_texto', 'cl_porfin_video']);
    expect(names.slice(4, 7)).toEqual(['cl_publica_imagen_v2', 'cl_publica_gif_v2', 'cl_publica_texto']);
    expect(names.at(-1)).toBe('casa_libre_otp');
  });
  it('a real creation date wins when Relay sends one', () => {
    const l = [{ name: 'a_x', created_at: '2026-10-01' }, { name: 'b_y', created_at: '2026-11-01' }];
    expect(newestFirst(l).map((x) => x.name)).toEqual(['b_y', 'a_x']);
  });
  it('setOf', () => { expect(setOf('cl_porfin_gif_mascota')).toBe('cl_porfin'); });
});
