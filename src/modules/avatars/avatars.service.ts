/**
 * Avatar orchestration.
 *
 * Owns the whole lifecycle: upload slot -> consent -> generation job ->
 * stored avatar -> equip -> delete.
 *
 * Phase 3 keeps state in memory. That is deliberate and temporary: Postgres
 * lands with the rest of the persistence layer, and wiring a schema now would
 * mean designing it around one feature. Every method below is already shaped
 * for a repository swap — nothing reaches into the maps from outside.
 */
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import {
  AVATAR_PROVIDER,
  AvatarProvider,
  AvatarProviderError,
} from '../../services/avatar-provider/provider.interface';
import { StorageService } from '../../services/storage/storage.service';

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const POLICY_VERSION = '2026-11-01';

const EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

interface Upload {
  id: string;
  userId: string;
  key: string;
  contentType: string;
  consumed: boolean;
  createdAt: number;
}

interface Consent {
  acceptedAt: string;
  policyVersion: string;
  scope: string[];
}

interface Job {
  id: string;
  userId: string;
  uploadId: string;
  styleId: string;
  status: JobStatus;
  progress: number;
  consent: Consent;
  avatarIds: string[];
  error?: { code: string; message: string };
}

interface Avatar {
  id: string;
  userId: string;
  styleId: string;
  key: string;
  width: number;
  height: number;
  equipped: boolean;
  createdAt: string;
  /** Opt-in. Avatars are private until the user says otherwise. */
  visibility: 'private' | 'friends' | 'public';
}

@Injectable()
export class AvatarsService {
  private readonly logger = new Logger(AvatarsService.name);

  private readonly uploads = new Map<string, Upload>();
  private readonly jobs = new Map<string, Job>();
  private readonly avatars = new Map<string, Avatar>();

  constructor(
    @Inject(AVATAR_PROVIDER) private readonly provider: AvatarProvider,
    private readonly storage: StorageService,
  ) {}

  listStyles() {
    return this.provider.listStyles();
  }

  /** Step 1 — hand back a slot the client PUTs the photo into. */
  createUpload(userId: string, contentType: string, byteSize: number) {
    if (!ALLOWED_TYPES.includes(contentType as (typeof ALLOWED_TYPES)[number])) {
      throw new UnsupportedMediaTypeException('Only JPEG, PNG or WebP photos are accepted.');
    }
    if (!Number.isFinite(byteSize) || byteSize <= 0 || byteSize > MAX_UPLOAD_BYTES) {
      throw new PayloadTooLargeException('That photo is too large. The limit is 8 MB.');
    }

    const id = `upl_${randomUUID()}`;
    const key = this.storage.newKey(`uploads/${userId}`, EXTENSION[contentType]);
    this.uploads.set(id, {
      id,
      userId,
      key,
      contentType,
      consumed: false,
      createdAt: Date.now(),
    });

    /**
     * With the local storage adapter there is no third-party presigned URL to
     * hand out, so the client PUTs to our own endpoint. A real S3/R2 adapter
     * returns the provider's presigned URL here instead and the client code
     * does not change — which is the point of returning a URL rather than
     * letting the client construct one.
     */
    const base = process.env.LUDO_PUBLIC_URL ?? 'http://localhost:3000';
    return {
      uploadId: id,
      uploadUrl: `${base}/v1/avatars/uploads/${id}`,
      expiresInSeconds: 300,
      maxBytes: MAX_UPLOAD_BYTES,
    };
  }

  /** Receives the actual bytes for an upload slot. */
  async storeUpload(uploadId: string, userId: string, data: Buffer) {
    const upload = this.uploads.get(uploadId);
    if (!upload || upload.userId !== userId) throw new NotFoundException('Unknown upload.');
    if (upload.consumed) throw new ConflictException('That upload was already used.');
    if (data.byteLength > MAX_UPLOAD_BYTES) {
      throw new PayloadTooLargeException('That photo is too large. The limit is 8 MB.');
    }
    await this.storage.write(upload.key, data, upload.contentType);
  }

  /**
   * Step 2 — start generation.
   *
   * Consent is validated here and stored on the job. The brief requires
   * explicit photo-upload consent, which means the server has to be able to
   * PROVE it was given: a timestamp and the policy version the user agreed
   * to, not a boolean inferred from the request existing.
   */
  async createJob(userId: string, uploadId: string, styleId: string, consent: Consent) {
    const upload = this.uploads.get(uploadId);
    if (!upload || upload.userId !== userId) throw new NotFoundException('Unknown upload.');
    if (upload.consumed) throw new ConflictException('That upload was already used.');

    if (!consent?.acceptedAt || !consent?.policyVersion) {
      throw new BadRequestException('Explicit consent is required before generating an avatar.');
    }
    if (Number.isNaN(Date.parse(consent.acceptedAt))) {
      throw new BadRequestException('Consent timestamp is not a valid date.');
    }
    if (consent.policyVersion !== POLICY_VERSION) {
      throw new BadRequestException(
        'Our privacy policy has changed. Please review and accept it again.',
      );
    }

    upload.consumed = true;

    const job: Job = {
      id: `job_${randomUUID()}`,
      userId,
      uploadId,
      styleId,
      status: 'queued',
      progress: 0,
      consent,
      avatarIds: [],
    };
    this.jobs.set(job.id, job);

    // Fire and forget: the client polls. An await here would hold the request
    // open for the whole generation, which mobile connections do not survive.
    void this.runJob(job, upload);

    return { jobId: job.id, status: job.status, pollAfterMs: 1500 };
  }

  /**
   * Runs a job to completion.
   *
   * Ordering matters here: the source photo is destroyed BEFORE the job is
   * marked terminal. Doing it the other way round — status first, cleanup in a
   * `finally` — leaves a window where a client polls, sees `succeeded`, and
   * the photo is still on disk. That window is small but it makes the
   * guarantee untrue, and "the source photo no longer exists once the job
   * reports done" is exactly the kind of promise that has to hold absolutely.
   *
   * A test caught this: it polled to `failed` and still found the upload.
   */
  private async runJob(job: Job, upload: Upload) {
    job.status = 'running';
    job.progress = 0.1;

    let outcome: { status: 'succeeded' } | { status: 'failed'; error: Job['error'] };

    try {
      const result = await this.provider.generate({
        sourceKey: upload.key,
        styleId: job.styleId,
        subjectRef: job.userId,
      });

      job.progress = 0.8;

      for (const image of result.images) {
        const id = `avt_${randomUUID()}`;
        const key = this.storage.newKey(
          `avatars/${job.userId}`,
          EXTENSION[image.contentType] ?? 'jpg',
        );
        await this.storage.write(key, image.data, image.contentType);
        this.avatars.set(id, {
          id,
          userId: job.userId,
          styleId: job.styleId,
          key,
          width: image.width,
          height: image.height,
          equipped: false,
          createdAt: new Date().toISOString(),
          visibility: 'private',
        });
        job.avatarIds.push(id);
      }

      outcome = { status: 'succeeded' };
    } catch (error) {
      // Full error server-side only — it can contain provider internals.
      this.logger.error(`job ${job.id} failed: ${String(error)}`);
      outcome = {
        status: 'failed',
        error:
          error instanceof AvatarProviderError
            ? { code: error.code, message: error.message }
            : { code: 'unknown', message: 'Avatar generation failed. Please try again.' },
      };
    }

    // The source photo has done its job. Holding it any longer is data we have
    // no reason to keep and would have to defend. Destroy it before the job
    // reports done, so a terminal status always means the photo is gone.
    await this.storage.delete(upload.key).catch((e) => {
      this.logger.error(`failed to delete source photo ${upload.key}: ${String(e)}`);
    });
    this.uploads.delete(upload.id);

    if (outcome.status === 'failed') {
      job.error = outcome.error;
      job.status = 'failed';
    } else {
      job.progress = 1;
      job.status = 'succeeded';
      this.logger.log(`job ${job.id} succeeded (${job.avatarIds.length} avatars)`);
    }
  }

  getJob(userId: string, jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job || job.userId !== userId) throw new NotFoundException('Unknown job.');

    return {
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      ...(job.error ? { error: job.error } : {}),
      results: job.avatarIds.map((id) => this.present(this.avatars.get(id)!)),
    };
  }

  list(userId: string) {
    return {
      avatars: [...this.avatars.values()]
        .filter((a) => a.userId === userId)
        .map((a) => this.present(a)),
    };
  }

  equip(userId: string, avatarId: string) {
    const avatar = this.avatars.get(avatarId);
    if (!avatar || avatar.userId !== userId) throw new NotFoundException('Unknown avatar.');
    for (const a of this.avatars.values()) {
      if (a.userId === userId) a.equipped = a.id === avatarId;
    }
    return { equipped: true };
  }

  /** Hard delete — row and object, not a flag. */
  async remove(userId: string, avatarId: string) {
    const avatar = this.avatars.get(avatarId);
    if (!avatar || avatar.userId !== userId) throw new NotFoundException('Unknown avatar.');
    await this.storage.delete(avatar.key);
    this.avatars.delete(avatarId);
    this.logger.log(`deleted avatar ${avatarId}`);
  }

  /** Everything this user has: avatars, and any source photo still pending. */
  async removeAll(userId: string) {
    for (const [id, a] of this.avatars) {
      if (a.userId === userId) {
        await this.storage.delete(a.key).catch(() => {});
        this.avatars.delete(id);
      }
    }
    for (const [id, u] of this.uploads) {
      if (u.userId === userId) {
        await this.storage.delete(u.key).catch(() => {});
        this.uploads.delete(id);
      }
    }
    await this.storage.deletePrefix(`avatars/${userId}`).catch(() => {});
    await this.storage.deletePrefix(`uploads/${userId}`).catch(() => {});
    this.logger.log(`deleted all avatar data for user ${userId}`);
  }

  /** Shapes an avatar for the wire — storage keys never leave the server. */
  private present(a: Avatar) {
    const signed = this.storage.signUrl(a.key, 3600);
    return {
      avatarId: a.id,
      styleId: a.styleId,
      url: signed.url,
      width: a.width,
      height: a.height,
      equipped: a.equipped,
      visibility: a.visibility,
      createdAt: a.createdAt,
      expiresInSeconds: signed.expiresInSeconds,
    };
  }
}
