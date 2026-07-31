import type { GameState } from '../../src/state/types'
import type { InputFrame } from '../../src/core/input'

declare global {
  interface Window {
    __game?: {
      state(): GameState
      set(patch: Partial<GameState>): void
      input(f: Partial<InputFrame>): void
      minFps(): number
    }
  }
}
export {}
