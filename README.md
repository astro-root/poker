# Poker

Free online Texas Hold'em service. The repository started with only `develop-prompt.md`; no existing application, framework, tests, or deployment configuration was present.

## Current implementation

The first foundation is a dependency-light TypeScript poker core: a 52-card deck, cryptographically shuffled cards, five-to-seven-card hand evaluation, tie comparison, side-pot construction, and deterministic odd-chip splitting. Game state and decisions must remain server authoritative as online features are added.

## Development plan

1. **Poker rules core:** finish hand and pot logic, then implement betting rounds, blinds, actions, and showdowns with focused tests.
2. **Playable table:** render a responsive table and connect it to a deterministic game state model.
3. **Guest rooms:** add secure guest sessions, invite rooms, WebSocket synchronization, validation, and reconnect support.
4. **Public rooms and AI:** allow discovery and rule-based opponents.
5. **Learning support:** show current hand explanations, glossary, and legal-action guidance.
6. **Spectating and statistics:** publish only sanitized public state and persist clearly defined results.
7. **Release readiness:** document deployment, test multi-client flows, and review security and hosting limits.

### Initial technology direction

With no existing stack to preserve, use TypeScript and Node's built-in test runner for the isolated rules package. Keep the game core independent of the eventual UI and transport. Before adding online infrastructure, compare the prompt's Cloudflare Workers/Durable Objects/D1 direction against the runtime constraints and deployment needs; do not put private cards in room-wide state broadcasts. The initial package requires Node 22.6 or newer for native TypeScript stripping. Cloudflare deployment is not configured yet.

## Commands

- `npm test` — run the poker core tests.
- `npm run typecheck` — type-check when development dependencies are installed.

## Known limits

This is not yet a playable online service. Betting state transitions, room/session security, persistence, UI, AI, and deployment remain future work. The current side-pot helper expects one total contribution per player per hand; odd-chip order is supplied by the caller (the game engine must define it relative to the dealer button).
