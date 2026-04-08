import { NextResponse } from "next/server";
import { apiError, createServiceClient } from "@/lib/api";
import { getValidOAuthToken } from "@/lib/oauth-token";

// GET /api/internal/connections/[id]/token
// Called by the Python runtime to get a valid (auto-refreshed) OAuth token for a connection.
// Header: x-runtime-secret: <RUNTIME_SECRET>
// Returns: { access_token: string }
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const incomingSecret = request.headers.get("x-runtime-secret");
  const expectedSecret = process.env.RUNTIME_SECRET;
  if (!expectedSecret || incomingSecret !== expectedSecret) {
    return apiError("Unauthorized", 401);
  }

  const { id } = params;
  if (!id) return apiError("Missing connection id", 400);

  const serviceClient = createServiceClient();

  let accessToken: string;
  try {
    accessToken = await getValidOAuthToken(serviceClient, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to retrieve token";
    return apiError(message, 500);
  }

  return NextResponse.json({ access_token: accessToken });
}
