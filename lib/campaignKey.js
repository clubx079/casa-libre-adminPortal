// Analytics → which campaign a visitor came from. Most links carry it in utm_campaign (a WhatsApp
// batch's own slug wc-…, or a UTM link's name). The instant-reply links of the Nov 2026 templates
// (after SÍ / CARTERA / PROYECTO: utm_medium=mensaje) carry the AUDIENCE (agentes_lanzamiento…) and
// the person's code (utm_term) instead — the batch they were in is found from that code.
//   CAMPAIGN_KEY  HogQL: utm_campaign, or "<utm_campaign>|<code>" for a reply-link visit
//   campaignOf    that key → { campaign, label }: the batch's name when the code belongs to a batch,
//                 else the audience campaign as it is. Pure — test/campaignKey.test.js.
// A referral-link visit (/ref/<code> → utm_source=referral, utm_content=<code>): "ref-<code>", one per
// person's link — the Analytics route names it after that person (lib/referralsData.js referralLinkNames).
export const CAMPAIGN_KEY = `if(lower(coalesce(properties.utm_source, '')) = 'referral' AND coalesce(properties.utm_content, '') != '', concat('ref-', toString(properties.utm_content)), if(lower(coalesce(properties.utm_medium, '')) = 'mensaje' AND coalesce(properties.utm_term, '') != '', concat(coalesce(properties.utm_campaign, ''), '|', toString(properties.utm_term)), coalesce(nullIf(properties.utm_campaign, ''), '')))`;

// names: Map batch slug → name · byRef: Map person code → batch name
export function campaignOf(raw, names = new Map(), byRef = new Map()) {
  const s = String(raw || '');
  const i = s.indexOf('|');
  if (i < 0) return { campaign: s, label: names.get(s) || '' };
  const campaign = s.slice(0, i);
  return { campaign, label: byRef.get(s.slice(i + 1)) || names.get(campaign) || '' };
}
