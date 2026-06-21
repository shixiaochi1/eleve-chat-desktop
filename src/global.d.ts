// Tauri API type declarations (Eleve desktop bridge)
// These types describe the APIs available on window.__TAURI__ via @tauri-apps/api

import type { Event, listen, invoke } from '@tauri-apps/api'

declare global {
  interface Window {
    __TAURI__?: {
      invoke: typeof invoke
      event: {
        listen: typeof listen
      }
    }
    eleveDesktop?: {
      writeClipboard: (text: string) => Promise<void>
    }
  }

  // Tauri-specific command types will be added as backend APIs are integrated
  type TauriCommand = string
  type TauriArgs = Record<string, unknown>
}

export {}
