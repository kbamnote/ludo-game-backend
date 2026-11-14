/**
 * Avatar routes. Implements docs/API_CONTRACT.md.
 *
 * Auth is a placeholder in Phase 3 — `x-user-id` stands in for a verified JWT
 * subject until the auth module lands. It is isolated in one helper below so
 * there is exactly one line to replace, and it refuses to run outside
 * development so it cannot reach production by accident.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  RawBodyRequest,
  Req,
  Res,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AvatarsService, POLICY_VERSION } from './avatars.service';
import { StorageService } from '../../services/storage/storage.service';

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
  constructor(
    private readonly avatars: AvatarsService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Phase 3 stand-in for a verified JWT subject.
   * Replace this body with the JWT guard's `req.user.sub` when auth lands.
   */
  private userId(header?: string): string {
    if (process.env.NODE_ENV === 'production') {
      throw new UnauthorizedException('Authentication is not configured.');
    }
    if (!header) throw new UnauthorizedException('Missing x-user-id (dev auth stand-in).');
    return header;
  }

  @Get('styles')
  async styles() {
    return { policyVersion: POLICY_VERSION, styles: await this.avatars.listStyles() };
  }

  @Post('uploads')
  createUpload(@Headers('x-user-id') user: string, @Body() body: unknown) {
    const parsed = createUploadSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid upload request.');
    return this.avatars.createUpload(
      this.userId(user),
      parsed.data.contentType,
      parsed.data.byteSize,
    );
  }

  /** Receives the raw photo bytes for a slot. */
  @Put('uploads/:id')
  @HttpCode(204)
  async putUpload(
    @Headers('x-user-id') user: string,
    @Param('id') id: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const body = req.rawBody ?? (Buffer.isBuffer(req.body) ? req.body : null);
    if (!body?.length) throw new BadRequestException('Empty upload body.');
    await this.avatars.storeUpload(id, this.userId(user), body);
  }

  @Post('jobs')
  @HttpCode(202)
  async createJob(@Headers('x-user-id') user: string, @Body() body: unknown) {
    const parsed = createJobSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Explicit consent is required before generating an avatar.');
    }
    return this.avatars.createJob(
      this.userId(user),
      parsed.data.uploadId,
      parsed.data.styleId,
      parsed.data.consent,
    );
  }

  @Get('jobs/:id')
  getJob(@Headers('x-user-id') user: string, @Param('id') id: string) {
    return this.avatars.getJob(this.userId(user), id);
  }

  @Get()
  list(@Headers('x-user-id') user: string) {
    return this.avatars.list(this.userId(user));
  }

  @Post(':id/equip')
  equip(@Headers('x-user-id') user: string, @Param('id') id: string) {
    return this.avatars.equip(this.userId(user), id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Headers('x-user-id') user: string, @Param('id') id: string) {
    return this.avatars.remove(this.userId(user), id);
  }

  @Delete()
  @HttpCode(204)
  removeAll(@Headers('x-user-id') user: string) {
    return this.avatars.removeAll(this.userId(user));
  }
}

/**
 * Signed media delivery.
 *
 * Separate controller because it is deliberately unauthenticated: the
 * signature IS the authorisation, which is what lets an <Image> tag fetch it
 * without a bearer token. Nothing is served without a valid, unexpired
 * signature, so the bucket stays private.
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
