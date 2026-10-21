-- Roll back the security overhaul. Read supabase/APPLY.md before running this.
-- This does not restore anonymous table access. That access was publishing
-- private columns. Re-open it only with the commented block at the bottom,
-- and only long enough to put the previous site back.

drop trigger if exists products_touch_status on public.products;
drop function if exists public.touch_product_status();

drop policy if exists "admin all products" on public.products;
drop policy if exists "admin all orders" on public.orders;
drop policy if exists "admin all import log" on public.import_log;
drop policy if exists "admin reads own profile" on public.profiles;
drop policy if exists "public read wholesale photos" on storage.objects;

drop function if exists public.public_catalog();
drop function if exists public.scrub_public_text(text);
drop function if exists public.is_admin();

notify pgrst, 'reload schema';

-- Emergency only, if the previous site must work before a fixed deploy.
-- This grants the anonymous key the old public columns and nothing else.
-- Uncomment the whole block, run it, then comment it again after the new
-- site is healthy and re-apply 20261021_security_overhaul.sql.
--
-- grant select (
--   id, gender, brand, title, size, width, no_width, material, price, photos,
--   women_size, women_width, status, updated_at, created_at, sold_at
-- ) on public.products to anon;
-- create policy "emergency anon read published"
--   on public.products for select to anon
--   using (status in ('published', 'sold') and price > 0);
