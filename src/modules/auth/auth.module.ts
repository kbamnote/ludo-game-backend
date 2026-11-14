import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtGuard } from './jwt.guard';

/**
 * Global so the Colyseus transport can verify socket tokens with the same
 * service the HTTP guard uses. Two verification paths would eventually
 * disagree, and the one that drifts would be the security hole.
 */
@Global()
@Module({
  imports: [
    JwtModule.register({
      secret: process.env.LUDO_JWT_SECRET ?? 'dev-only-insecure-jwt-secret',
      signOptions: { expiresIn: '30d' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtGuard],
  exports: [AuthService, JwtGuard, JwtModule],
})
export class AuthModule {}
