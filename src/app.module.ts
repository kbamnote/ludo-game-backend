import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AvatarsModule } from './modules/avatars/avatars.module';
import { HealthController } from './health.controller';
import { AuthModule } from './modules/auth/auth.module';
import { MatchesModule } from './modules/matches/matches.module';
import { LegalController } from './modules/legal/legal.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Avatar generation is expensive per call, so the public surface is rate
    // limited from the start rather than after someone finds it.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 30 }]),
    AuthModule,
    AvatarsModule,
    MatchesModule,
  ],
  // The privacy policy and account-deletion pages are served from this server
  // so they exist the moment it is deployed — Google Play requires both as
  // live URLs, and a second host is one more thing to go stale.
  controllers: [HealthController, LegalController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
