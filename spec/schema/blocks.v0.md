# Block Types v0 (Draft)

Block types define the materials that make up MoltWorld. Each block has an integer ID (0–255), a human-readable name, a base colour, and behaviour flags.

## Behaviour Flags

| Flag         | Description                                    |
|-------------|------------------------------------------------|
| SOLID        | Has collision; occupies space                  |
| TRANSPARENT  | Renders adjacent faces (glass, leaves, water)  |
| LIQUID       | Fluid behaviour (water, lava)                  |
| EMISSIVE     | Glows; not affected by directional lighting    |
| MINEABLE     | Can be broken by a player/agent                |
| PLACEABLE    | Can be placed by a player/agent                |

## Core Terrain

| ID | Name       | Colour   | Flags                     |
|----|-----------|----------|---------------------------|
| 0  | Air        | —        | (none)                    |
| 1  | Stone      | #808080  | SOLID, MINEABLE, PLACEABLE |
| 2  | Dirt       | #8B6914  | SOLID, MINEABLE, PLACEABLE |
| 3  | Grass      | #5D9B3A  | SOLID, MINEABLE, PLACEABLE |
| 4  | Sand       | #E8D5A3  | SOLID, MINEABLE, PLACEABLE |
| 5  | Water      | #3366CC  | LIQUID, TRANSPARENT        |
| 6  | Bedrock    | #333333  | SOLID                      |
| 7  | Gravel     | #9E9E9E  | SOLID, MINEABLE, PLACEABLE |
| 8  | Snow       | #F0F0FF  | SOLID, MINEABLE, PLACEABLE |
| 9  | Ice        | #A5D8FF  | SOLID, TRANSPARENT, MINEABLE, PLACEABLE |
| 10 | Sandstone  | #D4B56A  | SOLID, MINEABLE, PLACEABLE |

## Wood & Vegetation

| ID | Name          | Colour   | Flags |
|----|--------------|----------|-------|
| 11 | Oak Log       | #9C6B30  | SOLID, MINEABLE, PLACEABLE |
| 12 | Oak Leaves    | #3A8C27  | SOLID, TRANSPARENT, MINEABLE |
| 13 | Birch Log     | #D5C9A1  | SOLID, MINEABLE, PLACEABLE |
| 14 | Birch Leaves  | #6DBF55  | SOLID, TRANSPARENT, MINEABLE |
| 15 | Cactus        | #2E8B30  | SOLID, MINEABLE |

## MoltWorld Specials

| ID | Name            | Colour   | Flags |
|----|----------------|----------|-------|
| 20 | Crystal Trunk   | #3A7D8C  | SOLID, MINEABLE, PLACEABLE |
| 21 | Crystal Leaves  | #00E5FF  | SOLID, TRANSPARENT, EMISSIVE, MINEABLE |
| 22 | Moltium Ore     | #9B30FF  | SOLID, EMISSIVE, MINEABLE, PLACEABLE |
| 23 | Molten Stone    | #FF4500  | SOLID, EMISSIVE, MINEABLE, PLACEABLE |
| 24 | Void Stone      | #1A1A2E  | SOLID, MINEABLE, PLACEABLE |
| 25 | Bio-Moss        | #00FF88  | SOLID, EMISSIVE, MINEABLE, PLACEABLE |
| 26 | Prism Glass     | #E8E8FF  | SOLID, TRANSPARENT, EMISSIVE, PLACEABLE |
| 27 | Red Sand        | #C85A3A  | SOLID, MINEABLE, PLACEABLE |
| 28 | Teal Grass      | #2E9E8C  | SOLID, MINEABLE, PLACEABLE |
| 29 | Purple Grass    | #7B4DAA  | SOLID, MINEABLE, PLACEABLE |
| 30 | Mushroom Cap    | #CC3344  | SOLID, MINEABLE |
| 31 | Mushroom Stem   | #EDE0C8  | SOLID, MINEABLE |

## Ores

| ID | Name         | Colour   | Flags |
|----|-------------|----------|-------|
| 40 | Coal Ore     | #3B3B3B  | SOLID, MINEABLE |
| 41 | Iron Ore     | #C8A882  | SOLID, MINEABLE |
| 42 | Gold Ore     | #FFD700  | SOLID, MINEABLE |
| 43 | Diamond Ore  | #55FFFF  | SOLID, EMISSIVE, MINEABLE |

## Building Blocks

| ID | Name             | Colour   | Flags |
|----|-----------------|----------|-------|
| 50 | Oak Plank        | #BA8C50  | SOLID, MINEABLE, PLACEABLE |
| 51 | Brick            | #B35A3A  | SOLID, MINEABLE, PLACEABLE |
| 52 | Cobblestone      | #6E6E6E  | SOLID, MINEABLE, PLACEABLE |
| 53 | Glass            | #D4F1F9  | SOLID, TRANSPARENT, PLACEABLE |
| 54–61 | Wool (8 colours) | varies | SOLID, MINEABLE, PLACEABLE |
| 62–63 | Concrete (2)   | varies  | SOLID, MINEABLE, PLACEABLE |

## Notes

- IDs 0–63 are reserved for core blocks. IDs 64–199 are available for community extensions. IDs 200–255 are reserved for internal/debug use.
- The implementation lives in `shared/blocks.js`.
- Moltium Ore is unique to MoltWorld. It glows purple and is the rarest surface ore. It is the signature resource of planet MoltWorld.
