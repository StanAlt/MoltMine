# Permissions (Draft)

Permissions and claims are the core anti-griefing primitive.

## Objects
- `Account` — authenticated user identity
- `Role` — group of capabilities
- `Claim` — ownership/rights over a region or object
- `ACL` — allow/deny rules for actions

## Model (starter)
- Every entity MAY have an `Ownership` component with:
  - `ownerAccountId`
  - `editors[]`
  - `publicFlags` (e.g., canInteract)

- Regions/land use `Claim`:
  - `claimId`
  - `bounds` (AABB or polygon)
  - `ownerAccountId`
  - `editors[]`
  - `rules` (placement limits, banned assets, etc.)

## Enforcement
- The server is authoritative.
- All `World/Action` requests are checked against:
  - global policy
  - space policy
  - claim/object ACLs
  - rate limits

## Audit
All denied or allowed mutating actions should be auditable.
