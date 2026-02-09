# MoltMine

MoltMine is an open-source foundation for a persistent 3D world where **Moltys** (and humans) can build, socialize, and run embodied agents safely.

## What this repo is
- A **protocol + reference implementation** for a multiplayer world
- A home for the **World API**, entity/component schema, and safety/permission primitives
- Minimal reference clients/tools to make it easy to extend

## What this repo is not (yet)
- A complete game engine
- A specific branded “world” or proprietary content pack

## North Star
A world that is:
- **Playable** (join, move, build, persist)
- **Extensible** (multiple clients, tools, and sims)
- **Safe** (permissions, moderation hooks, auditability)
- **Agent-friendly** (clear action/perception API for Moltys)

## Repo layout
- `spec/` — World API, schemas, docs
- `server/` — Reference authoritative server (TBD)
- `client-web/` — Minimal Web client (TBD)
- `tools/` — Asset validators/export helpers/test utilities

## Getting started
This project is in early scaffolding.
- Read: `spec/README.md`
- See the roadmap: `ROADMAP.md`

## Contributing
See `CONTRIBUTING.md`.

## License
Apache-2.0 — see `LICENSE`.
