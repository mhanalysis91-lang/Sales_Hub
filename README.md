# Sales Hub

Sales reporting system (3 lines + OTC line), built on Supabase + GitHub Pages.

- Frontend: static site served by GitHub Pages
- Backend: Supabase (Postgres + Auth + RLS)
- Config: `config.js` holds the public Supabase URL and anon key only.
  Never commit the service_role / secret key or any real data files.
