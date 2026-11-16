# LUDO AFTER DARK (Server) — Project Status

**Phase:** 3 — Avatar system (backend complete, awaiting Phase 4)
**Audit date:** 2026-11-13
**Repository:** `ludo-server` — `D:\Print World\ludo-game\ludo-server`
**Sibling repository:** `ludo-mobile` — see `../ludo-mobile/PROJECT_STATUS.md`

> This document covers the **backend only**. Design, asset and UI findings live in the
> `ludo-mobile` repo. Workspace-level orientation is in `../README.md`.

---

## 1. Executive summary

**Nothing exists yet.** No server code, no database, no schema, no Colyseus rooms, no migrations,
no deployment. This repo was created during Phase 0 as a directory skeleton and documentation only,
so that backend work has a home from day one rather than being retrofitted at Phase 5.

The repo is initialised on `main` with a `.gitignore`. It has no remote.

Backend code is **not** written during Phases 1–2, which are mobile-only. The first real server work
is **Phase 3** (avatar generation and storage), because that is the first feature that genuinely
cannot be done client-side: the AI provider keys must never ship in the app.

**One decision carries over from the repo split and should be settled now:** this repo owns
`packages/engine`, the shared `@ludo/engine` Ludo rules package consumed by both sides. See §4.

---

## 2. What already exists

Directory skeleton and this document. No `package.json`, no dependencies, no source files.

```
ludo-server/
├─ .gitignore
├─ PROJECT_STATUS.md           this file
├─ README.md
├─ docs/                       API_CONTRACT.md lands at Phase 3
├─ src/
│  ├─ modules/                 feature modules (REST / business logic)
│  │  ├─ auth/                 JWT issue + refresh, OAuth, phone OTP
│  │  ├─ users/                profile, settings, privacy
│  │  ├─ avatars/              upload intake, provider orchestration, deletion
│  │  ├─ friends/              requests, blocks, presence
│  │  ├─ matches/              history, results, replays
│  │  ├─ leaderboard/          global / friends / weekly cup, seasons
│  │  ├─ store/                catalogue, purchases, receipt validation
│  │  ├─ progression/          XP, levels, challenges, achievements, battle pass
│  │  └─ moderation/           reports, chat filtering, bans
│  ├─ realtime/                Colyseus — the authoritative game surface
│  │  ├─ rooms/                LudoRoom, LobbyRoom, SpectatorRoom
│  │  ├─ schema/               Colyseus @type state (synced to clients)
│  │  └─ matchmaking/          queueing, skill banding, room allocation
│  ├─ services/
│  │  ├─ storage/              S3/R2/GCS adapter for photos + avatars
│  │  └─ avatar-provider/      swappable AI image-generation interface
│  ├─ common/                  guards/ filters/ pipes/ — auth, rate limit, validation
│  ├─ config/                  typed env loading
│  ├─ database/                entities/ + migrations/
│  └─ utils/
├─ packages/
│  └─ engine/                  @ludo/engine — shared authoritative Ludo rules
│     ├─ src/rules/  src/board/  src/dice/
│     └─ test/
└─ test/                       unit/ + e2e/
```

---

## 3. Proposed architecture

### 3.1 Two processes, one repo

| Process | Responsibility | Protocol |
|---|---|---|
| **API** (NestJS) | Auth, profiles, avatars, friends, store, progression, leaderboards, moderation | HTTPS / REST |
| **Realtime** (Colyseus) | Live match state, turn order, dice, moves, presence, in-room chat | WebSocket |

They share the database, the engine package, and the JWT verification path, but scale separately —
the realtime tier is stateful and sticky, the API tier is not. Keeping them as separate entry points
in one repo avoids a premature microservice split while leaving the seam where it will be needed.

### 3.2 Authority model

Non-negotiable, and the reason the engine lives here:

- Dice are generated **server-side**. A client never sends a roll result, only a *request* to roll.
- Every move is validated against the server's own copy of the game state before it is applied.
- The client's engine copy is for **prediction and presentation only**. Server state always wins.
- Room state is the single source of truth; reconnecting clients resync from it.

Planned integrity measures: per-socket rate limiting on roll/move, monotonic turn sequence numbers
to reject replays, server-side turn timers, and (for ranked) a seeded, auditable RNG so dice rolls
can be verified after the fact — the Stitch onboarding screen already advertises "PROVABLY FAIR
DICE", so this is a product promise, not just hygiene.

### 3.3 Data stores

| Store | Use |
|---|---|
| **PostgreSQL** | Users, avatars, friendships, matches, results, inventory, purchases, progression, reports |
| **Redis** | Matchmaking queues, presence, room registry, rate-limit counters, leaderboard sorted sets, sessions |
| **Object storage** | Uploaded photos (short-lived) and generated avatars (private by default) |

---

## 4. The shared engine — `packages/engine`

This repo owns the canonical Ludo rules, published as **`@ludo/engine`** and consumed by both sides.

**Why here:** the server is authoritative, so the rules are the server's domain. Putting them in the
mobile repo would invert ownership; putting them in a third repo would exceed the two-repo structure
you asked for. Both alternatives remain open — see `../ludo-mobile/PROJECT_STATUS.md` §7.4.

**Constraints on this package:**

- Plain **JavaScript (ESM) with JSDoc types** — no TypeScript syntax, no build step. This lets the
  JSX mobile app import it directly while a TypeScript backend still type-checks it via
  `allowJs` + `checkJs`.
- **Zero dependencies.** No React Native imports, no Node built-ins, no I/O, no `Math.random` at
  module scope. Runs identically under Hermes and Node.
- **Pure and deterministic.** `(state, action) → newState`. The RNG is injected, never ambient, so
  matches are reproducible and testable.
- Exhaustively unit-tested here. The mobile repo never re-tests the rules, only the rendering.

**Scope:** board geometry (15×15 grid, 52-cell track, four 5-cell home columns, 8 safe cells),
legal-move calculation, capture, extra turns on a 6, three-sixes forfeiture, home entry requiring an
exact count, win conditions, and full turn sequencing.

> Note from the design audit: the Stitch "3D Gameplay Board" screen is **decorative** and contains
> no usable board geometry. This package derives it mathematically. See `../ludo-mobile` §7.3.

---

## 5. Proposed dependencies

Pinned at Phase 3, not now.

**Runtime:** `@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express`, `@nestjs/config`,
`@nestjs/jwt`, `@nestjs/passport`, `reflect-metadata`, `rxjs`

**Realtime:** `colyseus`, `@colyseus/core`, `@colyseus/ws-transport`, `@colyseus/schema`,
`@colyseus/redis-driver`, `@colyseus/redis-presence`, `@colyseus/monitor`

**Data:** `pg`, `prisma` or `drizzle-orm`, `ioredis`

**Security:** `argon2`, `helmet`, `@nestjs/throttler`, `zod` or `class-validator`

**Storage / media:** `@aws-sdk/client-s3` (works with S3, R2 and most providers), `sharp`

**Observability:** `pino`, `@sentry/node`, `prom-client`

**Dev:** `typescript`, `jest`, `supertest`, `eslint`, `prettier`, `tsx`, `docker-compose` for local
Postgres + Redis

---

## 6. Backend roadmap

| Phase | Backend scope | Gate |
|---|---|---|
| 0 | Repo created, architecture documented | ◀ **here** |
| 1–2 | *No backend work* — mobile foundation and UI | — |
| **3** | Bootstrap NestJS + Postgres + Redis. Auth. Avatar intake: signed upload, provider orchestration, storage, **deletion**. Keys server-side only. | Mobile completes an avatar end-to-end against a stub provider |
| **4** | Build and fully test `@ludo/engine` headlessly. Publish v0.1.0. | Rules suite green, including edge cases and turn sequencing |
| **5** | Colyseus rooms, matchmaking, room codes, server-authoritative dice/moves, disconnect + reconnect, match persistence | 4 real clients; forced disconnects recover correctly |
| **6** | Friends, parties, presence, chat + moderation, LiveKit tokens, spectator rooms, report/block | Safety controls demonstrable |
| **7** | XP, levels, challenges, achievements, seasons, leaderboards, coins, store, **server-side receipt validation** | No client-trusted currency or entitlement anywhere |
| **8** | Load testing, horizontal scaling, crash + error monitoring, backups, deploy pipeline | Measured under realistic concurrent-room load |

---

## 7. Risk register (backend)

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| S1 | Rules drift between client and server → rejected moves and desyncs | **High** | Single `@ludo/engine` package, pinned by exact version in both repos; cross-repo contract test in CI |
| S2 | Client-trusted dice or movement would make ranked play meaningless | **High** | Server-generated dice, full server-side validation, seeded auditable RNG for ranked |
| S3 | Colyseus rooms are stateful — naive horizontal scaling drops matches | **High** | Redis presence + driver from the start; sticky routing; never assume a single node |
| S4 | **User photographs are sensitive personal data** | **High** | Private-by-default storage, short-lived signed URLs, explicit consent recorded, hard delete honoured end-to-end, source photo discarded after generation |
| S5 | AI provider keys leaking into the client | **High** | Provider calls only ever originate server-side; the app receives results, never credentials |
| S6 | Avatar generation is slow and costly; synchronous requests will time out | Medium | Job queue + async status polling or push; cache aggressively; rate-limit per user |
| S7 | Reconnection handling is the most-skipped and most-noticed multiplayer feature | Medium | Design `allowReconnection` + state resync in Phase 5, not as a Phase 8 patch |
| S8 | Store purchases validated client-side are trivially forged | **High** | Validate Play/App Store receipts server-side; entitlements only ever written by the server |
| S9 | Chat and usernames are an abuse surface for a 16–28 audience | Medium | Moderation module from Phase 6: filtering, rate limits, report queue, blocks, bans |
| S10 | Real-money framing in the design ("entry fee", "winner takes", "$19.99") vs. "wager tier strictly simulated" | Medium | **Needs a product/legal ruling before Phase 7.** Real-money wagering materially changes store-listing and jurisdiction requirements. |
| S11 | No remote configured; work is local-only | Low | Create the remote before Phase 3 |

---

## 9. Phase 3 result — avatars

**Status: complete.** NestJS is bootstrapped and the whole avatar pipeline runs
end to end: upload slot → consent → generation job → stored avatar → equip → delete.

| Check | Result |
|---|---|
| `npx jest` | ✅ **23/23 pass** |
| `npx nest build` | ✅ clean |
| Live smoke test | ✅ PUT 204 → job succeeded → source photo auto-deleted → avatar stored |

### The provider is swappable, as required

`services/avatar-provider/provider.interface.ts` is the only thing the rest of the
server knows about. No vendor type, SDK or error escapes that folder. Changing
provider is **one new file plus one line** in `avatars.module.ts`.

`StubAvatarProvider` ships as the default because which AI provider to use is still
open (§8). Blocking the whole feature on that decision would have been the wrong
trade — with the stub, consent, uploads, the job queue, polling, storage, equip and
delete are all real and tested today.

### Privacy obligations, enforced not promised

| Requirement | How |
|---|---|
| Explicit consent | Recorded with timestamp + policy version on the job. A request without it is **400**, and a stale policy version is rejected. |
| Source photo deleted | Destroyed **before** the job reports terminal, so a client can never see "done" while the photo still exists. |
| Private by default | New avatars are `visibility: 'private'`. Opt-in only. |
| Deletion is real | Hard delete of row **and** object. `DELETE /v1/avatars` wipes everything for a user. |
| No key in the client | The client has no provider URL, key or model name. It talks only to this server. |
| No internals leak | Provider errors are normalised to `AvatarProviderError`; raw messages stay in logs. |

### Three bugs the tests and smoke run caught

1. **Terminal-before-cleanup.** The job was marked `succeeded`/`failed` and *then*
   the source photo deleted, leaving a window where a polling client sees "done"
   while the photo is still on disk. Reordered so the guarantee actually holds.
2. **Upload URL pointed at the wrong route** — the media `GET` instead of the
   upload `PUT`. The client would have uploaded nowhere.
3. **Path-traversal guard rejected every legitimate key on Windows.** It compared
   a raw root against a `join`ed path, so `/tmp/x` never matched `\tmp\x`. The unit
   tests missed it because `mkdtemp` returns a native path; the smoke test found it.

### Deliberately deferred

- **Auth** — `x-user-id` stands in for a verified JWT subject, isolated to one
  helper and hard-refused when `NODE_ENV=production`.
- **Persistence** — in-memory maps. Every method is already shaped for a repository
  swap; designing the schema around one feature would be premature.
- **Real object storage** — local-disk adapter behind the S3-shaped interface.

---

## 8. Open questions

1. **Engine home** — confirm `@ludo/engine` lives here (recommended), or should it get its own repo?
2. **Language** — TypeScript for this repo? NestJS is TS-first and server-authoritative validation
   benefits from types. The brief's "prefer JSX over TypeScript" was stated under *Mobile*.
   Recommend TS here, JSX for mobile, plain JS + JSDoc for the shared engine.
3. **NestJS or Express?** The brief allows either. Recommend **NestJS** — modules, DI, guards and
   validation pipes map cleanly onto nine feature areas and keep auth/rate-limiting consistent.
4. **ORM** — Prisma (better DX, strong migrations) or Drizzle (lighter, closer to SQL)?
5. **Hosting** — where will this run, and where do Postgres and Redis live? This affects the
   storage adapter and the Colyseus scaling approach.
6. **Avatar AI provider** — any preference, or budget/latency constraints I should design to?
7. **Wagering** (S10) — purely virtual currency, or is real money in scope?
8. **Git remote** — host and repo name.

---

## 10. Phase 5 result — real-time multiplayer

Server-authoritative multiplayer is implemented and verified end to end: two
signed-in clients join one room, ready up, and play turns the server decides.

### What landed

| Piece | File | Note |
|---|---|---|
| Guest auth | `src/modules/auth/*` | `POST /v1/auth/guest` mints a 30-day JWT from a device id; `JwtGuard` protects every avatar route. This replaces the `x-user-id` stand-in that made the deployed avatar routes answer 401. |
| Room state | `src/realtime/schema/LudoState.ts` | Tokens, players, turn, roll, turn phase, ranking, pot. No RNG seed — verified by test. |
| The game | `src/realtime/rooms/LudoRoom.ts` | Server rolls and validates; clients send intentions only. Turn timer, bot fill, drop/reconnect. |
| Colyseus bootstrap | `src/realtime/realtime.ts` | Shares Nest's HTTP server, so one port serves REST and WebSocket. |
| Matchmaking over HTTP | `src/modules/matches/matchmake.controller.ts` | Nest serves `/matchmake/*`. See below — without it, nothing could join. |
| Engine dependency | `src/realtime/engine.ts` | One module names the engine path; everything else imports from it. |

### Four problems worth recording

1. **Matchmaking returned 404 for every request.** A Colyseus client POSTs to
   `/matchmake/joinOrCreate/<room>` *before* opening a socket. Colyseus serves
   those routes from its own listener, but this deployment shares Nest's single
   HTTP server and `WebSocketTransport` attached to an existing server handles
   only the `upgrade` event. Express answered everything else. Fixed by serving
   them in Nest through `matchMaker.controller.invokeMethod`, the API Colyseus
   publishes for exactly this.

2. **State never synced, silently.** `@colyseus/schema` 5's `@type` decorators
   are *standard* (stage-3) decorators recording field types under
   `Symbol.metadata`. NestJS requires *legacy* decorators for its DI, and the
   two cannot be enabled in one compilation. Compiled as legacy, `@type`
   records nothing and the encoder throws
   `Cannot read properties of undefined (reading 'Symbol(Symbol.metadata)')`
   on every patch — clients join successfully and no state ever arrives. Fixed
   with `defineTypes`, the decorator-free API, plus
   `useDefineForClassFields: false` so field initializers do not shadow the
   accessors it installs.

3. **`CloseCode.CONSENTED` is 4000, not 1000.** The first implementation read
   the close code in `onLeave` to tell a deliberate leave from a dropped
   connection, and had it backwards. Colyseus 0.18 separates the two: `onDrop`
   for a lost connection (where `allowReconnection` belongs) and `onLeave` for
   a deliberate one. Now split accordingly, with the bot takeover in `onLeave`
   only, so it happens exactly once after a failed reconnection.

4. **`fillWithBots` was declared and never implemented.** Two players got a
   two-handed game on a board drawn for four, with two empty houses — while the
   lobby screen promises "auto-fill active". `addBots()` now fills every empty
   seat at start, and a lone ready player waits `LOBBY_FILL_SECONDS` (15) for a
   human before starting against CPUs rather than waiting forever.

### Verified

Against the compiled build (`dist/src/main.js`, as production runs it):

- `/health`, `/`, `/v1/avatars/styles` → 200; guest sign-in → 201
- `joinOrCreate` → 200 with a seat reservation; no token → 523 `AUTH_FAILED`;
  an unexposed matchmaker method → 404
- Two clients in one room; distinct seats; room code assigned
- No `seed`/`rng` field in synced state
- Match starts when all are ready; turn clock set; empty seats become CPUs
- A roll from the wrong seat is ignored; the server's die is 1–6
- A legal move applies and is narrated; a forged token id changes nothing
- A deliberate leave hands the seat to a bot

### Still deferred

- **Persistence** — still in-memory. Restarting the server loses users,
  avatars and matches, though issued JWTs keep verifying.
- **Horizontal scale** — one Colyseus process, no Redis presence/driver.
- **Wagering** — the pot is displayed and counted; no balance is debited.
- **Server lint** — `npm run lint` has no eslint config in this repo and has
  never run. Pre-existing.

### Lobby deadlock — a bot seat counted as a vote it could never cast

Caught by playing a second match against a running server, not by the first
end-to-end run, which only ever used a clean room.

`handleReady` started the match when **every** player in state was ready. But a
player who drops is kept in state and, once their reconnection window lapses,
marked `bot = true`. A bot never sends `ready`. So any room that had ever held a
dropped player could never start again: everyone else sat on "waiting for
players" indefinitely, with nothing in any log to say why.

Two changes, because the single root cause has two faces:

- **Readiness counts only connected, non-bot players** (`startIfEveryoneReady`).
  A seat that cannot answer must not be waited on.
- **A player who drops or leaves during the lobby is removed outright**, freeing
  the seat, rather than being held for 60 seconds or botted. There is no game in
  progress to need that seat played, and holding it delays everyone. The
  reconnection hold and the bot takeover now apply only once a match is
  actually running.

Verified against the live dev server over LAN: solo join → ready → 15s fill
window → three CPUs seated → full 16-token board → turn clock → CPUs take their
own turns → turn returns to the human with a fresh clock.

### Note: `defineTypes()` is deprecated

`@colyseus/schema` 5 logs a deprecation for `defineTypes()` at boot and points
to `schema()` with `t.*` field builders. It still works and state syncs
correctly; the warning is cosmetic today.

Not migrated yet, deliberately: `schema()` returns a constructor rather than a
class to extend, so `TokenState`/`PlayerState` stop being classes and the change
ripples through `LudoRoom.ts`'s imports, instantiation and type annotations. It
is worth doing before the next major bump of that package, as its own change
with the end-to-end check run afterwards — not folded into a phase while
multiplayer is being tested.

`@type` decorators remain unusable here regardless; see §10 for why.

### Invites — private rooms by code

Quick match pairs players only by stake tier and only if they queue inside the
same fill window, so there was no way to arrange a game with a specific person.
This closes that.

| Change | Why |
|---|---|
| `LudoRoomOptions.autoStart` | A private room must NOT start against CPUs after 15 seconds — the friend holding the code is still finding their phone. Quick match keeps the window; private rooms wait. |
| `PlayerState.isHost` | Set on the first player in. Only the host may `start` a private match early; any guest could otherwise start it the moment they arrived, before the invited players had joined. |
| `start` message | The host's escape hatch, since a private room never auto-starts. Server-enforced, not just hidden in the UI. |
| Host succession in `removePlayer` | A private room whose host walked out had nobody able to start it. The lowest remaining seat inherits. |

### The fill timer used to give up

`armFillTimer` once re-checked that everyone was ready when it fired and
returned silently if they were not — leaving no timer behind. So a player who
joined and then idled pinned a ready player in the lobby indefinitely.

The window is a promise that the wait is bounded, so it now starts the match
with whoever is present. An unready player is dropped onto a board they queued
for, with the turn clock running, which is strictly better than everyone
waiting on someone who may never tap anything.

### Verified against the live dev server

Invite flow, 15/15: code minted from the no-vowel alphabet; the creator is
host; a wrong code is **refused rather than silently opening a new empty room**
(`join`, never `joinOrCreate`); a private room still in lobby after 17s with the
host ready alone; guest joins by code into the same roomId; pot counts both
humans; two ready humans start immediately; both keep their seats and CPUs take
the rest; the idle player cannot roll.

Quick match re-checked afterwards, 14/14 — the timer refactor did not change
its behaviour.

### Play Store prerequisites (server side)

| Added | Route |
|---|---|
| Privacy policy | `GET /privacy` |
| Account deletion info | `GET /account-deletion` |
| Account deletion | `DELETE /v1/auth/me` (auth) |

**The legal pages are served by this server** rather than hosted separately, so
they exist the moment it is deployed — no second host, no domain, and no risk
of the policy describing behaviour the code no longer has, since they are
versioned together. The policy is written from what the avatars service
actually does: the source photo is deleted as soon as generation finishes,
consent is recorded with a timestamp and policy version, media is served only
behind a signed expiring URL, and there are no advertising or analytics SDKs.

**Deletion order matters.** `deleteMe` removes avatars and stored photos first,
then the identity. Reversed, a failure midway would strand images belonging to
a user id nothing could resolve any more — undeletable, because the only handle
on them had just been thrown away.

`AuthService.deleteAccount` deletes the **device mapping**, not just the user.
The device id is the only credential, so leaving the mapping would silently
resurrect the account on the next sign-in.

Verified, 6/6: `DELETE /v1/auth/me` returns 204; the same device id afterwards
yields a **different** user id; deleting twice is not an error; deletion without
a token is 401. Both pages return 200 as HTML, and `example.com` appears
nowhere.

Still outstanding before external testers: push and redeploy to Railway, set
`LUDO_JWT_SECRET` and `LUDO_SIGNING_KEY`, pin to one replica, and set
`LUDO_CONTACT_EMAIL` (the policy falls back to privacy@ludoafterdark.app, which
must be a mailbox that is actually read).
