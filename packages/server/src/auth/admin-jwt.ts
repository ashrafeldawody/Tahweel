import { SignJWT, jwtVerify } from 'jose';
import { HOUR_MS } from '../config/time.js';

const ALGORITHM = 'HS256';
const ISSUER = 'tahweel';
const AUDIENCE = 'tahweel-admin';

export interface AdminSession {
  sub: string;
  role: 'admin';
  issued_at: string;
  expires_at: string;
}

export class AdminJwt {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly ttlHours: number,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  async issue(): Promise<{ token: string; expires_at: string }> {
    const now = Date.now();
    const expiresAt = new Date(now + this.ttlHours * HOUR_MS);
    const token = await new SignJWT({ role: 'admin' })
      .setProtectedHeader({ alg: ALGORITHM })
      .setSubject('admin')
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(Math.floor(now / 1000))
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.key);
    return { token, expires_at: expiresAt.toISOString() };
  }

  async verify(token: string): Promise<AdminSession | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, audience: AUDIENCE, algorithms: [ALGORITHM] });
      if (payload.role !== 'admin' || typeof payload.sub !== 'string') return null;
      return {
        sub: payload.sub,
        role: 'admin',
        issued_at: new Date((payload.iat ?? 0) * 1000).toISOString(),
        expires_at: new Date((payload.exp ?? 0) * 1000).toISOString(),
      };
    } catch {
      return null;
    }
  }
}
