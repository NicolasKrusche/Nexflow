-- FlowOS — Initial schema migration
-- Applies all tables, constraints, and RLS policies.

-- ─── PROFILES ─────────────────────────────────────────────────────────────

CREATE TABLE public.profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id        UUID,
  display_name  TEXT,
  avatar_url    TEXT,
  tier          TEXT DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'enterprise')),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ─── API KEYS ──────────────────────────────────────────────────────────────

CREATE TABLE public.api_keys (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  org_id            UUID,
  name              TEXT NOT NULL,
  provider          TEXT NOT NULL,
  vault_secret_id   UUID NOT NULL,
  is_valid          BOOLEAN DEFAULT TRUE,
  last_validated_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ─── CONNECTIONS ───────────────────────────────────────────────────────────

CREATE TABLE public.connections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  org_id            UUID,
  name              TEXT NOT NULL,
  provider          TEXT NOT NULL,
  auth_type         TEXT NOT NULL CHECK (auth_type IN ('oauth', 'api_key')),
  vault_secret_id   UUID NOT NULL,
  scopes            TEXT[],
  metadata          JSONB,
  is_valid          BOOLEAN DEFAULT TRUE,
  last_validated_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ─── PROGRAMS ──────────────────────────────────────────────────────────────

CREATE TABLE public.programs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  org_id              UUID,
  name                TEXT NOT NULL,
  description         TEXT,
  schema              JSONB NOT NULL,
  schema_version      INTEGER DEFAULT 1,
  execution_mode      TEXT DEFAULT 'supervised'
                        CHECK (execution_mode IN ('autonomous', 'supervised', 'manual')),
  is_active           BOOLEAN DEFAULT FALSE,
  conflict_policy     TEXT DEFAULT 'queue' CHECK (conflict_policy IN ('queue','skip','fail')),
  last_run_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.program_connections (
  program_id    UUID REFERENCES public.programs(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES public.connections(id) ON DELETE CASCADE,
  PRIMARY KEY (program_id, connection_id)
);

CREATE TABLE public.program_versions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id     UUID NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  version        INTEGER NOT NULL,
  schema         JSONB NOT NULL,
  change_summary TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(program_id, version)
);

-- ─── RUNS ──────────────────────────────────────────────────────────────────

CREATE TABLE public.runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id      UUID NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  triggered_by    TEXT NOT NULL,
  trigger_payload JSONB,
  status          TEXT DEFAULT 'pending'
                    CHECK (status IN ('pending','running','paused','completed','failed','cancelled')),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  error_message   TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.node_executions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          UUID NOT NULL REFERENCES public.runs(id) ON DELETE CASCADE,
  node_id         TEXT NOT NULL,
  status          TEXT DEFAULT 'pending'
                    CHECK (status IN ('pending','queued','running','waiting_approval','completed','failed','skipped')),
  input_payload   JSONB,
  output_payload  JSONB,
  error_message   TEXT,
  retry_count     INTEGER DEFAULT 0,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── APPROVALS ─────────────────────────────────────────────────────────────

CREATE TABLE public.approvals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_execution_id   UUID NOT NULL REFERENCES public.node_executions(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES public.profiles(id),
  status              TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  context             JSONB,
  decision_note       TEXT,
  decided_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ─── TRIGGERS ──────────────────────────────────────────────────────────────

CREATE TABLE public.triggers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('manual','cron','webhook','event','program')),
  config     JSONB NOT NULL,
  is_active  BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── USAGE ─────────────────────────────────────────────────────────────────

CREATE TABLE public.usage (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  org_id           UUID,
  period_start     DATE NOT NULL,
  period_end       DATE NOT NULL,
  program_count    INTEGER DEFAULT 0,
  execution_count  INTEGER DEFAULT 0,
  connection_count INTEGER DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, period_start)
);

-- ─── RESOURCE LOCKS ────────────────────────────────────────────────────────

CREATE TABLE public.resource_locks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type    TEXT NOT NULL,
  resource_id      UUID NOT NULL,
  locked_by_run_id UUID REFERENCES public.runs(id) ON DELETE CASCADE,
  acquired_at      TIMESTAMPTZ DEFAULT NOW(),
  expires_at       TIMESTAMPTZ NOT NULL,
  UNIQUE(resource_type, resource_id)
);

-- ─── RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connections       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.programs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.program_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.program_versions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.runs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.node_executions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approvals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.triggers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resource_locks    ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE POLICY "own profile" ON public.profiles
  FOR ALL USING (auth.uid() = id);

-- API Keys
CREATE POLICY "own api_keys" ON public.api_keys
  FOR ALL USING (auth.uid() = user_id);

-- Connections
CREATE POLICY "own connections" ON public.connections
  FOR ALL USING (auth.uid() = user_id);

-- Programs
CREATE POLICY "own programs" ON public.programs
  FOR ALL USING (auth.uid() = user_id);

-- Program connections (access via program ownership)
CREATE POLICY "own program_connections" ON public.program_connections
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.programs p
      WHERE p.id = program_id AND p.user_id = auth.uid()
    )
  );

-- Program versions
CREATE POLICY "own program_versions" ON public.program_versions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.programs p
      WHERE p.id = program_id AND p.user_id = auth.uid()
    )
  );

-- Runs
CREATE POLICY "own runs" ON public.runs
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.programs p
      WHERE p.id = program_id AND p.user_id = auth.uid()
    )
  );

-- Node executions
CREATE POLICY "own node_executions" ON public.node_executions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.runs r
      JOIN public.programs p ON p.id = r.program_id
      WHERE r.id = run_id AND p.user_id = auth.uid()
    )
  );

-- Approvals
CREATE POLICY "own approvals" ON public.approvals
  FOR ALL USING (auth.uid() = user_id);

-- Triggers
CREATE POLICY "own triggers" ON public.triggers
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.programs p
      WHERE p.id = program_id AND p.user_id = auth.uid()
    )
  );

-- Usage
CREATE POLICY "own usage" ON public.usage
  FOR ALL USING (auth.uid() = user_id);

-- Resource locks (accessible to owner of the locked run)
CREATE POLICY "own resource_locks" ON public.resource_locks
  FOR ALL USING (
    locked_by_run_id IS NULL OR
    EXISTS (
      SELECT 1 FROM public.runs r
      JOIN public.programs p ON p.id = r.program_id
      WHERE r.id = locked_by_run_id AND p.user_id = auth.uid()
    )
  );
