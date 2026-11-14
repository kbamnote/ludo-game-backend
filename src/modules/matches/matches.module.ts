import { Module } from '@nestjs/common';
import { MatchesController } from './matches.controller';
import { MatchmakeController } from './matchmake.controller';

/**
 * MatchmakeController is registered here rather than in a realtime module
 * because it is an ordinary HTTP controller: it serves the `/matchmake/*`
 * routes the Colyseus SDK calls before it opens a socket. See that file for
 * why Nest has to serve them at all.
 */
@Module({ controllers: [MatchesController, MatchmakeController] })
export class MatchesModule {}
