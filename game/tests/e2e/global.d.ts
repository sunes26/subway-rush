import type { GameState } from '../../src/state/types'
import type { InputFrame } from '../../src/core/input'

declare global {
  interface Window {
    __game?: {
      state(): GameState
      set(patch: Partial<GameState>): void
      input(f: Partial<InputFrame>): void
      minFps(): number
      stationStats(): { merged: number; dynamic: number } | null
      look(yaw: number, pitch?: number): void
      visibleGates(): number
      mode(): 'fp' | 'tp'
      toggleView(): void
      camTrace(): number[]
      setInterp(on: boolean): void
      /** P1 — 오디오 컨텍스트 생존 여부 */
      sfxReady(): boolean
      /** 화면 중앙 레이 — 아웃라인 셸이 판정을 오염시키는지 확인용 */
      pick(ndcX?: number, ndcY?: number): { name: string; dist: number; point: [number, number, number] }[]
    }
  }
}
export {}
