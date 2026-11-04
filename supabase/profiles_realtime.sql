-- Live updates when someone changes their username,
-- so friends see the new name without refreshing
alter publication supabase_realtime add table public.profiles;