# World API (Draft v0)

This document defines the **stable boundary** between clients/agents/simulators and the authoritative MoltMine world server.

Status: **DRAFT** (interface-first). Expect rapid iteration until v1.

## Goals
- **Server authoritative** (anti-cheat, consistency)
- **Client-agnostic** (Web, Unity, Unreal, headless sim)
- **Agent-friendly** (clear actions + perceptions)
- **Safe-by-design** (permissions, rate limits, auditability)

## Concepts

### Entities and Components
- The world is a set of `Entity` objects identified by `entityId`.
- Each entity has zero or more **components**.

Canonical components (initial set):
- `Transform` — position/rotation/scale
- `Appearance` — model/material refs
- `Collider` / `PhysicsProxy` — server-side collision representation
- `Inventory` — container of items
- `Claim` / `Ownership` — ACL + land/object permissions
- `Agent` — marker + AI runtime state (server-managed)

### Events vs Snapshots
- **Snapshots** represent current world state (or diffs).
- **Events** represent discrete occurrences (chat, item picked up, door opened).

### Sessions
- A user connects via an authenticated session and joins one or more **spaces** (shards/regions/rooms).

## Transport
This spec does not mandate a transport.
Typical implementations:
- WebSocket with binary payloads
- WebRTC data channels (later)

All messages are versioned.

## Message Envelope
All messages SHOULD follow this shape:
```json
{
  "v": 0,
  "type": "string",
  "id": "client-generated-id",
  "ts": 0,
  "payload": {}
}
```

## Client → Server

### `Auth/Hello`
Purpose: negotiate protocol + identify client.
Payload:
- `token` (string, JWT/OIDC access token)
- `client` (object: name, version, platform)

### `World/Join`
Payload:
- `spaceId` (string)
- `spawnHint` (optional)

### `World/Action`
Purpose: request an action. Server validates permissions and world rules.
Payload:
- `actionId` (string)
- `kind` (string)
- `args` (object)

Initial action kinds (MVP):
- `MoveTo` { target: {x,y,z}, speed? }
- `Emote` { name }
- `Speak` { text, channel? }
- `Interact` { entityId, verb }
- `PickUp` { entityId }
- `Place` { assetId, transform }

### `World/Chat`
Payload:
- `text`
- `channel` (global|space|proximity|dm)

## Server → Client

### `World/Snapshot`
Payload:
- `spaceId`
- `tick`
- `entities` (full or diff)

### `World/Event`
Payload:
- `spaceId`
- `tick`
- `event` { kind, data }

### `World/ActionResult`
Payload:
- `actionId`
- `ok` boolean
- `error` { code, message } (optional)
- `effects` (optional)

## Error codes (starter set)
- `UNAUTHENTICATED`
- `UNAUTHORIZED`
- `NOT_FOUND`
- `INVALID_ARGUMENT`
- `RATE_LIMITED`
- `CONFLICT`
- `INTERNAL`

## Safety hooks (required)
- All mutating actions MUST write to an **audit log**.
- Asset references MUST be validated against server-side allowlists and budgets.
- Agent capabilities MUST be expressed via the same Action API.

## Versioning rules
- Message envelope `v` increments only for breaking changes.
- Actions/events should be added compatibly when possible.
