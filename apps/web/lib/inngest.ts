import { Inngest } from "inngest";

/**
 * Shared Inngest client.
 * INNGEST_EVENT_KEY is optional in dev (Inngest Dev Server auto-connects).
 * INNGEST_SIGNING_KEY is required in production.
 */
export const inngest = new Inngest({
  id: "flowos",
  eventKey: process.env.INNGEST_EVENT_KEY,
});

// ─── Event type map ───────────────────────────────────────────────────────────

export type FlowOSEvents = {
  "flowos/trigger.cron.tick": { data: Record<string, never> };
  "flowos/trigger.program.complete": {
    data: { program_id: string; run_id: string; user_id: string };
  };
  "flowos/trigger.webhook": {
    data: { trigger_id: string; token: string; payload: Record<string, unknown> };
  };
};
