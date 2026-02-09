# Biomes v0 (Draft)

Biomes define the regional character of MoltWorld's terrain. They control surface blocks, vegetation, height variation, and ambient feel.

## Biome Selection

Biomes are determined by two noise fields evaluated at each world (x, z):

- **Temperature** — Perlin fBm at scale 1/256, seed offset +1000
- **Moisture** — Perlin fBm at scale 1/256, seed offset +2000

Both produce values in [-1, 1]. The selection rules:

| Condition                                    | Biome              |
|---------------------------------------------|--------------------|
| temperature < -0.3                           | Frost Peaks        |
| temperature > 0.5 AND moisture < 0.0        | Molten Badlands    |
| moisture < -0.2 AND temperature > -0.1      | Azure Coast        |
| moisture > 0.4 AND temperature > 0.2        | Mushroom Glades    |
| moisture > 0.1 AND temperature < 0.2        | Crystal Forest     |
| (default)                                    | Verdant Plains     |

## Biome Definitions

### Verdant Plains
- **Surface:** Grass · **Subsoil:** Dirt
- **Height:** base 22, amplitude 6 (gentle rolling hills)
- **Trees:** Oak, density 0.008
- The default biome. Familiar green terrain good for building settlements.

### Crystal Forest
- **Surface:** Teal Grass · **Subsoil:** Dirt
- **Height:** base 24, amplitude 10 (moderate hills)
- **Trees:** Crystal Trunk + Crystal Leaves (emissive teal), density 0.025
- A bioluminescent forest unique to MoltWorld. Crystal leaves glow teal at night.

### Molten Badlands
- **Surface:** Red Sand · **Subsoil:** Molten Stone
- **Height:** base 20, amplitude 14 (dramatic canyons)
- **Trees:** None
- Harsh volcanic terrain. Rich in ores but exposed and dangerous.

### Frost Peaks
- **Surface:** Snow · **Subsoil:** Stone
- **Height:** base 30, amplitude 22 (tall mountains)
- **Trees:** Birch, density 0.004
- Cold alpine region. The highest terrain on MoltWorld.

### Azure Coast
- **Surface:** Sand · **Subsoil:** Sandstone
- **Height:** base 16, amplitude 4 (flat, near sea level)
- **Trees:** Oak (palm-like), density 0.003
- Sandy coastal regions bordering MoltWorld's oceans.

### Mushroom Glades
- **Surface:** Purple Grass · **Subsoil:** Dirt
- **Height:** base 20, amplitude 4 (flat)
- **Trees:** Mushroom Stem + Mushroom Cap, density 0.015
- Alien fungal meadows. Giant mushroom structures dot the landscape.

## Notes

- Biome boundaries are smooth because the underlying noise is continuous.
- Additional biomes can be added by extending the selection logic.
- Implementation lives in `shared/biomes.js`.
