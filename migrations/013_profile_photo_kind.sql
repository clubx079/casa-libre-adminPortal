-- 013_profile_photo_kind.sql — "Show your face" (Roland, Nov 18). Run in EACH country DB (PY, BO, UY, VE, SV)
-- and the sandbox. Additive only, safe to run twice. AiroBase SQL editor: paste and Run (no begin/commit).
--   1. users: what the APPROVED profile photo shows, decided by the AI for that exact photo
--      (website lib/profilePhotoKind.js): face | logo | other. _kind_key = the profile_photo_key it was
--      decided for (a new photo is checked again); _kind_at = when.
--   2. the two Spanish emails (Email templates) and the automation row, switched OFF — switch it on
--      in Admin → Automations → "Show your face" (it never overwrites an existing row or template).
alter table public.users add column if not exists profile_photo_kind text;
alter table public.users add column if not exists profile_photo_kind_key text;
alter table public.users add column if not exists profile_photo_kind_at timestamptz;

insert into public.email_templates (key, name, subject, heading, body, button_label, button_url, is_active)
select 'photo-face', 'Mostrá tu cara — primer email', 'Un consejo para recibir más consultas en Casa-Libre', 'Los compradores quieren saber con quién hablan', 'Hola {{name}},

{{photo_line}}

Usar el logo de tu empresa está bien, pero los compradores se sienten más cómodos cuando saben con quién están tratando. Ver la cara de la persona genera **más confianza**, y la confianza trae **más consultas** por WhatsApp.

**Cómo cambiarla (1 minuto):** entrá a Mi cuenta → Ajustes y subí una foto tuya: de frente, con buena luz y sin otras personas. Tu empresa sigue apareciendo junto a tu nombre.

Tu foto aparece en todas tus publicaciones, en la web y en la app de Casa-Libre para iPhone y Android.', 'Subir mi foto', '{{settings_url}}', true
where not exists (select 1 from public.email_templates where key = 'photo-face');

insert into public.email_templates (key, name, subject, heading, body, button_label, button_url, is_active)
select 'photo-face-reminder', 'Mostrá tu cara — recordatorio', 'Tu foto de perfil puede traerte más consultas', 'Mostrales a los compradores quién sos', 'Hola {{name}},

{{photo_line}}

Los compradores escriben con más confianza a un vendedor que pueden ver. Una foto tuya, de frente y con buena luz, hace que tus publicaciones se vean más profesionales y confiables.

Te lleva un minuto desde Mi cuenta → Ajustes, en la web o en la app de Casa-Libre para iPhone y Android.', 'Subir mi foto', '{{settings_url}}', true
where not exists (select 1 from public.email_templates where key = 'photo-face-reminder');

insert into public.automations (id, enabled, milestones, wait_days, template_id, reminder_template_id, updated_at)
select 'profile_photo_face', false, '{24,72,168}'::integer[], 0,
  (select id from public.email_templates where key = 'photo-face' limit 1),
  (select id from public.email_templates where key = 'photo-face-reminder' limit 1), now()
where not exists (select 1 from public.automations where id = 'profile_photo_face');
