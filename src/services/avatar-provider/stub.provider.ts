/**
 * Stub provider — the default until a real one is chosen.
 *
 * Generates nothing. It returns the source image back with deterministic
 * per-style metadata, after a realistic delay.
 *
 * ── Why ship a stub at all ──────────────────────────────────────────────────
 * Which AI provider to use is still an open question (PROJECT_STATUS §8).
 * Blocking the entire avatar feature on that decision would be the wrong
 * trade: with this stub the whole pipeline — consent, upload, job queue,
 * polling, storage, equip, delete — is real and testable end to end today.
 * Swapping in the real provider later is one file plus one factory line, and
 * nothing in the client or the rest of the server changes.
 *
 * It also makes the failure paths testable, which a live provider makes
 * awkward: set LUDO_AVATAR_STUB_FAIL to a code to force that error.
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  AvatarProvider,
  AvatarProviderError,
  AvatarStyle,
  GenerateRequest,
  GenerateResult,
} from './provider.interface';
import { StorageService } from '../storage/storage.service';

const STYLES: AvatarStyle[] = [
  {
    id: 'cyber-streetwear',
    name: 'Cyber Streetwear',
    blurb: 'Tokyo night-market drip. Reflective visor, oversized tactical layers.',
  },
  {
    id: 'neon-anime',
    name: 'Neon Anime',
    blurb: 'High-contrast cel shading with hard rim light.',
  },
  {
    id: 'chrome-mecha',
    name: 'Chrome Mecha',
    blurb: 'Brushed metal plating and exposed servo detailing.',
  },
  {
    id: 'vapor-royalty',
    name: 'Vapor Royalty',
    blurb: 'Soft gradients, holographic silks, pastel haze.',
  },
];

@Injectable()
export class StubAvatarProvider implements AvatarProvider {
  readonly id = 'stub';

  private readonly logger = new Logger(StubAvatarProvider.name);

  constructor(private readonly storage: StorageService) {}

  async listStyles(): Promise<AvatarStyle[]> {
    return STYLES;
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    if (!STYLES.some((s) => s.id === request.styleId)) {
      throw new AvatarProviderError('invalid_source', 'That avatar style is not available.');
    }

    // Lets tests and manual QA exercise every failure path.
    const forced = process.env.LUDO_AVATAR_STUB_FAIL;
    if (forced) {
      throw new AvatarProviderError(
        forced as never,
        'We could not generate an avatar from that photo. Try a different one.',
      );
    }

    const source = await this.storage.read(request.sourceKey).catch(() => null);
    if (!source) {
      throw new AvatarProviderError('invalid_source', 'That photo is no longer available.');
    }

    // Stand in for real generation latency so the client's polling, progress
    // and cancellation paths are exercised rather than skipped.
    await new Promise((resolve) => setTimeout(resolve, 1200));

    this.logger.log(`stub generate style=${request.styleId} subject=${request.subjectRef}`);

    return {
      images: [
        {
          data: source.data,
          contentType: source.contentType,
          width: 1024,
          height: 1024,
        },
      ],
      diagnostics: { provider: this.id, style: request.styleId, passthrough: true },
    };
  }
}
