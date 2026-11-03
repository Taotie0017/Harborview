# Deploy to Vercel

## 1. Prepare Supabase

Create a Supabase project and run `schema_postgres.sql` once in its SQL Editor.
The application uses the service-role key on the server, so never put that key
in browser code or commit it to the repository.

## 2. Import the repository

Import this Git repository into Vercel and deploy from the repository root.
Vercel uses `pyproject.toml` to find the Flask app and `requirements.txt` to
install its Python dependencies. Templates are bundled with the function, and
files under `public/` are served as static assets.

## 3. Add Vercel environment variables

Add these variables to the Vercel project for each environment you deploy:

| Variable | Value |
| --- | --- |
| `SECRET_KEY` | A long, random secret used to sign sessions |
| `DATABASE_BACKEND` | `supabase` |
| `SUPABASE_URL` | The Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | The Supabase service-role key |

Keep the service-role key server-side. Do not commit `.env` or paste secrets
into source files. Redeploy after changing Vercel environment variables.

## 4. Create the first admin

With Python dependencies installed locally, put the same Supabase connection
values and a private `SECRET_KEY` in the ignored root `.env` file. Then run:

```powershell
python create_admin.py
```

The script prompts for the admin name, email, and password without echoing the
password. This creates the account in the configured Supabase database.

## Local checks

Install dependencies with `pip install -r requirements.txt`, then run
`pytest`. Local development can continue to use SQLite by setting
`DATABASE_BACKEND=sqlite` in `.env`.
