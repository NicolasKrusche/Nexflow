import { createHmac, timingSafeEqual } from "crypto";

export function signWebhookToken(
  payload: Record<string, unknown>,
  secret: string
): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyWebhookToken<T extends Record<string, unknown>>(
  token: string,
  secret: string
): T | null {
  const [encoded, receivedSig] = token.split(".");
  if (!encoded || !receivedSig) return null;

  const expectedSig = createHmac("sha256", secret).update(encoded).digest("base64url");
  const expectedBuf = Buffer.from(expectedSig);
  const receivedBuf = Buffer.from(receivedSig);
  if (expectedBuf.length !== receivedBuf.length) return null;
  if (!timingSafeEqual(expectedBuf, receivedBuf)) return null;

  try {
    const json = Buffer.from(encoded, "base64url").toString("utf-8");
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as T;
  } catch {
    return null;
  }
}
