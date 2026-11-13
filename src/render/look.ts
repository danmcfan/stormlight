import { isTouchFirst } from '../core/device';

export type Quality = 'low' | 'medium' | 'high';

/**
 * The game's look: painterly light, colour, atmosphere and post-processing,
 * tuned against the style reference (art/source/plateau-noon). Colours are
 * sRGB hex. Live-editable in the tuning panel (Look folder); see
 * docs/rendering.md.
 */
export const defaultLook = {
  /** low / medium / high; chosen automatically, see autoQuality(). */
  quality: 'high' as Quality,
  /** Kuwahara brushstroke filter. Desktop only. */
  brushstrokes: false,
  brushRadius: 3,

  // --- Sun and sky light ---------------------------------------------------
  sunColor: '#fff1dc',
  sunIntensity: 2.7,
  /** Degrees above the horizon: high noon, short shadows. */
  sunElevation: 64,
  /** Degrees; 0 = sun to the south (behind the match-shot camera). */
  sunAzimuth: -28,
  skyLight: '#b9d3ef',
  groundLight: '#d9a273',
  ambient: 0.85,

  // --- Painterly shading -----------------------------------------------------
  /** Bands in the diffuse light ramp. */
  rampSteps: 3,
  /** 0 = hard bands, 1 = smooth. */
  rampSoftness: 0.45,
  /** Brightens the light ramp so steep sunward walls read as lit. */
  rampLift: 0.8,
  /** Colour the shaded side shifts toward (hue only; brightness is kept). */
  shadowColor: '#6d8fd6',
  shadowHue: 0.55,
  /** Tint on the sunlit side. */
  highlightColor: '#ffd6a0',
  highlightWarmth: 0.15,
  rimColor: '#d8ecff',
  rimStrength: 0.22,
  rimPower: 3,
  /** Brightest a lit (non-glowing) surface may get, so only glows bloom. */
  maxLit: 1.1,
  /** Extra HDR for strong emissives (Stormlight, gems, visor, etched line). */
  glowBoost: 1.2,

  // --- Plate paint (platePaint.ts): the baked mask, painted per fighter ------------
  /** How much the Plate darkens in its own folds (the mask's occlusion). */
  plateShade: 0.7,
  /** Worn bright edges. */
  plateWear: 1.2,
  /** Orange plateau dust in the seams and along the enamel. */
  plateDust: 0.8,
  /** Brushwork: value variation at two scales, fixed to each piece. */
  plateBrush: 0.08,

  // --- Atmosphere ------------------------------------------------------------
  hazeColor: '#c9dbea',
  /** Distance haze per metre. */
  hazeDensity: 0.0026,
  hazeMax: 0.75,
  chasmColor: '#5a8fd0',
  /** How much the chasms fill with blue haze. */
  chasmFog: 0.9,
  /** Metres below the rim at which the chasm haze is full. */
  chasmDepth: 30,
  /** Height of the plateau tops: haze starts below this. */
  fogTop: -5,

  // --- Sky ---------------------------------------------------------------------
  skyZenith: '#4f8fd8',
  skyHorizon: '#a9cdee',
  cloudColor: '#f6f4ee',
  cloudCover: 0.5,
  stormColor: '#34405a',
  stormHeight: 0.085,

  // --- Post --------------------------------------------------------------------
  bloomStrength: 0.7,
  /** Halo falloff: weight of each wider bloom mip relative to the last (0 = tightest). */
  bloomRadius: 0,
  /** Linear HDR luminance above which pixels bloom (above maxLit). */
  bloomThreshold: 1.3,
  exposure: 1.2,
  saturation: 1.12,
  contrast: 1.04,
  /** Split toning: highlights toward warm cream (shadows: see below). */
  // Neutral: cool shade is done per material in the shader (which knows
  // metal from stone); a blue push here turned grey steel navy.
  gradeShadows: '#808080',
  gradeHighlights: '#ffd7a0',
  gradeAmount: 0.18,
  vignette: 0.1,
};

export type Look = typeof defaultLook;
export const look: Look = structuredClone(defaultLook);

/** Touch devices start lower; everything else starts on high. */
export function autoQuality(): Quality {
  return isTouchFirst() ? 'medium' : 'high';
}

export interface QualityPreset {
  /** Cap on devicePixelRatio. */
  pixelRatio: number;
  shadowMap: number;
  msaa: number;
  bloom: boolean;
}

export const QUALITY: Record<Quality, QualityPreset> = {
  low: { pixelRatio: 1, shadowMap: 1024, msaa: 0, bloom: false },
  medium: { pixelRatio: 1.5, shadowMap: 1024, msaa: 0, bloom: true },
  high: { pixelRatio: 2, shadowMap: 2048, msaa: 4, bloom: true },
};
