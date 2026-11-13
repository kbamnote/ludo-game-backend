# LUDO AFTER DARK — Server

Backend for **Ludo After Dark**: authentication, player data, AI avatar generation, social
features, progression, and the **authoritative real-time game server**.

**Status:** Phase 0 — skeleton and architecture only. No code yet. Implementation starts at Phase 3.

> **This is one of two repositories.** The Expo client lives in [`ludo-mobile`](../ludo-mobile).
> See [`../README.md`](../README.md) for how they fit together.

---

## Responsibilities

| Area | What it does |
|---|---|
| **Auth** | JWT issue/refresh, OAuth (Apple, Google, Discord), phone OTP, guest accounts |
| **Users** | Profiles, settings, privacy controls |
| **Avatars** | Signed photo upload, AI provider orchestration, storage, **deletion** |
| **Realtime** | Colyseus rooms — turn order, dice, moves, presence, in-room chat |
| **Matchmaking** | Quick match, room codes, private rooms, friend invites |
| **Social** | Friends, requests, blocks, parties, spectating, moderation |
| **Progression** | XP, levels, challenges, achievements, seasons, leaderboards |
| **Store** | Catalogue, purchases, **server-side receipt validation**, entitlements |

---

## The authority rule

The single most important constraint in this repo:

> **The server is authoritative. The client is never trusted.**

- Dice are generated **here**. Clients request a roll; they never report one.
- Every move is validated against the server's own game state before being applied.
- Currency, inventory and entitlements are only ever written by the server.
- The client runs the same rules purely for prediction and animation. Server state always wins.

---

## `@ludo/engine`

`packages/engine/` holds the canonical Ludo rules, shared with the mobile client.

- Plain **JavaScript (ESM) + JSDoc** — no TypeScript syntax, no build step, so the JSX client can
  import it directly and a TS backend can still type-check it.
- **Zero dependencies.** No Node built-ins, no React Native, no I/O. Identical under Hermes and Node.
- **Pure and deterministic:** `(state, action) → newState`, with the RNG injected rather than
  ambient, so every match is reproducible and testable.

Covers board geometry (15×15 grid, 52-cell track, four 5-cell home columns, 8 safe cells), legal
moves, captures, extra turns, three-sixes forfeiture, exact-count home entry, win conditions and
turn sequencing.

**Never reimplement these rules in the mobile repo.** Drift between the two copies produces
rejected-move desyncs — see PROJECT_STATUS §4 and risk S1.

---

## Intended stack

**Node.js** · **NestJS** (REST) · **Colyseus** (WebSocket) · **PostgreSQL** · **Redis** ·
**JWT** · **S3-compatible object storage**

Two entry points, one repo: a stateless API tier and a stateful realtime tier that scale
independently and share the database, engine and auth path.

---

## Structure

```
src/
├─ modules/      auth users avatars friends matches leaderboard store progression moderation
├─ realtime/     rooms/ schema/ matchmaking/     ← Colyseus
├─ services/     storage/ avatar-provider/
├─ common/       guards/ filters/ pipes/
├─ config/  database/  utils/
packages/
└─ engine/       @ludo/engine — shared authoritative rules
test/            unit/ e2e/
```

---

## Security and privacy commitments

These are requirements, not aspirations:

- **No production secrets ever reach the mobile app.** AI provider keys live only here.
- **User photographs are sensitive personal data** — private by default, short-lived signed URLs,
  consent recorded explicitly, and the source photo discarded once an avatar is generated.
- **Deletion is honoured end to end** — database rows, object storage, and caches.
- Rate limiting, input validation and room access control on every public surface.
- Purchase receipts validated server-side. Client-reported entitlements are ignored.
- Errors are never silently swallowed.

---

## Getting started

Not yet applicable — there is no code. Phase 3 will add `package.json`, a `docker-compose.yml` for
local Postgres + Redis, and a `.env.example`.

See [PROJECT_STATUS.md](PROJECT_STATUS.md) for the architecture, roadmap, risk register and open
questions.
