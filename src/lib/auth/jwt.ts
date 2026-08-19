import { SignJWT, jwtVerify } from "jose";
import { config } from "@/lib/config";

export interface SessionTokenPayload {
  sub: string; // userId
  sessionId: string;
  organizationId: string;
  role: string;
  [key: string]: unknown;
}

function getSecretKey(): Uint8Array {
  return new TextEncoder().encode(config.auth.jwtSecret);
}

export async function signSessionToken(payload: SessionTokenPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${config.auth.sessionTtlHours}h`)
    .sign(getSecretKey());
}

export async function verifySessionToken(token: string): Promise<SessionTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    return payload as unknown as SessionTokenPayload;
  } catch {
    return null;
  }
}
