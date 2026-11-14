/**
 * Avatar routes. Implements docs/API_CONTRACT.md.
 *
 * Every route except `styles` and signed media delivery requires a bearer
 * token. Phase 3 used an `x-user-id` header that was deliberately refused when
 * NODE_ENV=production — which is exactly why the deployed avatar routes
 * returned 401. Identity now comes from a token this server minted and can
 * verify.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  RawBodyRequest,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AvatarsService, POLICY_VERSION } from './avatars.service';
import { StorageService } from '../../services/storage/storage.service';
import { JwtGuard } from '../auth/jwt.guard';
import type { TokenPayload } from '../auth/auth.service';

type AuthedRequest = Request & { user?: TokenPayload };

const consentSchema = z.object({
  acceptedAt: z.string(),
  policyVersion: z.string(),
  scope: z.array(z.string()).default([]),
});

const createUploadSchema = z.object({
  contentType: z.string(),
  byteSize: z.number().int().positive(),
});

const createJobSchema = z.object({
  uploadId: z.string(),
  styleId: z.string(),
  consent: consentSchema,
});

@Controller('v1/avatars')
export class AvatarsController {
  constructor(private readonly avatars: AvatarsService) {}

  /** The authenticated user's id, from the token the guard verified. */
  private userId(req: AuthedRequest): string {
    const id = req.user?.sub;
    if (!id) throw new UnauthorizedException('Sign in to continue.');
    return id;
  }

  /** Public: the client needs these before signing in. */
  @Get('styles')
  async styles() {
    return { policyVersion: POLICY_VERSION, styles: await this.avatars.listStyles() };
  }

  @Post('uploads')
  @UseGuards(JwtGuard)
  createUpload(@Req() req: AuthedRequest, @Body() body: unknown) {
    const parsed = createUploadSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid upload request.');
    return this.avatars.createUpload(
      this.userId(req),
      parsed.data.contentType,
      parsed.data.byteSize,
    );
  }

  /** Receives the raw photo bytes for a slot. */
  @Put('uploads/:id')
  @UseGuards(JwtGuard)
  @HttpCode(204)
  async putUpload(
    @Req() req: RawBodyRequest<Request> & AuthedRequest,
    @Param('id') id: string,
  ) {
    const body = req.rawBody ?? (Buffer.isBuffer(req.body) ? req.body : null);
    if (!body?.length) throw new BadRequestException('Empty upload body.');
    await this.avatars.storeUpload(id, this.userId(req), body);
  }

  @Post('jobs')
  @UseGuards(JwtGuard)
  @HttpCode(202)
  async createJob(@Req() req: AuthedRequest, @Body() body: unknown) {
    const parsed = createJobSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Explicit consent is required before generating an avatar.');
    }
    return this.avatars.createJob(
      this.userId(req),
      parsed.data.uploadId,
      parsed.data.styleId,
      parsed.data.consent,
    );
  }

  @Get('jobs/:id')
  @UseGuards(JwtGuard)
  getJob(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.avatars.getJob(this.userId(req), id);
  }

  @Get()
  @UseGuards(JwtGuard)
  list(@Req() req: AuthedRequest) {
    return this.avatars.list(this.userId(req));
  }

  @Post(':id/equip')
  @UseGuards(JwtGuard)
  equip(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.avatars.equip(this.userId(req), id);
  }

  @Delete(':id')
  @UseGuards(JwtGuard)
  @HttpCode(204)
  remove(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.avatars.remove(this.userId(req), id);
  }

  @Delete()
  @UseGuards(JwtGuard)
  @HttpCode(204)
  removeAll(@Req() req: AuthedRequest) {
    return this.avatars.removeAll(this.userId(req));
  }
}

/**
 * Signed media delivery.
 *
 * Deliberately unauthenticated: the signature IS the authorisation, which is
 * what lets an <Image> tag fetch it without a bearer token. Nothing is served
 * without a valid, unexpired signature, so the bucket stays private.
 */
@Controller('v1/media')
export class MediaController {
  constructor(private readonly storage: StorageService) {}

  @Get(':key')
  async get(
    @Param('key') key: string,
    @Query('expires') expires: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ) {
    const decoded = decodeURIComponent(key);
    if (!this.storage.verifySignature(decoded, Number(expires), sig)) {
      throw new NotFoundException();
    }
    const object = await this.storage.read(decoded).catch(() => null);
    if (!object) throw new NotFoundException();

    res.setHeader('Content-Type', object.contentType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(object.data);
  }
}
