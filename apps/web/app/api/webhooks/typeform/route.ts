import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { apiError, createServiceClient } from "@/lib/api";
import { dispatchEventTriggers } from "@/lib/triggers/dispatch-event";

type TypeformConnectionRow = {
  id: string;
  user_id: string;
  metadata: Record<string, unknown> | null;
};

/**
 * POST /api/webhooks/typeform
 *
 * Receives Typeform form_response webhooks.
 * Typeform signs requests with HMAC-SHA256 of the raw body using the webhook
 * secret, delivered in the `Typeform-Signature: sha256=<hex>` header.
 *
 * Required env: TYPEFORM_WEBHOOK_SECRET
 * Optional query param: ?connection_id=<uuid> to scope to one account.
 *
 * Events dispatched:
 *   source: "typeform"  event: "form_response"
 */
export async function POST(request: Request) {
  const webhookSecret = process.env.TYPEFORM_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return apiError("Missing TYPEFORM_WEBHOOK_SECRET", 500);
  }

  const rawBody = await request.text();
  const receivedSignature = request.headers.get("typeform-signature");
  if (!receivedSignature) return apiError("Missing Typeform-Signature header", 401);

  const expectedSignature = `sha256=${createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex")}`;
  const expectedBuf = Buffer.from(expectedSignature);
  const receivedBuf = Buffer.from(receivedSignature);
  if (
    expectedBuf.length !== receivedBuf.length ||
    !timingSafeEqual(expectedBuf, receivedBuf)
  ) {
    return apiError("Invalid Typeform signature", 401);
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return apiError("Invalid JSON body", 400);
  }

  const formResponse = (body.form_response ?? {}) as Record<string, unknown>;
  const formId =
    typeof formResponse.form_id === "string" ? formResponse.form_id : null;

  const url = new URL(request.url);
  const explicitConnectionId = url.searchParams.get("connection_id");

  const connections = await _resolveConnections(formId, explicitConnectionId);
  if (connections.length === 0) {
    return NextResponse.json({ ok: true, accepted: true, matched_connections: 0 });
  }

  const answers = Array.isArray(formResponse.answers) ? formResponse.answers : [];

  await Promise.all(
    connections.map((connection) =>
      dispatchEventTriggers({
        source: "typeform",
        event: "form_response",
        payload: {
          form_id: formId,
          response_id: formResponse.token,
          submitted_at: formResponse.submitted_at,
          landed_at: formResponse.landed_at,
          answers,
          hidden: formResponse.hidden ?? {},
          variables: formResponse.variables ?? {},
          calculated: formResponse.calculated ?? {},
          metadata: formResponse.metadata ?? {},
          definition: (body.form_response as Record<string, unknown>)?.definition ?? {},
          raw: body,
        },
        connection_id: connection.id,
        user_id: connection.user_id,
      })
    )
  );

  return NextResponse.json({
    ok: true,
    accepted: true,
    matched_connections: connections.length,
    event: "form_response",
  });
}

async function _resolveConnections(
  formId: string | null,
  explicitConnectionId: string | null
): Promise<TypeformConnectionRow[]> {
  const db = createServiceClient();

  if (explicitConnectionId) {
    const { data } = await db
      .from("connections")
      .select("id, user_id, metadata")
      .eq("id", explicitConnectionId)
      .eq("provider", "typeform")
      .eq("is_valid", true)
      .single();
    if (!data) return [];
    return [data as unknown as TypeformConnectionRow];
  }

  const { data: rows } = await db
    .from("connections")
    .select("id, user_id, metadata")
    .eq("provider", "typeform")
    .eq("is_valid", true);

  const all = (rows ?? []) as unknown as TypeformConnectionRow[];

  // If we know the form ID, prefer connections whose metadata records that form
  // being accessible. Fall back to all valid Typeform connections.
  if (!formId) return all;

  const scoped = all.filter((row) => {
    const forms = row.metadata?.form_ids;
    if (!Array.isArray(forms)) return false;
    return forms.includes(formId);
  });
  return scoped.length > 0 ? scoped : all;
}
