import { NonRetriableError } from "inngest";
import { inngest } from "@/lib/inngest";
import { createServiceClient } from "@/lib/api";
import { sendApprovalEmail } from "@/lib/email";

type PendingApproval = {
  id: string;
  user_id: string;
  context: {
    node_label?: string;
    program_id?: string;
    reason?: string;
  } | null;
  created_at: string;
  node_executions: {
    runs: {
      programs: {
        name: string;
      };
    };
  };
};

type UserRow = { email: string };

/**
 * Inngest function: runs every minute.
 * Finds pending approvals that have never been notified (notified_at IS NULL),
 * sends an email to the owning user, then stamps notified_at so it won't fire again.
 */
export const approvalNotifier = inngest.createFunction(
  { id: "approval-notifier", name: "Approval Email Notifier" },
  { cron: "* * * * *" },
  async ({ step, logger }) => {
    const db = createServiceClient();

    const unnotified = await step.run("fetch-unnotified", async () => {
      const { data, error } = await db
        .from("approvals")
        .select(`
          id,
          user_id,
          context,
          created_at,
          node_executions (
            runs (
              programs ( name )
            )
          )
        `)
        .eq("status", "pending")
        .is("notified_at", null)
        .order("created_at", { ascending: true })
        .limit(50);

      if (error) throw new NonRetriableError(`DB error: ${error.message}`);
      return (data ?? []) as unknown as PendingApproval[];
    });

    if (unnotified.length === 0) return { notified: 0 };

    let notified = 0;

    for (const approval of unnotified) {
      await step.run(`notify-${approval.id}`, async () => {
        // Fetch user email via auth.users (service role required)
        const { data: userData, error: userError } = await db.auth.admin.getUserById(
          approval.user_id
        );

        if (userError || !userData?.user?.email) {
          logger.warn(`Could not fetch email for user ${approval.user_id} — skipping`);
          return;
        }

        const email = userData.user.email;
        const nodeLabel = approval.context?.node_label ?? "Agent step";
        const programName =
          (approval.node_executions as unknown as PendingApproval["node_executions"])
            ?.runs?.programs?.name ?? "Unknown program";
        const reason = approval.context?.reason;

        try {
          await sendApprovalEmail({
            to: email,
            nodeLabel,
            programName,
            approvalId: approval.id,
            reason,
          });
        } catch (err) {
          logger.error(`Failed to send approval email for ${approval.id}: ${String(err)}`);
          return;
        }

        // Stamp notified_at so this won't fire again
        await db
          .from("approvals")
          .update({ notified_at: new Date().toISOString() } as never)
          .eq("id", approval.id);

        notified++;
      });
    }

    return { notified };
  }
);
