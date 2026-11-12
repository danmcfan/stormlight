import { mulberry32 } from '../core/math';

/**
 * Horde randomness, seedable so balance runs are repeatable
 * (`?seed=123` in the URL, or `game.hordeSeed`). Unseeded runs pick a fresh seed.
 */
let next: () => number = Math.random;

export function seedHorde(seed: number): void {
  next = mulberry32(seed >>> 0);
}

/** Uniform in [0, 1). */
export function hrand(): number {
  return next();
}

/** Uniform in [a, b). */
export function hrange(a: number, b: number): number {
  return a + next() * (b - a);
}
