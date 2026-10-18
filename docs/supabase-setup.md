# Supabase setup runbook

Nothing here has been run against a hosted project yet. Do not copy keys into chat, files in this repo or screenshots.

## 0. Prerequisites
Node `^22.13`, npm, the Supabase CLI (`npx supabase@2.121.0 ...`; it works through npm, **Docker is needed only for the local stack**), a Supabase account. Free plan notes: projects pause after inactivity, storage/egress/function quotas apply, `pg_cron` and some Auth email limits differ by plan. Check https://supabase.com/pricing before launch; do not assume unlimited free operation.

## 1. Verify locally (no Docker, no Supabase account)
```sh
npm ci
npm run test:db     # real PostgreSQL 17 (embedded): migrations, RLS, checkout, concurrency, storage policies, Edge Function handlers, seed
npm test            # unit tests
```

## 2. Create and link the project (owner action)
1. Create a project at supabase.com. **Region: choose one close to your customers** (for Pakistan, Singapore or Mumbai are the nearest); decide with the owner, a region cannot be changed later.
2. Keep production and a separate **staging** project if possible. If you have only one project, keep Vercel Preview deployments read-only (see `docs/vercel-supabase-deployment.md`).
3. `npx supabase login` (browser sign-in), then `npx supabase link --project-ref <ref>`.

## 3. Apply the schema
```sh
npx supabase db push --dry-run     # preview. Inspect an existing project's schema first; never push over production data blindly
npx supabase db push               # applies supabase/migrations/*.sql in order
```
Then seed the **draft** catalogue (sample products, unverified, nothing purchasable): paste `supabase/seed.sql` into the SQL editor (it is safe to run twice). Regenerate it with `npm run seed:generate`.

Never run `supabase db reset` against a hosted project.

## 4. Upload the sample images (optional)
```sh
npm run assets:dry-run                                   # validates all 31 files, uploads nothing, writes scripts/out/assets-report.json
# in YOUR shell only (never in a file in this repo):
#   $env:SUPABASE_URL = 'https://<ref>.supabase.co'
#   $env:SUPABASE_SECRET_KEY = '<secret key from Project Settings > API Keys>'
node scripts/migrate-assets.mjs --apply                  # private bucket, unapproved drafts
```
For a **preview/local** project only, to browse the samples: `$env:OLDVERGE_ALLOW_SAMPLE_PUBLISH='yes'; node scripts/migrate-assets.mjs --apply --publish-samples`, then run `supabase/seed-demo-publish.sql`. This publishes the stand-in photos for browsing and still does not make anything purchasable. **Do not run it on production**: the photos are unverified stand-ins (several do not match their product).

## 5. Edge Functions and secrets
```sh
npx supabase secrets set TOKEN_SECRET=<random 48+ chars> ALLOWED_ORIGINS=https://oldverge-storefront.vercel.app CRON_SECRET=<random 32+ chars>
npx supabase functions deploy                       # all 11 functions (verify_jwt is off per config.toml; each authenticates itself)
```
Optional: `ORDER_TEST_MODE=true` on staging/preview projects (every order is flagged `is_test`, excluded from revenue). `TURNSTILE_SECRET_KEY` only after a widget exists in the forms.
Automatic variables Supabase provides to functions: `SUPABASE_URL`, `SUPABASE_SECRET_KEYS`, `SUPABASE_PUBLISHABLE_KEYS` (legacy `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`).

## 6. Auth configuration (Dashboard, Authentication)
- Site URL: the confirmed production domain. Redirect allow-list: `<domain>/account/reset-password` and `<domain>/**` only for domains you deliberately support (the Vercel `*.vercel.app` URL, previews only if wanted). No wildcards broader than that.
- Email confirmations on, minimum password length 10 with upper/lower/digit (mirrors `config.toml`; the hosted project must be set to match).
- **SMTP**: Supabase's built-in email sender is for testing and heavily rate limited. Configure a real SMTP provider before launch. Auth email and commerce notifications are separate configurations.
- MFA: enable TOTP; then set `private.settings.require_mfa = true` (SQL editor) once the admin has enrolled.

## 7. Create the first admin (deliberately, server-side)
1. Sign up at `/account/register` with the owner's email and confirm it. Do not make the first signup an admin automatically.
2. In the SQL editor (runs as the project owner), using the user's id from Authentication > Users:
```sql
insert into private.admin_members (user_id, role) values ('<user uuid>', 'owner');
```
3. Remove access: `delete from private.admin_members where user_id = '<uuid>';` (takes effect on the next request). Role changes are written to `admin_audit_log`.

## 8. Scheduling (reservation expiry and notifications)
Expiry also happens lazily inside checkout, so stock cannot be oversold without a scheduler, but stale reservations should still be released. Call the `maintenance` function every 5 minutes with the header `x-cron-secret: <CRON_SECRET>` (Supabase scheduled functions via `pg_cron` + `pg_net`, or any external scheduler). `process-outbox` can run on the same schedule; it does nothing (and reports `not_configured`) until an email provider adapter exists.

## 9. Frontend
Set the two public variables in Vercel (see `docs/vercel-supabase-deployment.md`), redeploy, then run the staging smoke test in that document.

## 10. Backup and restore
- Database: `npx supabase db dump --linked -f backup.sql` (and `--data-only`); Supabase also offers platform backups on paid plans. Keep dumps **out of Git** and in a private location you control.
- **Storage objects are not in a database dump.** Back up the `product-public` and `product-private` buckets separately (the source photographs also live in `public/images` and `scripts/migrate-assets.mjs` is idempotent).
- Configuration is in `supabase/config.toml` and migrations (Git); secrets are re-set with `supabase secrets set`.
- Test a restore into a scratch project before relying on it. This has not been tested here.

## 11. Retention (owner decisions needed)
Order records must be kept for accounting; deleting an Auth account sets `orders.user_id` to null and never deletes orders. Decide: how long to keep contact messages and newsletter records, whether to anonymise old guest orders, and webhook payload retention (only minimal metadata is stored). Quota monitoring and failed-notification review are in `docs/commerce-operations.md`.
