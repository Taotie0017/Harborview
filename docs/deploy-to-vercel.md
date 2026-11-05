# Deploy Harborview to Vercel

Harborview's Vercel deployment uses a Node.js serverless function and the
existing Supabase PostgreSQL database. The legacy Flask application remains
available for local development and its Python test suite; Vercel runs the
JavaScript application.

## 1. Prepare Supabase

Run `schema_postgres.sql` in the Supabase SQL Editor before deploying. If this
project already has the original schema, run the updated script again to add
email verification, event capacity and waitlist tables, and the registration
functions. The script asks PostgREST to reload its schema cache after applying
the changes. Confirm the script completes without errors. Keep the Supabase
service-role key private; the Vercel Function uses it only on the server.

## 2. Connect the repository to Vercel

Import the Git repository into Vercel. `vercel.json` sets the framework preset
to **Other** so Vercel does not mistake the local-development `app.py` for the
deployment entrypoint. It also routes application requests to the catch-all
function in `api/`; static files are served from `public/`. Node dependencies
are installed from `package.json`.

## 3. Configure environment variables

Add these variables in the Vercel project's environment settings for
production and any preview deployments that need database access:

| Variable | Value |
| --- | --- |
| `SECRET_KEY` | A long, random session-signing secret (at least 32 characters) |
| `SUPABASE_URL` | The Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | The Supabase service-role key |
| `RESEND_API_KEY` | A Resend API key authorized to send email |
| `EMAIL_FROM` | A sender address on a domain verified with Resend, e.g. `Harborview <no-reply@example.com>` |

Never put these values in `public/` or commit them to Git. Redeploy after
changing environment variables.

Students verify their email after signup and enter a fresh email code on each
login. Logging in with a student ID sends the code to the email address saved
on that account. Verification codes expire after 10 minutes, allow five
attempts, and can be resent once per minute. Configure a verified sender
domain in Resend before enabling signups or student logins. If Resend rejects
a message, the signup or login form displays Resend's error so you can correct
the sender or API-key configuration. Event capacity is set by the event office
when creating or editing an event; additional students are waitlisted and
promoted automatically when a registered student cancels.

For local Flask development, add `RESEND_API_KEY` and `EMAIL_FROM` to the
ignored root `.env` file as well.

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
