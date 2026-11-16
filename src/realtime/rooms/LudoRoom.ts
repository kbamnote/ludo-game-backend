/**
 * LudoRoom — the authoritative game.
 *
 * ── The rule this file exists to enforce ────────────────────────────────────
 * The server rolls the dice and validates every move. A client sends
 * INTENTIONS ("I want to roll", "I want to move token 0-2") and the server
 * decides what actually happens. A client-reported dice value is never read,
 * because a value a client can choose is a value a client can cheat with.
 *
 * The rules themselves live in the shared engine, the same code the app uses
 * for prediction. One implementation, not two — if they diverged, clients
 * would propose moves the server rejects, which is the worst class of
 * multiplayer bug (risk R11).
 *
 * ── Why turn timers matter ──────────────────────────────────────────────────
 * A player who closes the app mid-turn would otherwise freeze the match for
 * everyone else forever. Every turn has a deadline; on expiry the server plays
 * for them. The game always progresses.
 */
import { Room, Client } from '@colyseus/core';
import { ArraySchema } from '@colyseus/schema';

import {
  Phase,
  createGame,
  roll as engineRoll,
  move as engineMove,
  chooseCpuMove,
  tokensHome,
  PLAYERS,
  TOKENS_PER_PLAYER,
  type GameState,
  type EngineResult,
  type EngineEvent,
} from '../engine';

import { LudoState, PlayerState, TokenState } from '../schema/LudoState';
import type { AuthService, TokenPayload } from '../../modules/auth/auth.service';

/** Seconds a player gets per turn before the server acts for them. */
const TURN_SECONDS = 20;
/** How long a disconnected player's seat is held before a bot takes over. */
const RECONNECT_SECONDS = 60;
/** Pause before a bot acts, so a turn is readable rather than instant. */
const BOT_THINK_MS = 800;
/** How long a lone ready player waits for a human before CPUs fill in. */
const LOBBY_FILL_SECONDS = 15;

export interface LudoRoomOptions {
  roomCode?: string;
  entryFee?: number;
  maxPlayers?: number;
  fillWithBots?: boolean;
  /**
   * Whether a lone ready player is started against CPUs after
   * LOBBY_FILL_SECONDS.
   *
   * True for quick match, where the player asked for a game and not for a
   * wait. False for a private room, where the entire point is the friend who
   * has been sent a code and is still finding their phone — auto-starting
   * after fifteen seconds would make every invite useless. A private host
   * starts the match themselves with `start`.
   */
  autoStart?: boolean;
}

/**
 * Room metadata — the only fields matchmaking may filter or sort on. Declaring
 * it in the room's generic is what lets `.filterBy()` be type-checked instead
 * of accepting any string and failing silently at runtime.
 */
export interface LudoRoomMetadata {
  roomCode: string;
  entryFee: number;
}

export class LudoRoom extends Room<{ state: LudoState; metadata: LudoRoomMetadata }> {
  maxClients = 4;

  /** Injected by the Colyseus bootstrap so sockets verify with the same service as HTTP. */
  static authService: AuthService;

  /**
   * Engine state. Deliberately NOT in the schema — clients get the view, not
   * the machine. The initial value is a throwaway: `startGame` replaces it
   * with one seeded for the players who actually joined.
   */
  private game: GameState = createGame();
  private seatOf = new Map<string, number>();
  /** Whether empty seats are filled with CPUs when the match starts. */
  private fillWithBots = true;
  /** See LudoRoomOptions.autoStart. */
  private autoStart = true;
  private turnTimer?: NodeJS.Timeout;
  private lobbyTimer?: NodeJS.Timeout;
  private botTimer?: NodeJS.Timeout;

  /**
   * Verifies the token before a seat is reserved.
   *
   * Static, not an instance method. Colyseus 0.18 runs the static `onAuth`
   * during matchmaking — before any room instance exists — and logs that it is
   * IGNORING an instance-level `onAuth` when both are defined. An instance
   * method here would therefore look like a working auth check while
   * authenticating nobody, which is the worst possible failure mode for this
   * particular function.
   *
   * The token arrives in `token` (from the `Authorization` header, where the
   * SDK puts `client.auth.token`) and falls back to a `token` join option, so
   * either client style authenticates through this one path.
   */
  static async onAuth(
    token: string,
    options?: { token?: string },
  ): Promise<TokenPayload> {
    const presented = token || options?.token || '';
    if (!presented) throw new Error('Sign in to join a match.');
    return LudoRoom.authService.verify(presented);
  }

  onCreate(options: LudoRoomOptions) {
    this.setState(new LudoState());
    this.state.roomCode = options.roomCode ?? this.roomId.slice(0, 4).toUpperCase();
    this.state.entryFee = options.entryFee ?? 0;
    this.maxClients = options.maxPlayers ?? 4;
    this.fillWithBots = options.fillWithBots ?? true;
    this.autoStart = options.autoStart ?? true;

    // Matchmaking reads metadata, not room state, so the two fields players are
    // matched on are published here as well as mirrored into state for the UI.
    this.setMetadata({ roomCode: this.state.roomCode, entryFee: this.state.entryFee });

    // Intentions only. Note what is absent: no message carries a dice value.
    this.onMessage('roll', (client) => this.handleRoll(client));
    this.onMessage('move', (client, message: { tokenId?: string }) =>
      this.handleMove(client, message?.tokenId),
    );
    this.onMessage('ready', (client) => this.handleReady(client));
    this.onMessage('start', (client) => this.handleStart(client));
    this.onMessage('emote', (client, message: { id?: string }) => {
      const seat = this.seatOf.get(client.sessionId);
      if (seat === undefined || !message?.id) return;
      // Broadcast only — emotes cannot affect game state, so they are not
      // routed through the engine.
      this.broadcast('emote', { seat, id: String(message.id).slice(0, 24) });
    });
  }

  async onJoin(client: Client, _options?: unknown, auth?: TokenPayload) {
    if (!auth) throw new Error('Sign in to join a match.');

    // A reconnecting player resumes their seat rather than taking a new one.
    const existing = [...this.state.players.values()].find((p) => p.userId === auth.sub);
    if (existing) {
      this.seatOf.set(client.sessionId, existing.seat);
      existing.connected = true;
      existing.bot = false;
      this.broadcast('system', { type: 'rejoined', seat: existing.seat, name: existing.name });
      return;
    }

    if (this.state.phase !== 'lobby') {
      throw new Error('This match has already started.');
    }

    const seat = this.nextFreeSeat();
    if (seat === null) throw new Error('This room is full.');

    const player = new PlayerState();
    player.userId = auth.sub;
    player.name = auth.name;
    player.seat = seat;
    player.connected = true;
    // The first player in opens the room, so they host it. If they leave the
    // lobby, removePlayer hands it to whoever is left rather than stranding a
    // private room with no one able to start it.
    player.isHost = this.state.players.size === 0;
    this.state.players.set(client.sessionId, player);
    this.seatOf.set(client.sessionId, seat);

    // Bots pay no entry fee, so the pot counts humans only.
    this.state.pot = this.humanCount() * this.state.entryFee;
    this.broadcast('system', { type: 'joined', seat, name: auth.name });
  }

  /**
   * An unexpected disconnect holds the seat open rather than ending the match.
   *
   * Mobile networks drop constantly — a tunnel, a lift, a backgrounded app.
   * Ending a game because someone lost signal for four seconds would be the
   * most common way players lose a match, so the seat is kept and a bot covers
   * the turns until they return or the window closes.
   *
   * This is `onDrop`, not `onLeave`: Colyseus 0.18 routes a dropped client here
   * and a deliberate one to `onLeave`, which is the distinction that matters.
   * Reading a close code instead would be guesswork — `CONSENTED` is 4000, not
   * the 1000 one would expect, so a code comparison is easy to get backwards
   * and the failure is invisible until a real player loses a real match.
   */
  async onDrop(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    // Nothing has started, so there is no seat worth holding. Free it: anyone
    // waiting gets the slot, and a ghost cannot hold up the start.
    if (this.state.phase === 'lobby') {
      this.removePlayer(client.sessionId);
      return;
    }

    player.connected = false;
    this.broadcast('system', { type: 'dropped', seat: player.seat, name: player.name });
    // Someone else's turn must still be able to proceed while they are gone.
    this.advanceIfBotTurn();

    try {
      await this.allowReconnection(client, RECONNECT_SECONDS);
      player.connected = true;
      player.bot = false;
      this.broadcast('system', { type: 'rejoined', seat: player.seat, name: player.name });
    } catch {
      // Window elapsed. Colyseus now removes the client, which calls onLeave
      // below — the bot takeover lives there so it happens exactly once.
    }
  }

  /**
   * A deliberate leave, and the final removal after a reconnection window
   * expires. Either way the player is not coming back to this match, so a bot
   * finishes their seat and the others can play on.
   */
  onLeave(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.bot) return;

    // In the lobby the seat is freed rather than botted. A bot seat counts
    // toward readiness and will never become ready, which used to deadlock the
    // room: everyone else sat watching "waiting for players" forever.
    if (this.state.phase === 'lobby') {
      this.removePlayer(client.sessionId);
      return;
    }

    player.connected = false;
    player.bot = true;
    this.broadcast('system', { type: 'left', seat: player.seat, name: player.name });
    this.advanceIfBotTurn();
  }

  /**
   * Takes a player out of the lobby entirely, freeing their seat.
   *
   * Only ever used before a match starts. Once tokens are on the board a seat
   * cannot be vacated — the game needs someone to play it, which is what the
   * bot takeover is for.
   */
  private removePlayer(sessionId: string) {
    const player = this.state.players.get(sessionId);
    if (!player) return;

    const wasHost = player.isHost;

    this.state.players.delete(sessionId);
    this.seatOf.delete(sessionId);
    this.state.pot = this.humanCount() * this.state.entryFee;
    this.broadcast('system', { type: 'left', seat: player.seat, name: player.name });

    // A private room whose host walked out would otherwise have nobody able to
    // start it, leaving everyone else stuck looking at a code.
    if (wasHost) {
      const heir = this.humans().sort((a, b) => a.seat - b.seat)[0];
      if (heir) {
        heir.isHost = true;
        this.broadcast('system', { type: 'host', seat: heir.seat, name: heir.name });
      }
    }

    // Someone who was waiting on this player may now be able to start.
    this.startIfEveryoneReady();
  }

  onDispose() {
    if (this.lobbyTimer) clearTimeout(this.lobbyTimer);
    if (this.turnTimer) clearTimeout(this.turnTimer);
    if (this.botTimer) clearTimeout(this.botTimer);
  }

  /* ── Game flow ────────────────────────────────────────────────────────── */

  private handleReady(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player || this.state.phase !== 'lobby') return;
    player.ready = true;
    this.startIfEveryoneReady();
  }

  /**
   * Starts the match when everyone who can say "ready" has said it.
   *
   * ── Who counts as a vote ────────────────────────────────────────────────
   * Only connected humans. A bot never sends `ready`, and neither does a
   * player who has dropped — so counting either one means the room waits for a
   * message that will never arrive, and everyone else watches "waiting for
   * players" until they give up and close the app.
   */
  private startIfEveryoneReady() {
    if (this.state.phase !== 'lobby') return;

    const humans = this.humans();
    if (humans.length === 0) return;
    if (!humans.every((p) => p.ready)) return;

    if (humans.length >= 2) {
      this.startGame();
      return;
    }

    /*
     * One player, ready, alone. Waiting for a second human forever is the
     * worst outcome: the player sits on a lobby screen with nothing to do and
     * no idea whether anything is happening. Hold the door open briefly for a
     * real opponent, then start against CPUs.
     *
     * A private room does not do this — see LudoRoomOptions.autoStart.
     */
    if (this.autoStart && this.fillWithBots) this.armFillTimer();
  }

  /**
   * Arms the window after which a waiting lobby starts regardless.
   *
   * ── Why it starts regardless ────────────────────────────────────────────
   * This timer once re-checked that everyone was ready before starting, and
   * gave up silently when they were not. So a player who joined and then idled
   * — reading the screen, taking a call — pinned a ready player in the lobby
   * forever, with no timer left to rescue them. The window is a promise that
   * the wait is bounded, so when it elapses the match begins with whoever is
   * present. Nobody is harmed: an unready player is dropped onto a board they
   * queued for, with the turn clock to keep things moving.
   */
  private armFillTimer() {
    if (this.lobbyTimer) return;

    this.lobbyTimer = setTimeout(() => {
      this.lobbyTimer = undefined;
      if (this.state.phase !== 'lobby') return;
      if (this.humans().length === 0) return;
      this.startGame();
    }, LOBBY_FILL_SECONDS * 1000);
  }

  /**
   * `start` — the host begins a private match without waiting out a window.
   *
   * Only the host, because in a four-seat room any guest could otherwise start
   * the game the moment they arrived, before the people the code was sent to
   * had a chance to join.
   */
  private handleStart(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player?.isHost || this.state.phase !== 'lobby') return;
    if (this.humans().length === 0) return;

    this.startGame();
  }

  /** Everyone who can still act on their own behalf. */
  private humans() {
    return [...this.state.players.values()].filter((p) => !p.bot && p.connected);
  }

  /**
   * Fills empty seats with bots so a match is always played on a full board.
   *
   * Without this, two players got a two-handed game on a board drawn for four,
   * with two houses sitting empty — and the lobby screen promises "auto-fill
   * active", so the empty seats would read as a bug rather than a rule.
   *
   * Bots are keyed by seat, not by a session id, because they have no
   * connection. Nothing collides: `seatOf` only ever holds real sessions.
   */
  private addBots() {
    const taken = new Set([...this.state.players.values()].map((p) => p.seat));

    for (let seat = 0; seat < PLAYERS.length && seat < this.maxClients; seat += 1) {
      if (taken.has(seat)) continue;

      const bot = new PlayerState();
      bot.userId = `bot_${seat}`;
      bot.name = `CPU ${seat + 1}`;
      bot.seat = seat;
      bot.connected = true;
      bot.ready = true;
      bot.bot = true;
      this.state.players.set(`bot_${seat}`, bot);
    }
  }

  private startGame() {
    if (this.lobbyTimer) {
      clearTimeout(this.lobbyTimer);
      this.lobbyTimer = undefined;
    }
    if (this.fillWithBots) this.addBots();

    const seats = [...this.state.players.values()].map((p) => p.seat).sort((a, b) => a - b);

    // The seed never leaves the server. Sending it would let any client
    // compute every future roll, which defeats server authority entirely.
    this.game = createGame({ seats, seed: Math.floor(Math.random() * 0xffffffff) });

    this.state.phase = 'playing';
    this.syncTokens();
    this.syncTurn();
    this.broadcast('system', { type: 'started' });
    this.startTurnTimer();
  }

  private handleRoll(client: Client) {
    const seat = this.seatOf.get(client.sessionId);
    if (!this.isActiveSeat(seat)) return;
    if (this.game.phase !== Phase.awaitingRoll) return;

    // The SERVER rolls. The client asked; it did not decide.
    this.applyResult(engineRoll(this.game));
  }

  private handleMove(client: Client, tokenId?: string) {
    const seat = this.seatOf.get(client.sessionId);
    if (!this.isActiveSeat(seat) || !tokenId) return;
    if (this.game.phase !== Phase.awaitingMove) return;

    // engineMove rejects anything not in legalMoves, so a forged token id
    // changes nothing. Validation is not a courtesy here, it is the point.
    this.applyResult(engineMove(this.game, tokenId));
  }

  private applyResult(result: EngineResult) {
    const events = result.events as EngineEvent[];

    if (events.some((e) => e.type === 'rejected')) {
      // Nothing changed. Broadcasting it would tell three other clients to
      // animate a move that did not happen.
      return;
    }

    this.game = result.state;
    this.syncTokens();
    this.syncTurn();

    // Events are the narration the clients animate from.
    for (const event of events) this.broadcast('event', event);

    if (this.game.phase === Phase.finished) {
      this.state.phase = 'finished';
      const winnerSeat = this.game.winner;
      const winner = [...this.state.players.values()].find((p) => p.seat === winnerSeat);
      this.state.winner = winner?.name ?? `Seat ${winnerSeat}`;
      this.broadcast('gameOver', { ranking: this.game.ranking, winner: this.state.winner });
      if (this.turnTimer) clearTimeout(this.turnTimer);
      if (this.botTimer) clearTimeout(this.botTimer);
      return;
    }

    this.startTurnTimer();
    this.advanceIfBotTurn();
  }

  /* ── Timers ───────────────────────────────────────────────────────────── */

  private startTurnTimer() {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    if (this.state.phase !== 'playing') return;

    this.state.turnDeadline = Date.now() + TURN_SECONDS * 1000;

    this.turnTimer = setTimeout(() => {
      if (this.state.phase !== 'playing') return;
      // Out of time: play for them so the match cannot stall.
      this.broadcast('system', { type: 'turnTimeout', seat: this.game.turn });
      this.playAutomatically();
    }, TURN_SECONDS * 1000);
  }

  /** Does the current seat belong to a bot or a disconnected player? */
  private currentSeatIsAutomatic() {
    const player = [...this.state.players.values()].find((p) => p.seat === this.game.turn);
    return !player || player.bot || !player.connected;
  }

  private advanceIfBotTurn() {
    if (this.botTimer) clearTimeout(this.botTimer);
    if (this.state.phase !== 'playing') return;
    if (!this.currentSeatIsAutomatic()) return;

    this.botTimer = setTimeout(() => this.playAutomatically(), BOT_THINK_MS);
  }

  private playAutomatically() {
    if (this.state.phase !== 'playing') return;

    if (this.game.phase === Phase.awaitingRoll) {
      this.applyResult(engineRoll(this.game));
    } else if (this.game.phase === Phase.awaitingMove) {
      const tokenId = chooseCpuMove(this.game);
      if (tokenId) this.applyResult(engineMove(this.game, tokenId));
    }
  }

  /* ── Sync helpers ─────────────────────────────────────────────────────── */

  private syncTokens() {
    if (this.state.tokens.length !== this.game.tokens.length) {
      const tokens = new ArraySchema<TokenState>();
      for (const t of this.game.tokens) {
        const token = new TokenState();
        token.id = t.id;
        token.seat = t.seat;
        token.slot = t.slot;
        token.progress = t.progress;
        tokens.push(token);
      }
      this.state.tokens = tokens;
      return;
    }
    // Patch in place so Colyseus sends only the tokens that moved.
    this.game.tokens.forEach((t, i) => {
      if (this.state.tokens[i].progress !== t.progress) {
        this.state.tokens[i].progress = t.progress;
      }
    });
  }

  private syncTurn() {
    this.state.turn = this.game.turn;
    this.state.roll = this.game.roll ?? 0;
    this.state.turnPhase = this.game.phase;

    this.state.legalTokenIds = new ArraySchema<string>(
      ...this.game.legalMoves.map((m: { tokenId: string }) => m.tokenId),
    );

    if (this.state.ranking.length !== this.game.ranking.length) {
      this.state.ranking = new ArraySchema<number>(...this.game.ranking);
    }

    for (const player of this.state.players.values()) {
      player.tokensHome = tokensHome(this.game, player.seat);
    }
  }

  private isActiveSeat(seat: number | undefined) {
    return seat !== undefined && this.state.phase === 'playing' && this.game.turn === seat;
  }

  private humanCount() {
    return [...this.state.players.values()].filter((p) => !p.bot).length;
  }

  private nextFreeSeat(): number | null {
    const taken = new Set([...this.state.players.values()].map((p) => p.seat));
    for (let i = 0; i < PLAYERS.length && i < this.maxClients; i += 1) {
      if (!taken.has(i)) return i;
    }
    return null;
  }
}

export { TURN_SECONDS, RECONNECT_SECONDS, TOKENS_PER_PLAYER };
