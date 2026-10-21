# Apply the security migration

The live database is not changed by the deploy. Run this yourself in the Supabase SQL editor for project `ckwvaykmsbpckepczcsd` after the new site is on Vercel.

## Before the SQL

1. In Vercel → dansbootsale → Settings → Environment Variables, set these for Production (and Preview if you use the preview to sign in):
   - `SUPABASE_SERVICE_ROLE_KEY` — server only. The wholesale catalog and staff photo upload need it. Never put it in the browser.
   - `SESSION_SECRET` — a long random string. It signs the Corral and staff cookie.
   - `CORRAL_PASSWORD` — the new Corral password. Choose a new one. The old passcode is removed from the site.
   - `STAFF_PASSWORD` — the new staff password. Choose a new one, different from the Corral password.
2. Confirm there is at least one user in Supabase Authentication. The migration copies every existing user into `profiles` as an admin. If you add a user later, run this again:

```sql
insert into public.profiles (user_id, role)
select id, 'admin' from auth.users
on conflict (user_id) do nothing;
```

3. Deploy this branch first and check the public shop. Before the SQL runs, the shop reads an explicit public column list (photos, price, size, brand). Descriptions appear after the SQL, because that text used to live in a column the anonymous key could also use to read private notes.

## Apply

1. Open the Supabase SQL editor.
2. Paste `supabase/migrations/20261021_security_overhaul.sql` and run it once.
3. Check the result:

```sql
select count(*) as admins from public.profiles where role = 'admin';
select public.public_catalog() -> 0 as sample;
```

`admins` should be at least 1. `sample` should include `description` and `price`, and must not include `sku`, `notes`, `wholesale_price`, or `cost`.

4. Reload the shop. Open a boot that has a description and confirm the condition report shows. View source on that boot URL and confirm the share title and image are the pair, not the homepage.
5. Sign in at `/admin` with the Supabase email and password. Publish still works. Import a List Perfectly CSV only after you see the preview: retail price comes from the Price column, Group Price becomes the wholesale price, and rows land in Needs Review.
6. Open `/corral` and `/staff` with the new passwords. `/wholesale` shows wholesale prices only after the Corral cookie is set.

## What the SQL changes

- `public_catalog()` is the only anonymous read. It returns published and sold pairs that have a price, with the description scrubbed.
- Anonymous grants on `products`, `orders`, and `import_log` are removed. Writes require an admin profile.
- `import_log` stores CSV undo records for the admin account.
- Anonymous upload policies on `storage.objects` are removed. Anyone can still read `wholesale-photos`. Staff uploads go through the service role.
- `created_at`, `updated_at`, and `sold_at` are added if they are missing. A trigger stamps `sold_at` when a pair is marked sold.

## If a column name differs

If the editor stops on `p.condition` or `p.notes`, that column is not on `products`. Stop. Do not improvise a grant. Add the missing column or remove that one key from `jsonb_build_object`, then run the file again. The function is `create or replace`, so re-running the file is safe.

## Roll back

1. Paste `supabase/migrations/20261021_security_overhaul_rollback.sql` and run it.
2. That removes the catalog function, the admin policies, and the sold trigger. It does **not** give the anonymous key the table back.
3. The commented emergency block at the bottom of the rollback file can temporarily allow anonymous reads of the public columns only. Use it only to bring the previous site back, then re-apply the overhaul once this deploy is healthy.
4. Redeploy the previous Vercel deployment if the new pages should come down too. Rolling back the SQL while this site is live hides descriptions until `public_catalog()` exists again; the shop falls back to the public columns and stays up.

## Do not commit

Real List Perfectly exports contain costs, SKUs, and group prices. Keep them off this public repository. The tests use `tests/fixtures/listperfectly-sample.csv`, which is fake.
