import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import { cronRunner } from "@/lib/inngest/cron-runner";
import { approvalNotifier } from "@/lib/inngest/approval-notifier";
import { approvalTimeout } from "@/lib/inngest/approval-timeout";

/**
 * Inngest serve endpoint — handles all function registrations + event delivery.
 * In dev, Inngest Dev Server calls this. In prod, Inngest Cloud calls this.
 * Set INNGEST_SIGNING_KEY in production to verify requests.
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [cronRunner, approvalNotifier, approvalTimeout],
});
