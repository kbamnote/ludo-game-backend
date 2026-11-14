/**
 * The AI image-generation provider interface.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The brief requires a modular architecture so the AI image-generation
 * provider can be changed without rewriting the app. That only holds if
 * nothing outside this folder knows which provider is in use — so the rest of
 * the server depends on THIS interface and never on a vendor SDK.
 *
 * Concretely, that means:
 *   - no provider type leaks out of `services/avatar-provider/`
 *   - no provider error is rethrown verbatim (see AvatarProviderError)
 *   - no provider URL, key or model name ever reaches a response body
 *
 * Adding a provider is one new file implementing this interface plus one line
 * in the factory. Nothing else changes.
 */

/** A style the user can pick. Served to the client from /v1/avatars/styles. */
export interface AvatarStyle {
  id: string;
  name: string;
  blurb: string;
  /** Public preview thumbnail. Not the user's own image. */
  preview?: string;
}

export interface GenerateRequest {
  /** Where the source photo lives, resolvable by the storage adapter. */
  sourceKey: string;
  styleId: string;
  /** Opaque per-user value so a provider can rate-limit or trace abuse. */
  subjectRef: string;
}

export interface GeneratedImage {
  /** Raw bytes. The caller stores them; the provider never persists anything. */
  data: Buffer;
  contentType: string;
  width: number;
  height: number;
}

export interface GenerateResult {
  images: GeneratedImage[];
  /** Free-form provider metadata for logs. NEVER returned to a client. */
  diagnostics?: Record<string, unknown>;
}

/**
 * Errors crossing this boundary are normalised.
 *
 * A provider's own error text routinely contains the endpoint, the model name,
 * and sometimes a fragment of the key. Passing that to a client would leak
 * exactly what the brief says must never leave the server, so every
 * implementation wraps failures in this type: `message` is safe to display,
 * `cause` stays server-side for logs.
 */
export class AvatarProviderError extends Error {
  constructor(
    public readonly code:
      | 'rejected_content'
      | 'rate_limited'
      | 'provider_unavailable'
      | 'invalid_source'
      | 'unknown',
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AvatarProviderError';
  }
}

export interface AvatarProvider {
  /** Identifier for logs and metrics. Never sent to a client. */
  readonly id: string;

  /** Styles this provider can produce. */
  listStyles(): Promise<AvatarStyle[]>;

  /**
   * Turn a source photo into one or more avatars.
   * Must throw AvatarProviderError, never a raw SDK error.
   */
  generate(request: GenerateRequest): Promise<GenerateResult>;
}

/** DI token. Consumers inject this, not a concrete class. */
export const AVATAR_PROVIDER = Symbol('AVATAR_PROVIDER');
