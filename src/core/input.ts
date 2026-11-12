/**
 * Keyboard + mouse state. Held keys are read every sim step; presses are
 * latched until a sim step consumes them so a tap between frames is never lost.
 */
export class Input {
  private held = new Set<string>();
  private pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  pointerLocked = false;

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

  requestPointerLock(): void {
    this.canvas.requestPointerLock?.();
  }

  isHeld(code: string): boolean {
    return this.held.has(code);
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
    return { x, y };
  }
}
