-- 015_photo_face_copy.sql — new, shorter copy for the two "Show your face" emails (logo → please add a
-- photo of your face; Roland, Nov 20: "from experience, buyers want to know who they're dealing with").
-- OPTIONAL. Run in each country DB after 013 (order vs 014 doesn't matter). Safe to run twice.
-- Only rewrites a template that still has the ORIGINAL 013 subject + heading, so an email an admin already
-- edited in Admin → Email templates is left alone.
update public.email_templates set
  subject = 'Los compradores quieren ver quién sos',
  heading = 'Sumá una foto tuya a tu perfil',
  body = 'Hola {{name}},

{{photo_line}} Por experiencia, los compradores quieren saber con quién están tratando: una foto de tu cara les da más confianza para escribirte.

Subila en un minuto desde Mi cuenta → Ajustes, en la web o en la app de Casa-Libre para iPhone y Android.',
  updated_at = now()
where key = 'photo-face'
  and subject = 'Un consejo para recibir más consultas en Casa-Libre'
  and heading = 'Los compradores quieren saber con quién hablan';

update public.email_templates set
  subject = 'Una foto tuya genera más confianza',
  heading = 'Los compradores quieren saber quién vende',
  body = 'Hola {{name}},

{{photo_line}} Los compradores escriben con más confianza cuando ven la cara de la persona que vende.

Subí tu foto desde Mi cuenta → Ajustes, en la web o en la app de Casa-Libre para iPhone y Android.',
  updated_at = now()
where key = 'photo-face-reminder'
  and subject = 'Tu foto de perfil puede traerte más consultas'
  and heading = 'Mostrales a los compradores quién sos';
