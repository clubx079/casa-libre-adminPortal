-- 014_profile_photo_rejected.sql — "Wrong photo" (Roland, Nov 20). Run in EACH country DB (PY, BO, UY, VE, SV)
-- and the sandbox, AFTER 013. Additive only, safe to run twice. AiroBase SQL editor: paste and Run (no begin/commit).
--   1. users: the last profile-photo upload the website turned down because it was neither a face nor a
--      logo (website lib/profilePhotoKind.js uploadDecision). Nothing is saved for such an upload; only
--      when, what it looked like (house / apartment / object / … — a fixed code) and how many so far.
--   2. the three Spanish wrong-photo emails (Email templates).
--   3. the settings row of the "Show your face" automation's wrong-photo part, switched OFF — switch it on
--      in Admin → Automations → "Show your face" (step 4). It never overwrites an existing row or template.
alter table public.users add column if not exists profile_photo_rejected_at timestamptz;
alter table public.users add column if not exists profile_photo_rejected_what text;
alter table public.users add column if not exists profile_photo_rejected_count integer not null default 0;
create index if not exists users_profile_photo_rejected_at_idx on public.users (profile_photo_rejected_at) where profile_photo_rejected_at is not null;

insert into public.email_templates (key, name, subject, heading, body, button_label, button_url, is_active)
select 'photo-wrong', 'Foto no válida — primer email', 'Tu foto de perfil no se pudo usar', 'Subí tu foto o el logo de tu empresa', 'Hola {{name}},

{{photo_line}}

Subí tu foto profesional (tu cara) o el logo de tu empresa. Los compradores confían más en un vendedor que pueden ver.

Te lleva un minuto desde Mi cuenta → Ajustes, en la web o en la app de Casa-Libre para iPhone y Android.', 'Subir mi foto', '{{settings_url}}', true
where not exists (select 1 from public.email_templates where key = 'photo-wrong');

insert into public.email_templates (key, name, subject, heading, body, button_label, button_url, is_active)
select 'photo-wrong-reminder', 'Foto no válida — recordatorio', 'Tu perfil de Casa-Libre todavía no tiene tu foto', 'Los compradores quieren saber con quién hablan', 'Hola {{name}},

{{photo_line}}

Por experiencia, los compradores escriben más tranquilos cuando ven quién vende. Subí una foto de tu cara o el logo de tu empresa desde Mi cuenta → Ajustes, en la web o en la app de Casa-Libre para iPhone y Android.', 'Subir mi foto', '{{settings_url}}', true
where not exists (select 1 from public.email_templates where key = 'photo-wrong-reminder');

insert into public.email_templates (key, name, subject, heading, body, button_label, button_url, is_active)
select 'photo-wrong-kept', 'Foto no válida — se mantuvo la anterior', 'Tu nueva foto de perfil no fue aceptada', 'Seguimos mostrando tu foto anterior', 'Hola {{name}},

{{photo_line}}

Si querés cambiarla, subí una foto tuya (tu cara) o el logo de tu empresa: los compradores confían más en un vendedor que pueden ver. Podés hacerlo desde Mi cuenta → Ajustes, en la web o en la app de Casa-Libre para iPhone y Android.', 'Cambiar mi foto', '{{settings_url}}', true
where not exists (select 1 from public.email_templates where key = 'photo-wrong-kept');

-- milestones = hours after the turned-down upload (2 h, 2 days, 7 days); template_id = first email,
-- reminder_template_id = later ones, gift_template_id = the ONE "new photo not accepted" email.
insert into public.automations (id, enabled, milestones, wait_days, template_id, reminder_template_id, gift_template_id, updated_at)
select 'profile_photo_face_wrong', false, '{2,48,168}'::integer[], 0,
  (select id from public.email_templates where key = 'photo-wrong' limit 1),
  (select id from public.email_templates where key = 'photo-wrong-reminder' limit 1),
  (select id from public.email_templates where key = 'photo-wrong-kept' limit 1), now()
where not exists (select 1 from public.automations where id = 'profile_photo_face_wrong');
