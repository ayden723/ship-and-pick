export type Option = { n: number; label: string }

declare module 'claude-code' {
  interface PluginState {
    'option-picker': { options: Shaped<Option[]>; picked: number[] }
  }
}
