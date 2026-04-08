import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { dispatchEventTriggers } from "@/lib/triggers/dispatch-event";

/**
 * POST /api/triggers/event
 *
 * Body:
 * {
 *   source: string,
 *   event: string,
 *   payload?: Record<string, unknown>,
 *   connection_id?: string,
 *   user_id?: string
 * }
 */
export async function POST(request: Request) {
  const incomingSecret = request.headers.get("x-runtime-secret");
  const expectedSecret = process.env.RUNTIME_SECRET;
  if (!expectedSecret || incomingSecret !== expectedSecret) {
    return apiError("Unauthorized", 401);
  }

  let body: {
    source: string;
    event: string;
    payload?: Record<string, unknown>;
    connection_id?: string;
    user_id?: string;
  };
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON body", 400);
  }

  const { source, event, payload = {}, connection_id, user_id } = body;
  if (!source || !event) return apiError("source and event are required", 400);

  try {
    const result = await dispatchEventTriggers({
      source,
      event,
      payload,
      connection_id,
      user_id,
    });
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to dispatch event";
    return apiError(message, 500);
  }
}
