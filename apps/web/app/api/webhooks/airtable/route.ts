import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { apiError, createServiceClient } from "@/lib/api";
import { dispatchEventTriggers } from "@/lib/triggers/dispatch-event";

type AirtableConnectionRow = {
  id: string;
  user_id: string;
  metadata: Record<string, unknown> | null;
};

/**
 * POST /api/webhooks/airtable
 *
 * Receives Airtable webhook notifications.
 * Airtable signs requests with HMAC-SHA256 of the raw body using the
 * MAC secret returned when the webhook was created, delivered in the
 * `X-Airtable-Content-MAC: hmac-sha256=<hex>` header.
 *
 * Required env: AIRTABLE_WEBHOOK_MAC_SECRET
 * Optional query param: ?connection_id=<uuid> to scope to one account.
 *
 * Note: Airtable notifications are intentionally sparse — they signal that
 * data changed but do not include the changed records. Downstream nodes
 * should use list_records / get_record operations to fetch current state.
 *
 * Events dispatched:
 *   source: "airtable"  event: "tableData.changed" | "tableRecords.created" |
 *                               "tableRecords.updated" | "tableRecords.destroyed" |
 *                               "tableFields.changed"
 */
export async function POST(request: Request) {
  const macSecret = process.env.AIRTABLE_WEBHOOK_MAC_SECRET;
  if (!macSecret) {
    return apiError("Missing AIRTABLE_WEBHOOK_MAC_SECRET", 500);
  }

  const rawBody = await request.text();
  const receivedMac = request.headers.get("x-airtable-content-mac");
  if (!receivedMac) return apiError("Missing X-Airtable-Content-MAC header", 401);

  const expectedMac = `hmac-sha256=${createHmac("sha256", macSecret)
    .update(rawBody)
    .digest("hex")}`;
  const expectedBuf = Buffer.from(expectedMac);
  const receivedBuf = Buffer.from(receivedMac);
  if (
    expectedBuf.length !== receivedBuf.length ||
    !timingSafeEqual(expectedBuf, receivedBuf)
  ) {
    return apiError("Invalid Airtable MAC", 401);
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return apiError("Invalid JSON body", 400);
  }

  const baseId = typeof body.base?.id === "string" ? body.base.id : (typeof body.baseId === "string" ? body.baseId : null);
  const webhookId = typeof body.webhookId === "string" ? body.webhookId : null;
  const changedTablesById = (body.changedTablesById ?? {}) as Record<string, unknown>;

  const url = new URL(request.url);
  const explicitConnectionId = url.searchParams.get("connection_id");

  const connections = await _resolveConnections(baseId, explicitConnectionId);
  if (connections.length === 0) {
    return NextResponse.json({ ok: true, accepted: true, matched_connections: 0 });
  }

  // Derive specific event names from the change types present in the payload
  const eventNames = _deriveEventNames(changedTablesById);

  const results = await Promise.all(
    connections.flatMap((connection) =>
      eventNames.map((eventName) =>
        dispatchEventTriggers({
          source: "airtable",
          event: eventName,
          payload: {
            base_id: baseId,
            webhook_id: webhookId,
            timestamp: body.timestamp,
            changed_tables: changedTablesById,
            created_tables_by_id: body.createdTablesById ?? {},
            destroyed_table_ids: body.destroyedTableIds ?? [],
            raw: body,
          },
          connection_id: connection.id,
          user_id: connection.user_id,
        })
      )
    )
  );

  const fired = results.filter((r) => r.fired > 0).length;

  return NextResponse.json({
    ok: true,
    accepted: true,
    matched_connections: connections.length,
    events: eventNames,
    fired,
  });
}

function _deriveEventNames(
  changedTablesById: Record<string, unknown>
): string[] {
  const events = new Set<string>();

  for (const tableChange of Object.values(changedTablesById)) {
    const tc = (tableChange ?? {}) as Record<string, unknown>;
    if (tc.createdRecordsById && Object.keys(tc.createdRecordsById as object).length > 0) {
      events.add("tableRecords.created");
    }
    if (tc.updatedRecordsById && Object.keys(tc.updatedRecordsById as object).length > 0) {
      events.add("tableRecords.updated");
    }
    if (Array.isArray(tc.destroyedRecordIds) && tc.destroyedRecordIds.length > 0) {
      events.add("tableRecords.destroyed");
    }
    if (tc.changedFieldsById && Object.keys(tc.changedFieldsById as object).length > 0) {
      events.add("tableFields.changed");
    }
    // Generic fallback
    events.add("tableData.changed");
  }

  return events.size > 0 ? [...events] : ["tableData.changed"];
}

async function _resolveConnections(
  baseId: string | null,
  explicitConnectionId: string | null
): Promise<AirtableConnectionRow[]> {
  const db = createServiceClient();

  if (explicitConnectionId) {
    const { data } = await db
      .from("connections")
      .select("id, user_id, metadata")
      .eq("id", explicitConnectionId)
      .eq("provider", "airtable")
      .eq("is_valid", true)
      .single();
    if (!data) return [];
    return [data as unknown as AirtableConnectionRow];
  }

  const { data: rows } = await db
    .from("connections")
    .select("id, user_id, metadata")
    .eq("provider", "airtable")
    .eq("is_valid", true);

  const all = (rows ?? []) as unknown as AirtableConnectionRow[];

  if (!baseId) return all;

  const scoped = all.filter((row) => {
    const bases = row.metadata?.base_ids;
    if (!Array.isArray(bases)) return false;
    return bases.includes(baseId);
  });
  return scoped.length > 0 ? scoped : all;
}
