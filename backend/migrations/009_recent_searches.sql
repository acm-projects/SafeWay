-- Recent searches table: stores per-user search history
CREATE TABLE IF NOT EXISTS public.recent_searches (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  place_id TEXT,
  place_name TEXT,
  place_address TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  searched_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recent_searches_user
  ON public.recent_searches(user_id, searched_at DESC);

ALTER TABLE public.recent_searches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own searches"
  ON public.recent_searches FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own searches"
  ON public.recent_searches FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own searches"
  ON public.recent_searches FOR DELETE
  USING (auth.uid() = user_id);
