# Poker

Free online Texas Hold'em service. The repository started with only `develop-prompt.md`; no existing application, framework, tests, or deployment configuration was present.

## Current implementation

The first foundation is a dependency-light TypeScript poker core: a 52-card deck, cryptographically shuffled cards, five-to-seven-card hand evaluation, tie comparison, side-pot construction, deterministic odd-chip splitting, and betting-round transitions for blinds, calls, bets, raises, short all-ins, and folds. Game state and decisions must remain server authoritative as online features are added.

## Development plan

1. **Poker rules core:** finish hand flow, blinds, betting streets, showdown, and pot awards with focused tests.
2. **Playable table:** add a Next.js responsive UI and connect it to the deterministic game model.
3. **Guest rooms:** add secure guest sessions, invite rooms, server-authoritative room state, and reconnect support.
4. **Vercel realtime:** add a WebSocket endpoint and Redis-backed room coordination, then verify multi-instance delivery and recovery.
5. **Public rooms and AI:** allow discovery and rule-based opponents.
6. **Learning support:** show current hand explanations, glossary, and legal-action guidance.
7. **Spectating and statistics:** publish only sanitized public state and persist clearly defined results.
8. **Release readiness:** document deployment, test multi-client flows, and review security and hosting limits.

### Vercel technology direction

With no existing stack to preserve and Vercel as the target, use Next.js/React for the app and Vercel Functions for server endpoints. Keep the poker core independent of the UI and transport. Vercel currently supports WebSockets on Functions, but each connection is pinned only for that Function's lifetime; reconnects can land on another instance. Therefore room state and cross-instance fan-out must use shared infrastructure, not process memory. Redis is the current direction for atomic room state and pub/sub; the exact provider and plan need to be checked against expected traffic and budget before provisioning. Connections must reconnect when the function closes them at its configured duration. See [Vercel's WebSocket guidance](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections) and [Function duration limits](https://vercel.com/docs/functions/limitations).

The rules package currently has **no runtime library dependencies**. Node's built-in `crypto` supplies secure shuffle randomness and Node's built-in test runner runs tests. TypeScript and `@types/node` are development-only dependencies for static type checking. The application will necessarily add Next.js and React; realtime work is likely to add a Redis client and Vercel's WebSocket adapter. The adapter API is currently experimental, so keep it behind a small transport boundary. Avoid adding a poker/rules package, UI component library, or validation library unless implementation needs justify it; input validation can begin with explicit typed guards. The initial package requires Node 22.6 or newer for native TypeScript stripping.

## Commands

- `npm test` — run the poker core tests.
- `npm run typecheck` — type-check when development dependencies are installed.

## Known limits

This is not yet a playable online service. The current betting module models one street and expects the caller to supply the correct first actor and minimum bet; full hand progression, room/session security, persistence, UI, AI, and deployment remain future work. The side-pot helper expects one total contribution per player per hand; odd-chip order is supplied by the caller (the game engine must define it relative to the dealer button).
