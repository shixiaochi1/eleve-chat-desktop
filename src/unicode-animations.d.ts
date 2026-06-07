declare module 'unicode-animations' {
  interface SpinnerDef {
    frames: string[]
    interval: number
  }
  type BrailleSpinnerName = keyof typeof spinners
  const spinners: Record<string, SpinnerDef>
  export default spinners
  export type { BrailleSpinnerName }
}
