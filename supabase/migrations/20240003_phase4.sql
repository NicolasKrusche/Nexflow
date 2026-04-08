-- FlowOS — Phase 4: Trigger Engine & Execution Controls

-- ─── TRIGGERS: add scheduling columns ──────────────────────────────────────

ALTER TABLE public.triggers
  ADD COLUMN IF NOT EXISTS webhook_token  UUID    UNIQUE DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS next_run_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_fired_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ DEFAULT NOW();

-- Index for cron runner query: find active cron triggers due to fire
CREATE INDEX IF NOT EXISTS idx_triggers_cron_due
  ON public.triggers (next_run_at)
  WHERE type = 'cron' AND is_active = TRUE;

-- Index for webhook lookup
CREATE INDEX IF NOT EXISTS idx_triggers_webhook_token
  ON public.triggers (webhook_token)
  WHERE type = 'webhook';

-- Index for inter-program trigger lookup
CREATE INDEX IF NOT EXISTS idx_triggers_program_type
  ON public.triggers (program_id, type)
  WHERE is_active = TRUE;

-- ─── RUNS: execution_mode snapshot for audit ────────────────────────────────

ALTER TABLE public.runs
  ADD COLUMN IF NOT EXISTS execution_mode TEXT DEFAULT 'autonomous';

-- ─── RESOURCE LOCKS: index for lock lookup ──────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_resource_locks_resource
  ON public.resource_locks (resource_type, resource_id);

CREATE INDEX IF NOT EXISTS idx_resource_locks_run
  ON public.resource_locks (locked_by_run_id);

-- ─── CLEANUP FUNCTION: release stale locks ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.release_stale_locks()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.resource_locks
  WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- ─── HELPER: fire inter-program triggers after run completion ────────────────
-- Returns program_ids that should be triggered by the completion of a given run

CREATE OR REPLACE FUNCTION public.get_downstream_triggers(p_program_id UUID)
RETURNS TABLE(trigger_id UUID, downstream_program_id UUID, trigger_config JSONB)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT t.id, t.program_id, t.config
  FROM public.triggers t
  WHERE t.type = 'program'
    AND t.is_active = TRUE
    AND (t.config->>'source_program_id')::UUID = p_program_id;
$$;
