/**
 * Avatar pipeline tests.
 *
 * These cover the privacy obligations as much as the happy path, because those
 * are the parts that are easy to quietly break later and expensive to discover
 * in a review: consent must be recorded not implied, the source photo must be
 * destroyed after generation, deletion must be real, and provider internals
 * must never reach a client.
 */
import { Test } from '@nestjs/testing';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AvatarsService, POLICY_VERSION } from '../src/modules/avatars/avatars.service';
import { StorageService } from '../src/services/storage/storage.service';
import { StubAvatarProvider } from '../src/services/avatar-provider/stub.provider';
import { AVATAR_PROVIDER } from '../src/services/avatar-provider/provider.interface';

const USER = 'user_test';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Polls until the background job settles, so tests do not race it. */
async function settle(service: AvatarsService, jobId: string, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = service.getJob(USER, jobId);
    if (job.status === 'succeeded' || job.status === 'failed') return job;
    if (Date.now() > deadline) throw new Error(`job ${jobId} did not settle`);
    await new Promise((r) => setTimeout(r, 80));
  }
}

function consent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    acceptedAt: new Date().toISOString(),
    policyVersion: POLICY_VERSION,
    scope: ['generate_avatar', 'store_avatar'],
    ...overrides,
  } as never;
}

describe('AvatarsService', () => {
  let service: AvatarsService;
  let storage: StorageService;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ludo-avatars-'));
    process.env.LUDO_STORAGE_DIR = dir;
    delete process.env.LUDO_AVATAR_STUB_FAIL;

    const moduleRef = await Test.createTestingModule({
      providers: [
        AvatarsService,
        StorageService,
        StubAvatarProvider,
        { provide: AVATAR_PROVIDER, useExisting: StubAvatarProvider },
      ],
    }).compile();

    service = moduleRef.get(AvatarsService);
    storage = moduleRef.get(StorageService);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function uploadPhoto() {
    const slot = service.createUpload(USER, 'image/png', PNG.byteLength);
    await service.storeUpload(slot.uploadId, USER, PNG);
    return slot;
  }

  describe('upload validation', () => {
    it('rejects a file type that is not an image we accept', () => {
      expect(() => service.createUpload(USER, 'application/pdf', 100)).toThrow(
        /JPEG, PNG or WebP/,
      );
    });

    it('rejects a photo over the size limit', () => {
      expect(() => service.createUpload(USER, 'image/jpeg', 9 * 1024 * 1024)).toThrow(/too large/);
    });

    /**
     * The client must never construct the upload URL itself — that is what
     * lets the local adapter be swapped for an S3/R2 presigned URL later
     * without touching the app.
     */
    it('issues an upload URL addressed by upload id, with a short lifetime', () => {
      const slot = service.createUpload(USER, 'image/jpeg', 1024);
      expect(slot.uploadUrl).toContain(`/v1/avatars/uploads/${slot.uploadId}`);
      expect(slot.expiresInSeconds).toBe(300);
      expect(slot.maxBytes).toBe(8 * 1024 * 1024);
    });

    it('never exposes the storage key in the upload slot', () => {
      const slot = service.createUpload(USER, 'image/jpeg', 1024);
      expect(JSON.stringify(slot)).not.toContain('uploads/user_test/');
    });
  });

  describe('consent', () => {
    it('refuses to generate without consent', async () => {
      const slot = await uploadPhoto();
      await expect(
        service.createJob(USER, slot.uploadId, 'cyber-streetwear', {} as never),
      ).rejects.toThrow(/Explicit consent is required/);
    });

    it('refuses consent for a superseded policy version', async () => {
      const slot = await uploadPhoto();
      await expect(
        service.createJob(
          USER,
          slot.uploadId,
          'cyber-streetwear',
          consent({ policyVersion: '2019-01-01' }),
        ),
      ).rejects.toThrow(/privacy policy has changed/);
    });

    it('refuses a consent timestamp that is not a real date', async () => {
      const slot = await uploadPhoto();
      await expect(
        service.createJob(
          USER,
          slot.uploadId,
          'cyber-streetwear',
          consent({ acceptedAt: 'whenever' }),
        ),
      ).rejects.toThrow(/not a valid date/);
    });
  });

  describe('generation', () => {
    it('produces a private avatar', async () => {
      const slot = await uploadPhoto();
      const { jobId } = await service.createJob(
        USER,
        slot.uploadId,
        'cyber-streetwear',
        consent(),
      );
      const job = await settle(service, jobId);

      expect(job.status).toBe('succeeded');
      expect(job.results).toHaveLength(1);
      expect(job.results[0].visibility).toBe('private');
      expect(job.results[0].url).toContain('sig=');
    });

    it('never puts a storage key in a response', async () => {
      const slot = await uploadPhoto();
      const { jobId } = await service.createJob(USER, slot.uploadId, 'neon-anime', consent());
      const job = await settle(service, jobId);
      expect(JSON.stringify(job)).not.toContain('avatars/');
    });

    /** The source photo must not outlive the job that needed it. */
    it('deletes the source photo once generation finishes', async () => {
      const slot = await uploadPhoto();
      const { jobId } = await service.createJob(USER, slot.uploadId, 'neon-anime', consent());
      await settle(service, jobId);

      const uploads = await readdir(join(dir, 'uploads', USER)).catch(() => []);
      expect(uploads).toEqual([]);
    });

    it('deletes the source photo even when generation fails', async () => {
      process.env.LUDO_AVATAR_STUB_FAIL = 'provider_unavailable';
      const slot = await uploadPhoto();
      const { jobId } = await service.createJob(USER, slot.uploadId, 'neon-anime', consent());
      const job = await settle(service, jobId);

      expect(job.status).toBe('failed');
      const uploads = await readdir(join(dir, 'uploads', USER)).catch(() => []);
      expect(uploads).toEqual([]);
    });

    it('returns a user-safe error without provider internals', async () => {
      process.env.LUDO_AVATAR_STUB_FAIL = 'rejected_content';
      const slot = await uploadPhoto();
      const { jobId } = await service.createJob(USER, slot.uploadId, 'neon-anime', consent());
      const job = await settle(service, jobId);

      expect(job.error?.message).not.toMatch(/http|key|model|token/i);
      expect(job.error?.message).toMatch(/could not generate/i);
    });

    it('refuses to reuse an upload', async () => {
      const slot = await uploadPhoto();
      await service.createJob(USER, slot.uploadId, 'neon-anime', consent());
      await expect(
        service.createJob(USER, slot.uploadId, 'neon-anime', consent()),
      ).rejects.toThrow(/already used/);
    });

    it('rejects an unknown style', async () => {
      const slot = await uploadPhoto();
      const { jobId } = await service.createJob(USER, slot.uploadId, 'not-a-style', consent());
      const job = await settle(service, jobId);
      expect(job.status).toBe('failed');
    });
  });

  describe('ownership', () => {
    it('hides another user’s job', async () => {
      const slot = await uploadPhoto();
      const { jobId } = await service.createJob(USER, slot.uploadId, 'neon-anime', consent());
      expect(() => service.getJob('someone_else', jobId)).toThrow(/Unknown job/);
    });

    it('refuses an upload slot belonging to someone else', async () => {
      const slot = service.createUpload(USER, 'image/png', PNG.byteLength);
      await expect(service.storeUpload(slot.uploadId, 'someone_else', PNG)).rejects.toThrow(
        /Unknown upload/,
      );
    });
  });

  describe('deletion', () => {
    it('removes the stored object, not just the record', async () => {
      const slot = await uploadPhoto();
      const { jobId } = await service.createJob(USER, slot.uploadId, 'neon-anime', consent());
      const job = await settle(service, jobId);
      const id = job.results[0].avatarId;

      expect((await readdir(join(dir, 'avatars', USER))).length).toBeGreaterThan(0);

      await service.remove(USER, id);

      expect(service.list(USER).avatars).toHaveLength(0);
      const left = await readdir(join(dir, 'avatars', USER)).catch(() => []);
      expect(left.filter((f) => !f.endsWith('.meta'))).toEqual([]);
    });

    it('wipes everything for a user on request', async () => {
      const slot = await uploadPhoto();
      const { jobId } = await service.createJob(USER, slot.uploadId, 'neon-anime', consent());
      await settle(service, jobId);

      await service.removeAll(USER);

      expect(service.list(USER).avatars).toHaveLength(0);
      const avatars = await readdir(join(dir, 'avatars', USER)).catch(() => null);
      expect(avatars).toBeNull();
    });

    it('is idempotent', async () => {
      await expect(service.removeAll(USER)).resolves.not.toThrow();
    });
  });

  describe('signed media', () => {
    it('accepts a valid signature', () => {
      const { url } = storage.signUrl('avatars/x/y.jpg', 60);
      const expires = Number(new URL(url).searchParams.get('expires'));
      const sig = new URL(url).searchParams.get('sig')!;
      expect(storage.verifySignature('avatars/x/y.jpg', expires, sig)).toBe(true);
    });

    it('rejects a tampered expiry, so a link cannot be extended', () => {
      const { url } = storage.signUrl('avatars/x/y.jpg', 60);
      const sig = new URL(url).searchParams.get('sig')!;
      const later = Math.floor(Date.now() / 1000) + 99_999;
      expect(storage.verifySignature('avatars/x/y.jpg', later, sig)).toBe(false);
    });

    it('rejects an expired link', () => {
      const past = Math.floor(Date.now() / 1000) - 10;
      expect(storage.verifySignature('avatars/x/y.jpg', past, 'anything')).toBe(false);
    });

    it('refuses a key that escapes the storage root', async () => {
      await expect(storage.read('../../etc/passwd')).rejects.toThrow();
    });
  });
});
