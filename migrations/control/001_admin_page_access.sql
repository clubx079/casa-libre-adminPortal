-- CONTROL DB (admin team logins), NOT a country DB.
-- Team -> Page access: which admin pages a member may open (lib/adminPages.js).
--   null                                 every page (all existing members keep full access)
--   {"preset":"marketing"}               a ready-made role (pages defined in code)
--   {"preset":"custom","pages":[...]}    pages picked one by one
-- Additive and safe to run twice. Run it in the AiroBase SQL editor of the control DB project.
alter table public.admin_users add column if not exists page_access jsonb;
