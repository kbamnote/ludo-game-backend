/**
 * Authentication.
 *
 * Replaces the Phase 3 `x-user-id` stand-in with real signed tokens. That
 * header is now gone entirely — it was explicitly refused in production, which
 * is why the deployed avatar routes returned 401.
 *
 * ── Scope ───────────────────────────────────────────────────────────────────
 * Guest and device-identity sign-in only. OAuth (Apple/Google/Discord) and
 * phone OTP need provider credentials and a real user table, so they arrive
 * with persistence. What matters for Phase 5 is that every socket and request
 * carries a verifiable identity the server minted — which is the precondition
 * for the server being authoritative at all.
 */
import { randomUUID } from 'node:crypto';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export interface TokenPayload {
  /** Stable user id. */
  sub: string;
  /** Display name shown to other players. */
  name: string;
  guest: boolean;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /**
   * Device id -> user id, so reinstalling the app does not orphan an account
   * and a reconnecting player is recognised as the same person.
   * Moves to Postgres with the rest of persistence.
   */
  private readonly byDevice = new Map<string, TokenPayload>();

  constructor(private readonly jwt: JwtService) {}

  /**
   * Issues a token for a device, minting the device id on a first run.
   *
   * ── Why the server generates it ─────────────────────────────────────────
   * Omit `deviceId` and this creates one. The client then stores what comes
   * back and sends it on every later sign-in.
   *
   * Two reasons it belongs here. First, this id is what re-identifies a
   * returning install, so it must be unguessable — a client-minted id is only
   * as good as the client's randomness, and one built from `Math.random()`
   * would make account takeover a matter of guessing. Second, generating a
   * cryptographic random string on React Native needs a native module
   * (`expo-crypto`), which breaks any dev client or Expo Go build that
   * predates it; the server has `node:crypto` for free.
   *
   * It is still a bearer credential, not proof of a person: whoever presents
   * it is treated as that account. That is acceptable for guests and is
   * precisely why real sign-in is still to come.
   */
  async signInGuest(deviceId?: string, name?: string) {
    const id = deviceId?.trim() || `d_${randomUUID()}`;

    // A client-supplied id this short is a bug or a probe, not an install.
    if (id.length < 8) {
      throw new UnauthorizedException('A device id is required.');
    }

    let user = this.byDevice.get(id);
    if (!user) {
      user = {
        sub: `u_${randomUUID()}`,
        name: name?.trim()?.slice(0, 20) || `Runner${Math.floor(1000 + Math.random() * 9000)}`,
        guest: true,
      };
      this.byDevice.set(id, user);
      this.logger.log(`new guest ${user.sub} (${user.name})`);
    } else if (name?.trim()) {
      user.name = name.trim().slice(0, 20);
    }

    return {
      accessToken: await this.jwt.signAsync(user),
      user: { id: user.sub, name: user.name, guest: user.guest },
      // Echoed even when the client supplied it, so the client has one code
      // path: store whatever comes back.
      deviceId: id,
    };
  }

  /** Verifies a token. Throws rather than returning null, so callers cannot ignore it. */
  async verify(token: string): Promise<TokenPayload> {
    try {
      return await this.jwt.verifyAsync<TokenPayload>(token);
    } catch {
      // Never echo the jwt library's reason: it distinguishes "expired" from
      // "bad signature", which is free information for an attacker.
      throw new UnauthorizedException('Your session has expired. Please sign in again.');
    }
  }
}
