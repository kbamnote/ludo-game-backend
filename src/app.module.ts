import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AvatarsModule } from './modules/avatars/avatars.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Avatar generation is expensive per call, so the public surface is rate
    // limited from the start rather than after someone finds it.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 30 }]),
    AvatarsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
