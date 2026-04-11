-- ─── Phase 5: Public Schema Marketplace ─────────────────────────────────────
--
-- Adds public sharing columns to programs and an RLS policy that lets
-- anonymous users read published programs.

-- 1. New columns on programs
ALTER TABLE programs
  ADD COLUMN IF NOT EXISTS is_public         BOOLEAN        NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tags              TEXT[]         NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS fork_count        INTEGER        NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS published_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS public_author_name TEXT;

-- 2. Index for fast public listing queries
CREATE INDEX IF NOT EXISTS idx_programs_is_public ON programs (is_public, published_at DESC)
  WHERE is_public = true;

-- 3. RLS: allow anyone (including anon) to read public programs
--    The existing "Users can CRUD their own programs" policy already covers owners.
CREATE POLICY "Public programs are readable by everyone"
  ON programs
  FOR SELECT
  USING (is_public = true);

-- 4. Function to atomically increment fork_count (called server-side via service key)
CREATE OR REPLACE FUNCTION increment_fork_count(program_id UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE programs SET fork_count = fork_count + 1 WHERE id = program_id;
$$;
