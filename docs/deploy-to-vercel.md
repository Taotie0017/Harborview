# Deploy Harborview to Vercel

Harborview's Vercel deployment uses a Node.js serverless function and the
existing Supabase PostgreSQL database. The legacy Flask application remains
available for local development and its Python test suite; Vercel runs the
JavaScript application.

## 1. Prepare Supabase

Run `schema_postgres.sql` once in the Supabase SQL Editor. Keep the Supabase
service-role key private; the Vercel Function uses it only on the server.

## 2. Connect the repository to Vercel

Import the Git repository into Vercel. Vercel uses `vercel.json` to route
application requests to the catch-all function in `api/`; static files are
served from `public/`. The Node dependencies are installed from
`package.json`.

To disconnect an existing Netlify project or remove its Git integration, open
that site in Netlify and disconnect the repository in its site settings.
Repository changes cannot revoke an account-level integration.

## 3. Configure environment variables

Add these variables in the Vercel project's environment settings for
production and any preview deployments that need database access:

| Variable | Value |
| --- | --- |
| `SECRET_KEY` | A long, random session-signing secret (at least 32 characters) |
| `SUPABASE_URL` | The Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | The Supabase service-role key |

Never put these values in `public/` or commit them to Git. Redeploy after
changing environment variables.

## 4. Create an administrator

Configure the same Supabase values and a private `SECRET_KEY` in the ignored
root `.env` file, install the Python requirements, then run:

```powershell
python create_admin.py
```

The script securely prompts for the admin password and writes a compatible
Werkzeug password hash to Supabase.

## Local checks

The original Flask implementation can still be tested locally:

```powershell
python -m pip install -r requirements.txt
python -m pytest -q
```

The Vercel Function tests run with `npm install` followed by `npm test`.
