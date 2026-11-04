# Deploy Harborview to Netlify

Harborview's Netlify deployment uses a JavaScript Netlify Function and the
existing Supabase PostgreSQL database. The legacy Flask application remains
available for local development and its Python test suite; Netlify does not
run that Flask application.

## 1. Prepare Supabase

Run `schema_postgres.sql` once in the Supabase SQL Editor. Keep the Supabase
service-role key private; the Netlify Function uses it only on the server.

## 2. Connect the repository to Netlify

Import the Git repository into Netlify. Leave the base directory and publish
directory settings at their defaults; `netlify.toml` configures the `public`
directory and `netlify/functions` automatically. Netlify installs the Node
dependencies from `package.json`.

The repository no longer contains Vercel deployment configuration. To fully
disconnect the old Vercel project from GitHub, open that project in Vercel,
go to **Settings → Git**, and disconnect the repository (or delete the Vercel
project). Repository changes cannot revoke an account-level integration.

## 3. Configure environment variables

Add these variables in the Netlify site's environment settings for production
and any deploy previews that need database access:

| Variable | Value |
| --- | --- |
| `SECRET_KEY` | A long, random session-signing secret |
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

Netlify Function tests run with `npm install` followed by `npm test`.
