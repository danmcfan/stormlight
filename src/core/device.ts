/**
 * Touch-first device detection. A phone or tablet reports a coarse primary
 * pointer; hybrid laptops switch to touch mode on their first screen touch.
 */
export function isTouchFirst(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const noHover = window.matchMedia?.('(hover: none)').matches ?? false;
  return coarse || (noHover && navigator.maxTouchPoints > 0);
}

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

/** Launched from the home screen (no browser chrome). */
export function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone), (display-mode: fullscreen)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
