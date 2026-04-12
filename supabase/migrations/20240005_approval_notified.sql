-- ─── Approval notification tracking ──────────────────────────────────────────
-- Tracks when the email notification was sent so the notifier Inngest function
-- doesn't send duplicate emails on repeated invocations.

ALTER TABLE public.approvals
  ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;

-- Index so the notifier can efficiently find unnotified pending approvals.
CREATE INDEX IF NOT EXISTS idx_approvals_pending_unnotified
  ON public.approvals (status, notified_at)
  WHERE status = 'pending' AND notified_at IS NULL;
