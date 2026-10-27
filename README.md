# Sales Hub

Sales reporting system (CIRA 1/2/3 + OTC lines), built on Supabase + GitHub Pages.

- Frontend: static site (`index.html`, `app.js`, `styles.css`) served by GitHub Pages
- Backend: Supabase (Postgres + Auth + RLS)
- `config.js` holds the public Supabase URL and anon key only. Never commit the
  service_role / secret key, real data files, or Excel sheets (see `.gitignore`).

## SQL files (run in order in the Supabase SQL Editor)

1. `supabase/01_schema.sql` - tables, date-range constraints, RLS
2. `supabase/02_data.sql` - initial mapping data (generated locally, NOT in this repo)
3. `supabase/03_auth.sql` - admin-only access
4. `supabase/04_make_admin.sql` - marks the login as admin (NOT in this repo)
5. `supabase/05_edit_functions.sql` - functions used by the edit screens (move bricks, change rep/manager, add box, copy line)
