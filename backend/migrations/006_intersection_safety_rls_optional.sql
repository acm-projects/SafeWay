-- Optional RLS for intersection_safety when the app reads with the anon key.
-- Uncomment and adjust if you use anon for map layers; service role bypasses RLS.

-- alter table public.intersection_safety enable row level security;
--
-- create policy "Allow anon read intersection_safety"
--   on public.intersection_safety for select
--   to anon
--   using (true);
