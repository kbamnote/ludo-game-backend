import { Module } from '@nestjs/common';
import { AvatarsController, MediaController } from './avatars.controller';
import { AvatarsService } from './avatars.service';
import { StorageService } from '../../services/storage/storage.service';
import { AVATAR_PROVIDER } from '../../services/avatar-provider/provider.interface';
import { StubAvatarProvider } from '../../services/avatar-provider/stub.provider';

/**
 * Swapping the AI provider happens HERE and nowhere else.
 *
 * Replace StubAvatarProvider with the real implementation and the rest of the
 * server is untouched, because everything depends on the AVATAR_PROVIDER token
 * rather than a concrete class.
 */
@Module({
  controllers: [AvatarsController, MediaController],
  providers: [
    AvatarsService,
    StorageService,
    StubAvatarProvider,
    { provide: AVATAR_PROVIDER, useExisting: StubAvatarProvider },
  ],
  exports: [AvatarsService],
})
export class AvatarsModule {}
