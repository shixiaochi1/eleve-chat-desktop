# CLAUDE.md

This file provides context to Claude when working in this repository.

## Project: Eleve Agent

Eleve is a next-gen AI agent platform, written entirely in Rust with a Tauri v2 + React frontend.

## Architecture (V4)

```
Tauri App (Pure UI Shell)
  └── spawns eleved.exe (CREATE_NO_WINDOW, --home <path>)
        └── HTTP API on 127.0.0.1:0 (dynamic port)
              └── Frontend discovers port via gateway_state.json
```

## Key Conventions

- **No emoji in UI** — use lucide-react exclusively (`strokeWidth={1.5}`)
- **Apple macOS design** — dark theme `#1c1c1e`, light theme `#f5f5f7`
- **Icons**: centralized in `src/components/Icons.jsx`
- **Panels**: sessions, cron, skills, tools, debug, settings, about
- **Path**: `C:\Users\Administrator\Eleve Agent\eleve-chat-desktop`

## Build

```powershell
# Dev mode (source debugging)
npm run tauri dev

# Production build
npm run tauri build
```
