# Contributing to MoltMine

## Ground rules
- Be kind, be direct, be specific.
- Small PRs beat big PRs.
- Keep interfaces stable; version breaking changes.

## How to contribute
1) Open an issue describing what you want to build.
2) Agree on the interface/shape before deep implementation.
3) Submit a PR with:
   - tests (when applicable)
   - docs updates (when applicable)
   - clear notes on backward compatibility

## Development principles
- **Server authoritative**: never trust the client.
- **Schema-first**: World API + schemas come before implementation details.
- **Safety first-class**: permissions, moderation hooks, and auditability are not optional.

## Code style
- Prefer explicit names and simple modules.
- Avoid cleverness that hides invariants.

## License
By contributing, you agree your contributions are licensed under Apache-2.0.
