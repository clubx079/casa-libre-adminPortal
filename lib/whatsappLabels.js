// Readable English names for our WhatsApp templates (what each automation message is), for
// the user view's Messages list — like the email rows show "Listing published" instead of a
// key. Pure — test/whatsappLabels.test.js.
export const WA_LABEL_EN = {
  cl_destacado_inicio: 'First listing — free home display gift',
  cl_destacado_fin: 'Free home display ending',
  cl_visitas: 'Listing getting views',
  cl_borrador: 'Unfinished draft reminder',
  cl_repetida: 'Same property listed twice',
  cl_publicacion_vence: 'Paid listing ends soon',
  cl_publicacion_termino: 'Paid listing ended',
  cl_plan_agentes: 'Plan for agents',
  cl_cuenta_lista: 'Welcome — account ready',
  cl_sin_publicar: 'Signed up, no listing yet',
  cl_pendiente_pago: 'Listing waiting for payment',
  cl_fotos_rechazadas: 'Listing not published — photos rejected',
  cl_publicacion_pausada: 'Listing paused',
  cl_publicacion_incompleta: 'Listing not published — missing details',
  cl_pendiente_pago_v2: 'Listing waiting for payment (with pay button)',
  cl_visitas_v2: 'Listing getting views (with next step)',
  cl_sin_publicar_v2: 'Signed up, no listing yet (with button)',
  cl_fotos_rechazadas_v2: 'Photos rejected (with button)',
  cl_repetida_v2: 'Same property listed twice (with button)',
  cl_cuenta_lista_v2: 'Welcome — account ready (with button)',
  cl_plan_agentes_v2: 'Plan for agents (quick reply)',
  cl_visitas_sin_contacto: 'Views but no contacts',
  casa_libre_otp: 'Verification code',
};

// "cl_nuevo_aviso" → "Nuevo aviso" for one we haven't named yet.
export const waLabel = (name) => WA_LABEL_EN[name] || (String(name || '').replace(/^cl_/, '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) || 'WhatsApp message');

// The template's text as the person read it, with the per-person values shown as "…".
export const waBodyText = (body) => String(body || '').replace(/\{\{\d+\}\}/g, '…').replace(/[*_~]/g, '').replace(/\s+/g, ' ').trim();
