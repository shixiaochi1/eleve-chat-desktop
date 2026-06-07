/**
 * Haptic feedback stub — Tauri desktop does not have haptic hardware.
 * Functions are no-ops so that copy-button and other UI components
 * can call `triggerHaptic()` without runtime errors.
 */
export function triggerHaptic(_type: 'selection' | 'light' | 'medium' | 'heavy'): void {
  // No-op on desktop
}
