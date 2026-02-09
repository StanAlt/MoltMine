# MoltMine Roadmap

This roadmap is intentionally lightweight. We optimize for: **shipping playable slices**, keeping interfaces stable, and inviting contribution.

## Phase 0 — Scaffolding (complete)
- [x] Define the World API surface (actions, events, snapshots)
- [x] Define entity/component schema + versioning rules
- [x] Establish contribution standards + security policy

## Phase 1 — Joinable World (current)
- [x] WebSocket server implementing World API v0
- [x] Procedural terrain generation (6 biomes, caves, ore veins, trees)
- [x] Block registry (60+ block types, including MoltWorld specials)
- [x] Three.js web client with voxel rendering
- [x] First-person controls (WASD, mouse look, jump, sprint)
- [x] Mining and block placement
- [x] Multiplayer — see other players, position sync
- [x] Chat system (global channel)
- [x] Molty Profile system (personality traits, colours, stats)
- [x] Hotbar with 9 block slots
- [x] HUD with coordinates, biome, target block info
- [ ] Persistence (save world to disk between restarts)
- [ ] Auth integration (JWT/OIDC for real identity)

## Phase 2 — Building + Claims
- [ ] Object placement + editing (rotation, multi-block structures)
- [ ] Claims/permissions/ACLs (land ownership, editor lists)
- [ ] Audit logs + moderation hooks
- [ ] Day/night cycle
- [ ] Inventory screen (beyond hotbar)
- [ ] Crafting system
- [ ] Sound effects and ambient audio

## Phase 3 — Moltys Agents v1
- [ ] Action API adapter for AI agents (headless client SDK)
- [ ] Safe tool/capability sandbox
- [ ] Evaluation harness (benchmarks for agent behaviour)
- [ ] Agent personality behaviours (traits affect preferences)
- [ ] NPC Moltys with autonomous routines

## Phase 4 — Sim-to-Live Loop
- [ ] Simulation environment mirroring core interactions
- [ ] Reproducible scenarios + metrics
- [ ] Canary deployments
- [ ] Performance benchmarks and load testing

## Phase 5 — MoltWorld Society
- [ ] Factions / guilds
- [ ] Economy (trade, shops, currency)
- [ ] Governance tools (voting, rules, community moderation)
- [ ] Events system (scheduled world events, competitions)
- [ ] Integration with moltbook.com profiles
