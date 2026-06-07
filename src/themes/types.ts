/**
 * Desktop app theme model.
 *
 *   colors      — Tailwind color tokens written directly to CSS vars.
 *   darkColors  — optional hand-tuned dark variant (else `colors` is reused
 *                 unchanged for dark, and a synth pass generates light).
 *   typography  — font families + optional stylesheet URL.
 *
 * Everything else (layout, sizing, radius, line-height) lives in styles.css.
 * Add new themes in `presets.js` — no other code changes needed.
 */

export interface DesktopThemeColors {
  background: string
  foreground: string
  card: string
  cardForeground: string
  muted: string
  mutedForeground: string
  popover: string
  popoverForeground: string
  primary: string
  primaryForeground: string
  secondary: string
  secondaryForeground: string
  accent: string
  accentForeground: string
  border: string
  input: string
  ring: string
  midground?: string
  midgroundForeground?: string
  composerRing?: string
  destructive: string
  destructiveForeground: string
  sidebarBackground?: string
  sidebarBorder?: string
  userBubble?: string
  userBubbleBorder?: string
}

export interface DesktopThemeTypography {
  fontSans: string
  fontMono: string
  fontUrl?: string
}

export interface DesktopTheme {
  name: string
  label: string
  description: string
  colors: DesktopThemeColors
  darkColors?: DesktopThemeColors
  typography?: Partial<DesktopThemeTypography>
}
