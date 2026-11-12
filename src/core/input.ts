import { tuning } from '../config';

/**
 * Keyboard + mouse state. Held keys are read every sim step; presses are
 * latched until a sim step consumes them so a tap between frames is never lost.
 *
 * Touch controls feed the same model: virtual buttons press and hold the same
 * codes a keyboard / mouse would ('Mouse0', 'Space', 'KeyE', ...), the
 * joystick supplies an analog move vector, and look drags are converted into
 * mouse-equivalent deltas. Game logic never needs to know which device it was.
 */
export class Input {
  private held = new Set<string>();
  private pressed = new Set<string>();
  /** Codes held by on-screen touch buttons (kept apart from real keys). */
  private virtualHeld = new Set<string>();
  /** Analog stick vector (x = right, y = forward), used when no movement key is down. */
  private analogX = 0;
  private analogY = 0;
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  pointerLocked = false;
  /** Playing with touch controls (no pointer lock on mobile). */
  touchPlaying = false;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'Space' || e.code === 'Backquote') e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.held.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());

    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
      this.pressed.add(`Mouse${e.button}`);
      this.held.add(`Mouse${e.button}`);
    });
    window.addEventListener('mouseup', (e) => this.held.delete(`Mouse${e.button}`));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    canvas.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });
  }

  /** Whether gameplay input is live: mouse captured, or a touch session running. */
  get live(): boolean {
    return this.pointerLocked || this.touchPlaying;
  }

  requestPointerLock(): void {
    this.canvas.requestPointerLock?.();
  }

  isHeld(code: string): boolean {
    return this.held.has(code) || this.virtualHeld.has(code);
  }

  /** On-screen button pressed: latches a press and holds the code. */
  virtualDown(code: string): void {
    if (!this.virtualHeld.has(code)) this.pressed.add(code);
    this.virtualHeld.add(code);
  }

  virtualUp(code: string): void {
    this.virtualHeld.delete(code);
  }

  /** A one-shot press with no hold (e.g. a tap). */
  virtualTap(code: string): void {
    this.pressed.add(code);
  }

  /** Release every touch-held code and zero the stick (pause, lost focus). */
  releaseVirtual(): void {
    this.virtualHeld.clear();
    this.analogX = this.analogY = 0;
  }

  /** Joystick vector, each axis in [-1, 1]; magnitude scales speed. */
  setAnalogMove(x: number, y: number): void {
    this.analogX = x;
    this.analogY = y;
  }

  /** Touch look drag in CSS pixels, converted to mouse-equivalent units. */
  addTouchLook(dx: number, dy: number): void {
    const k = tuning.touch.lookSensitivity / tuning.camera.sensitivity;
    this.mouseDX += dx * k;
    this.mouseDY += dy * k * tuning.touch.pitchScale;
  }

  /** Raw mouse-unit nudge (e.g. a lock-on switch flick from a touch swipe). */
  addMouse(dx: number): void {
    this.mouseDX += dx;
  }

  /** True once per physical press. */
  consumePress(code: string): boolean {
    return this.pressed.delete(code);
  }

  /** Take accumulated mouse movement (called once per rendered frame). */
  takeMouse(): { dx: number; dy: number; wheel: number } {
    const out = { dx: this.mouseDX, dy: this.mouseDY, wheel: this.wheel };
    this.mouseDX = this.mouseDY = this.wheel = 0;
    return out;
  }

  /** Movement axes: x = right, y = forward, each in [-1, 1]. */
  moveAxes(): { x: number; y: number } {
    const x = (this.isHeld('KeyD') ? 1 : 0) - (this.isHeld('KeyA') ? 1 : 0);
    const y = (this.isHeld('KeyW') ? 1 : 0) - (this.isHeld('KeyS') ? 1 : 0);
    if (x === 0 && y === 0) return { x: this.analogX, y: this.analogY };
    return { x, y };
  }
}
