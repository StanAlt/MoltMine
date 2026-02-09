/**
 * Seeded 2D Perlin noise for deterministic terrain generation.
 * No external dependencies — works in Node and browsers.
 */

export class PerlinNoise {
  constructor(seed = 0) {
    this.perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;

    // Fisher-Yates shuffle seeded by a simple LCG
    let s = seed >>> 0;
    for (let i = 255; i > 0; i--) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const j = s % (i + 1);
      const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  // Classic gradient vectors for 2D Perlin noise
  static GRAD2 = [
    [1,1],[-1,1],[1,-1],[-1,-1],
    [1,0],[-1,0],[0,1],[0,-1],
  ];

  _grad(hash, x, y) {
    const g = PerlinNoise.GRAD2[hash & 7];
    return g[0] * x + g[1] * y;
  }

  _fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  _lerp(a, b, t) { return a + t * (b - a); }

  /** Returns noise value in [-1, 1] */
  noise2D(x, y) {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = this._fade(xf);
    const v = this._fade(yf);

    const p = this.perm;
    const aa = p[p[xi] + yi];
    const ab = p[p[xi] + yi + 1];
    const ba = p[p[xi + 1] + yi];
    const bb = p[p[xi + 1] + yi + 1];

    return this._lerp(
      this._lerp(this._grad(aa, xf, yf),     this._grad(ba, xf - 1, yf),     u),
      this._lerp(this._grad(ab, xf, yf - 1), this._grad(bb, xf - 1, yf - 1), u),
      v,
    );
  }

  /** Multi-octave noise (fBm), returns roughly [-1, 1] */
  fbm(x, y, octaves = 4, lacunarity = 2, persistence = 0.5) {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    let max = 0;
    for (let i = 0; i < octaves; i++) {
      value += this.noise2D(x * frequency, y * frequency) * amplitude;
      max += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }
    return value / max;
  }
}
