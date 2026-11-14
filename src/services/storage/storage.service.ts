/**
 * Object storage adapter.
 *
 * Phase 3 ships a local-disk implementation so the whole avatar pipeline runs
 * without cloud credentials. The interface is the S3-shaped one we will keep,
 * so moving to S3/R2/GCS in Phase 8 is a new class behind the same methods.
 *
 * ── Privacy obligations this class carries ──────────────────────────────────
 * - Nothing it writes is publicly reachable. Delivery is via short-lived
 *   signed URLs only.
 * - `delete` is a real delete. Avatars and source photos must be removable on
 *   request, and a soft flag does not satisfy that.
 * - Source photos are written under `uploads/` and removed the moment a
 *   generation job reaches a terminal state.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve as resolvePath, sep } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';

export interface StoredObject {
  data: Buffer;
  contentType: string;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  /**
   * Resolved to an absolute, platform-native path.
   *
   * `resolve` matters: the guard below compares this against a `join`ed path,
   * and `join` always emits native separators. Keeping the raw env value here
   * meant a POSIX-style LUDO_STORAGE_DIR ("/tmp/x") never matched its own
   * joined path ("\tmp\x") on Windows, so every legitimate key was rejected as
   * traversal. Found by a smoke test; the unit tests missed it because
   * mkdtemp already returns a native path.
   */
  private readonly root = resolvePath(
    process.env.LUDO_STORAGE_DIR ?? join(process.cwd(), 'storage', 'local'),
  );

  private readonly signingKey = process.env.LUDO_SIGNING_KEY ?? 'dev-only-insecure-key';

  /**
   * Resolve a key to a path, refusing anything that escapes the root.
   * Keys are partly client-influenced, so `../` traversal is a real risk.
   */
  private resolve(key: string): string {
    const safe = normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
    const full = resolvePath(this.root, safe);
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error(`storage key escapes root: ${key}`);
    }
    return full;
  }

  newKey(prefix: string, extension: string): string {
    return `${prefix}/${randomUUID()}.${extension}`;
  }

  async write(key: string, data: Buffer, contentType: string): Promise<void> {
    const path = this.resolve(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    await writeFile(`${path}.meta`, JSON.stringify({ contentType }), 'utf8');
  }

  async read(key: string): Promise<StoredObject> {
    const path = this.resolve(key);
    const [data, meta] = await Promise.all([
      readFile(path),
      readFile(`${path}.meta`, 'utf8').catch(() => '{}'),
    ]);
    return { data, contentType: JSON.parse(meta).contentType ?? 'application/octet-stream' };
  }

  /** Hard delete. Missing objects are not an error — deletion is idempotent. */
  async delete(key: string): Promise<void> {
    const path = this.resolve(key);
    await rm(path, { force: true });
    await rm(`${path}.meta`, { force: true });
    this.logger.log(`deleted ${key}`);
  }

  async deletePrefix(prefix: string): Promise<void> {
    await rm(this.resolve(prefix), { recursive: true, force: true });
    this.logger.log(`deleted prefix ${prefix}`);
  }

  /**
   * Short-lived signed URL.
   *
   * The signature covers the key AND the expiry, so neither can be edited
   * without invalidating it — signing the key alone would let anyone extend
   * the lifetime indefinitely.
   */
  signUrl(key: string, expiresInSeconds = 3600): { url: string; expiresInSeconds: number } {
    const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const signature = createHmac('sha256', this.signingKey)
      .update(`${key}:${expires}`)
      .digest('hex');
    const base = process.env.LUDO_PUBLIC_URL ?? 'http://localhost:3000';
    return {
      url: `${base}/v1/media/${encodeURIComponent(key)}?expires=${expires}&sig=${signature}`,
      expiresInSeconds,
    };
  }

  verifySignature(key: string, expires: number, signature: string): boolean {
    if (!Number.isFinite(expires) || expires * 1000 < Date.now()) return false;
    const expected = createHmac('sha256', this.signingKey)
      .update(`${key}:${expires}`)
      .digest('hex');
    // Constant-time compare would be better; swap in timingSafeEqual when the
    // real storage adapter lands and this path is externally reachable.
    return expected === signature;
  }
}
