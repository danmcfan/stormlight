import { tuning } from '../config';
import type { Input } from '../core/input';

/**
 * On-screen controls for phones and tablets.
 *
 *  - Left side: a floating joystick appears under the thumb. Analog: a small
 *    push walks, a full push runs, pushing past the ring sprints.
 *  - Right side: drag anywhere empty to look; pinch with two fingers to zoom.
 *  - Action buttons for the right thumb press the same codes as the mouse and
 *    keyboard, so combat logic is identical on every device.
 *
 * Built on pointer events, which give every finger its own id: move, look and
 * a button all work at once.
 */

interface ButtonSpec {
  id: string;
  code: string;
  label: string;
  icon: string;
  /** 'hold' keeps the code held while touched; 'tap' only latches a press. */
  mode: 'hold' | 'tap';
}

const svg = (body: string) => `<svg viewBox="0 0 32 32" aria-hidden="true">${body}</svg>`;

const ICONS = {
  light: svg('<path d="M7 25 L25 7" stroke-width="3"/><path d="M20 6 L26 6 L26 12" stroke-width="2"/>'),
  heavy: svg('<path d="M5 22 L22 5" stroke-width="3"/><path d="M10 27 L27 10" stroke-width="3"/>'),
  dodge: svg('<path d="M6 21 C10 9, 20 7, 26 13" stroke-width="2.6"/><path d="M21 9 L26.5 13.5 L20 16" stroke-width="2.4"/><path d="M5 26 L14 26" stroke-width="2" opacity=".6"/>'),
  block: svg('<path d="M16 4 L26 8 L26 16 C26 22 21 26 16 28 C11 26 6 22 6 16 L6 8 Z" stroke-width="2.4"/><path d="M16 9 L16 23" stroke-width="1.6" opacity=".6"/>'),
  lock: svg('<rect x="9" y="9" width="14" height="14" transform="rotate(45 16 16)" stroke-width="2.4"/><circle cx="16" cy="16" r="2.4" class="fill"/>'),
  stance: svg('<rect x="5" y="12" width="8" height="8" transform="rotate(45 9 16)" stroke-width="2.2"/><rect x="19" y="12" width="8" height="8" transform="rotate(45 23 16)" stroke-width="2.2" class="fill"/>'),
  shove: svg('<path d="M6 16 H18" stroke-width="2.6"/><path d="M14 10 L20 16 L14 22" stroke-width="2.4"/><path d="M24 7 L24 25" stroke-width="3"/>'),
  pause: svg('<path d="M12 8 L12 24 M20 8 L20 24" stroke-width="3"/>'),
  gear: svg('<circle cx="16" cy="16" r="4.5" stroke-width="2.2"/><path d="M16 4 V9 M16 23 V28 M4 16 H9 M23 16 H28 M7.5 7.5 L11 11 M21 21 L24.5 24.5 M7.5 24.5 L11 21 M21 11 L24.5 7.5" stroke-width="2.2"/>'),
  fps: svg('<path d="M5 26 H27" stroke-width="1.6" opacity=".6"/><path d="M8 22 V16 M13 22 V10 M18 22 V14 M23 22 V7" stroke-width="2.8"/>'),
  sound: svg('<path d="M6 13 H10 L16 8 V24 L10 19 H6 Z" stroke-width="2"/><path class="wave" d="M20 12 C22 14 22 18 20 20 M23 9 C27 13 27 19 23 23" stroke-width="2"/><path class="cross" d="M20 12 L27 20 M27 12 L20 20" stroke-width="2.2"/>'),
};

const ACTIONS: ButtonSpec[] = [
  { id: 'light', code: 'Mouse0', label: 'Strike', icon: ICONS.light, mode: 'hold' },
  { id: 'heavy', code: 'Mouse2', label: 'Heavy', icon: ICONS.heavy, mode: 'hold' },
  { id: 'dodge', code: 'Space', label: 'Dodge', icon: ICONS.dodge, mode: 'hold' },
  { id: 'block', code: 'KeyE', label: 'Block', icon: ICONS.block, mode: 'hold' },
  { id: 'stance', code: 'Tab', label: 'Stance', icon: ICONS.stance, mode: 'tap' },
  { id: 'shove', code: 'KeyR', label: 'Shove', icon: ICONS.shove, mode: 'tap' },
];

/** Horizontal swipe on the lock button (CSS px) that counts as a target switch. */
const LOCK_SWIPE = 26;

export interface TouchCallbacks {
  isLocked: () => boolean;
  isMuted: () => boolean;
  onPause: () => void;
}

export class TouchControls {
  readonly root: HTMLElement;
  private stick: HTMLElement;
  private knob: HTMLElement;
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private sprinting = false;
  private looks = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private muteBtn: HTMLElement;

  constructor(private input: Input, private cb: TouchCallbacks) {
    this.root = document.createElement('div');
    this.root.id = 'touch';
    this.root.className = 'touch-ui hidden';

    const zone = this.div('touch-zone', this.root);
    this.stick = this.div('stick idle', this.root);
    this.div('stick-ring', this.stick);
    this.knob = this.div('stick-knob', this.stick);

    // Top-right utilities, small and out of the thumbs' way.
    const top = this.div('touch-top', this.root);
    this.utility(top, 'pause', ICONS.pause, 'Pause', () => this.cb.onPause());
    this.utility(top, 'fps', ICONS.fps, 'Frame timing', () => this.input.virtualTap('KeyF'));
    this.utility(top, 'gear', ICONS.gear, 'Debug & tuning', () => this.input.virtualTap('Backquote'));
    this.muteBtn = this.utility(top, 'sound', ICONS.sound, 'Mute', () => {
      this.input.virtualTap('KeyM');
      // The game toggles mute on its next sim step; reflect it right after.
      setTimeout(() => this.syncMute(), 50);
    });

    const actions = this.div('touch-actions', this.root);
    for (const spec of ACTIONS) this.action(actions, spec);
    this.lockButton(actions);

    zone.addEventListener('pointerdown', (e) => this.zoneDown(e));
    zone.addEventListener('pointermove', (e) => this.zoneMove(e));
    zone.addEventListener('pointerup', (e) => this.zoneUp(e));
    zone.addEventListener('pointercancel', (e) => this.zoneUp(e));

    document.body.appendChild(this.root);
  }

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
    if (!on) this.reset();
    else this.syncMute();
  }

  /** Drop every finger: used on pause and when the page loses focus. */
  reset(): void {
    this.stickId = null;
    this.sprinting = false;
    this.looks.clear();
    this.stick.classList.add('idle');
    this.stick.classList.remove('sprint');
    this.stick.style.transform = '';
    this.knob.style.transform = '';
    this.root.querySelectorAll('.down').forEach((b) => b.classList.remove('down'));
    this.input.releaseVirtual();
  }

  private syncMute(): void {
    this.muteBtn.classList.toggle('off', this.cb.isMuted());
  }

  private div(cls: string, parent: HTMLElement): HTMLElement {
    const d = document.createElement('div');
    d.className = cls;
    parent.appendChild(d);
    return d;
  }

  private button(parent: HTMLElement, cls: string, html: string, title: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.innerHTML = html;
    b.setAttribute('aria-label', title);
    parent.appendChild(b);
    return b;
  }

  private utility(parent: HTMLElement, id: string, icon: string, title: string, fn: () => void): HTMLElement {
    const b = this.button(parent, `tbtn util util-${id}`, icon, title);
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      b.classList.add('down');
    });
    const up = (e: PointerEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (b.classList.contains('down')) { b.classList.remove('down'); fn(); }
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', () => b.classList.remove('down'));
    b.addEventListener('pointerleave', () => b.classList.remove('down'));
    return b;
  }

  private action(parent: HTMLElement, spec: ButtonSpec): void {
    const b = this.button(parent, `tbtn act act-${spec.id}`, `${spec.icon}<span>${spec.label}</span>`, spec.label);
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      b.setPointerCapture?.(e.pointerId);
      b.classList.add('down');
      if (spec.mode === 'hold') this.input.virtualDown(spec.code);
      else this.input.virtualTap(spec.code);
    });
    const up = (e: PointerEvent) => {
      e.preventDefault(); e.stopPropagation();
      b.classList.remove('down');
      if (spec.mode === 'hold') this.input.virtualUp(spec.code);
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
  }

  /** Tap to lock / release. While locked, swipe across it to switch target. */
  private lockButton(parent: HTMLElement): void {
    const b = this.button(parent, 'tbtn act act-lock', `${ICONS.lock}<span>Lock</span>`, 'Lock on');
    let startX = 0, lastX = 0, swiped = false, active = false;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      b.setPointerCapture?.(e.pointerId);
      b.classList.add('down');
      startX = lastX = e.clientX; swiped = false; active = true;
    });
    b.addEventListener('pointermove', (e) => {
      if (!active) return;
      e.preventDefault();
      lastX = e.clientX;
      const dx = lastX - startX;
      if (this.cb.isLocked() && Math.abs(dx) > LOCK_SWIPE) {
        // A flick well past the mouse threshold: the lock-on system switches.
        this.input.addMouse(Math.sign(dx) * tuning.lockOn.switchThreshold * 1.5);
        swiped = true;
        startX = lastX; // swipe again for the next target
      }
    });
    const up = (e: PointerEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (!active) return;
      active = false;
      b.classList.remove('down');
      if (!swiped && e.type === 'pointerup') this.input.virtualTap('KeyQ');
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
  }

  // --- Joystick + look ------------------------------------------------------

  private zoneDown(e: PointerEvent): void {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const leftSide = e.clientX < window.innerWidth * 0.42;
    if (leftSide && this.stickId === null) {
      this.stickId = e.pointerId;
      // Keep the whole ring on screen.
      const r = tuning.touch.stickRadius;
      this.stickOrigin.x = Math.max(r + 8, e.clientX);
      this.stickOrigin.y = Math.min(window.innerHeight - r - 8, Math.max(r + 8, e.clientY));
      this.stick.style.setProperty('--r', `${r}px`);
      this.stick.classList.remove('idle');
      this.stick.style.transform = `translate(${this.stickOrigin.x}px, ${this.stickOrigin.y}px)`;
      this.moveStick(e.clientX, e.clientY);
      return;
    }
    this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.pinchDist = this.pinchDistance();
  }

  private zoneMove(e: PointerEvent): void {
    if (e.pointerId === this.stickId) { e.preventDefault(); this.moveStick(e.clientX, e.clientY); return; }
    const p = this.looks.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (this.looks.size === 1) {
      this.input.addTouchLook(dx, dy);
    } else {
      // Two fingers: pinch to zoom the camera in and out.
      const d = this.pinchDistance();
      this.input.wheel -= (d - this.pinchDist) / 45;
      this.pinchDist = d;
    }
  }

  private zoneUp(e: PointerEvent): void {
    if (e.pointerId === this.stickId) {
      this.stickId = null;
      this.input.setAnalogMove(0, 0);
      this.setSprint(false);
      this.stick.classList.add('idle');
      this.stick.style.transform = '';
      this.knob.style.transform = '';
      return;
    }
    this.looks.delete(e.pointerId);
    this.pinchDist = this.pinchDistance();
  }

  private pinchDistance(): number {
    if (this.looks.size < 2) return 0;
    const [a, b] = [...this.looks.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private moveStick(x: number, y: number): void {
    const r = tuning.touch.stickRadius;
    let dx = x - this.stickOrigin.x, dy = y - this.stickOrigin.y;
    const len = Math.hypot(dx, dy);
    const push = len / r;
    this.setSprint(push >= tuning.touch.sprintPush);
    if (len > r) { dx *= r / len; dy *= r / len; }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    // Small dead zone, then a linear ramp to full speed at the ring.
    const dead = 0.12;
    const mag = Math.min(1, push);
    const k = mag < dead ? 0 : (mag - dead) / (1 - dead) / Math.max(mag, 1e-6);
    this.input.setAnalogMove((dx / r) * k, (-dy / r) * k);
  }

  private setSprint(on: boolean): void {
    if (on === this.sprinting) return;
    this.sprinting = on;
    this.stick.classList.toggle('sprint', on);
    if (on) this.input.virtualDown('ShiftLeft'); else this.input.virtualUp('ShiftLeft');
  }
}
