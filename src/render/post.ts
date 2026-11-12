import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { look, QUALITY, type Quality } from './look';

/**
 * Kuwahara filter: each pixel takes the mean of whichever of its four
 * neighbouring quadrants is flattest, which turns detail into flat strokes
 * with crisp edges. Runs on the HDR scene before bloom. Desktop only.
 */
const KuwaharaShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTexel: { value: new THREE.Vector2() },
  },
  defines: { RADIUS: 3 },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 uTexel;
    varying vec2 vUv;
    void quad(vec2 dir, inout vec3 best, inout float bestVar) {
      vec3 sum = vec3(0.0), sq = vec3(0.0);
      for (int y = 0; y <= RADIUS; y++) for (int x = 0; x <= RADIUS; x++) {
        // Compress HDR so a single glint doesn't decide the stroke.
        vec3 c = texture2D(tDiffuse, vUv + dir * vec2(float(x), float(y)) * uTexel).rgb;
        sum += c; sq += c * c;
      }
      float n = float((RADIUS + 1) * (RADIUS + 1));
      vec3 mean = sum / n;
      vec3 v = abs(sq / n - mean * mean);
      float tv = (v.r + v.g + v.b) / (1.0 + dot(mean, vec3(0.333)));
      if (tv < bestVar) { bestVar = tv; best = mean; }
    }
    void main() {
      vec3 best = vec3(0.0); float bestVar = 1e9;
      quad(vec2(-1.0, -1.0), best, bestVar);
      quad(vec2( 1.0, -1.0), best, bestVar);
      quad(vec2(-1.0,  1.0), best, bestVar);
      quad(vec2( 1.0,  1.0), best, bestVar);
      gl_FragColor = vec4(best, 1.0);
    }`,
};

/**
 * Tone mapping, sRGB, and the colour grade in one pass: saturation,
 * contrast, split toning (cool shadows, warm highlights) and a vignette.
 */
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    toneMappingExposure: { value: 1 },
    uSaturation: { value: 1 },
    uContrast: { value: 1 },
    uShadows: { value: new THREE.Color() },
    uHighlights: { value: new THREE.Color() },
    uGrade: { value: 0.2 },
    uVignette: { value: 0.2 },
  },
  defines: { NEUTRAL_TONE_MAPPING: '' } as Record<string, string>,
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uSaturation, uContrast, uGrade, uVignette;
    uniform vec3 uShadows, uHighlights;
    #include <tonemapping_pars_fragment>
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      #if defined(NEUTRAL_TONE_MAPPING)
        c = NeutralToneMapping(c);
      #elif defined(AGX_TONE_MAPPING)
        c = AgXToneMapping(c);
      #elif defined(ACES_FILMIC_TONE_MAPPING)
        c = ACESFilmicToneMapping(c);
      #else
        c = clamp(c * toneMappingExposure, 0.0, 1.0);
      #endif
      c = sRGBTransferOETF(vec4(c, 1.0)).rgb;
      // Grade in display space, where the painting's values live.
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);
      c = (c - 0.5) * uContrast + 0.5;
      float hw = smoothstep(0.35, 1.0, l), sw = 1.0 - smoothstep(0.0, 0.6, l);
      c += (uShadows - 0.5) * uGrade * sw + (uHighlights - 0.5) * uGrade * hw;
      vec2 d = vUv - 0.5;
      c *= 1.0 - uVignette * dot(d, d) * 2.0;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

const TONE_DEFINES: Partial<Record<THREE.ToneMapping, string>> = {
  [THREE.NeutralToneMapping]: 'NEUTRAL_TONE_MAPPING',
  [THREE.AgXToneMapping]: 'AGX_TONE_MAPPING',
  [THREE.ACESFilmicToneMapping]: 'ACES_FILMIC_TONE_MAPPING',
};

/** Render pipeline: scene (HDR, MSAA on high) → brushstrokes → bloom → grade. */
export class PostFX {
  private composer!: EffectComposer;
  private kuwahara!: ShaderPass;
  private bloom!: UnrealBloomPass;
  private final!: ShaderPass;
  private quality: Quality | null = null;
  private toneMapping: THREE.ToneMapping | null = null;
  /** Brushstrokes are offered only where there is GPU to spare. */
  brushAllowed = true;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.Camera) {}

  private build(q: Quality): void {
    this.composer?.dispose();
    const p = QUALITY[q];
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: p.msaa });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.kuwahara = new ShaderPass(KuwaharaShader);
    this.composer.addPass(this.kuwahara);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 1, 0.5, 1.5);
    this.composer.addPass(this.bloom);
    this.final = new ShaderPass(FinalShader);
    // We tone map ourselves; this keeps three from adding its own tone-mapping chunk.
    this.final.material.toneMapped = false;
    this.composer.addPass(this.final);
    this.quality = q;
    this.toneMapping = null;
    this.setSize();
  }

  setSize(): void {
    if (!this.composer) return;
    const s = this.renderer.getSize(new THREE.Vector2());
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(s.x, s.y);
    const d = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.kuwahara.uniforms.uTexel.value.set(1 / d.x, 1 / d.y);
  }

  render(dt: number): void {
    if (this.quality !== look.quality) this.build(look.quality);
    const q = QUALITY[look.quality];
    this.kuwahara.enabled = look.brushstrokes && this.brushAllowed;
    const r = Math.max(1, Math.min(6, Math.round(look.brushRadius)));
    if (this.kuwahara.material.defines.RADIUS !== r) {
      this.kuwahara.material.defines.RADIUS = r;
      this.kuwahara.material.needsUpdate = true;
    }
    this.bloom.enabled = q.bloom && look.bloomStrength > 0;
    this.bloom.strength = look.bloomStrength;
    this.bloom.radius = look.bloomRadius;
    this.bloom.threshold = look.bloomThreshold;

    const u = this.final.uniforms;
    if (this.toneMapping !== this.renderer.toneMapping) {
      this.toneMapping = this.renderer.toneMapping;
      const def = TONE_DEFINES[this.toneMapping];
      this.final.material.defines = def ? { [def]: '' } : {};
      this.final.material.needsUpdate = true;
    }
    u.toneMappingExposure.value = look.exposure;
    u.uSaturation.value = look.saturation;
    u.uContrast.value = look.contrast;
    u.uShadows.value.set(look.gradeShadows).convertLinearToSRGB(); // graded in display space
    u.uHighlights.value.set(look.gradeHighlights).convertLinearToSRGB();
    u.uGrade.value = look.gradeAmount;
    u.uVignette.value = look.vignette;
    this.composer.render(dt);
  }
}
