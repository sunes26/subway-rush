/**
 * 사운드 **타이밍 규칙** — 순수 함수만 (`docs/P2-TECH-PLAN.md` §3.8).
 *
 * ★ WebAudio 를 만지지 않는다. 그래서 헤드리스로 검증할 수 있다 —
 *   P1에서 저더를 SwiftShader가 재현하지 못해 *루프 수식만 떼어내* 유닛으로 옮긴 것과
 *   같은 수법이다(`tests/unit/interp.test.ts`). 관측 못 하는 환경의 통과는 거짓 안심이다.
 */

import type { StepKind } from './sfx'
import { TIMER_STAGES } from '../data/tuning'
import { FLOOR } from '../data/world'
import type { GameState } from '../state/types'

/**
 * 보폭 주기(ms) — 걷기 0.52s · 뛰기 0.34s. 실제 보행 케이던스(115/175 spm).
 *
 * ⚠ **재생을 모는 값이 아니다.** 발소리는 녹음 루프를 게이팅으로 튼다(`audio/footsteps.ts`).
 * 이 상수는 샘플 로드가 실패했을 때의 **절차 생성 폴백** 경로만 쓴다.
 */
export const STEP_WALK_MS = 520
export const STEP_SPRINT_MS = 340

export const stepIntervalMs = (sprinting: boolean): number =>
  sprinting ? STEP_SPRINT_MS : STEP_WALK_MS

/**
 * 발소리 재질 — 층으로 가른다.
 * 지상(L0)은 보도, 지하는 타일, 경사로 위(rampId 있음)는 계단.
 */
export const stepKindOf = (s: GameState): StepKind => {
  if (s.player.rampId) return 'stairs'
  return Math.abs(s.player.pos.z - FLOOR.L0) < 1.5 ? 'pavement' : 'tile'
}

/**
 * 심박 — **잔여 30초 미만에서만**. 3분 내내 울리면 긴박이 아니라 피로다.
 * 60 → 110 BPM 으로 선형 가속한다.
 */
export const HEART_START_MS = TIMER_STAGES.hot          // 30_000
const BPM_SLOW = 60
const BPM_FAST = 110

export const heartbeatOn = (s: GameState): boolean =>
  s.phase === 'playing' && !s.freeplay && s.timeLeftMs > 0 && s.timeLeftMs < HEART_START_MS

/** 0(여유) ~ 1(임박) */
export const heartIntensity = (timeLeftMs: number): number =>
  Math.max(0, Math.min(1, 1 - timeLeftMs / HEART_START_MS))

export const heartbeatIntervalMs = (timeLeftMs: number): number => {
  const bpm = BPM_SLOW + (BPM_FAST - BPM_SLOW) * heartIntensity(timeLeftMs)
  return 60_000 / bpm
}

/**
 * 안내방송 — 열차 상태가 바뀌는 지점에서만 운다.
 * `arriving`(접근) 과 `closing`(문 닫힘) 둘. **`closing` 은 `doorWarn` 과 겹치므로 안 낸다.**
 */
export const announceOn = (state: GameState['train']['state'], prev: GameState['train']['state']):
  boolean => state === 'arriving' && prev !== 'arriving'

/**
 * 발소리 저역 통과(Hz) — 원본이 실외 자갈길이라 **지하에서는 눌러야** 벽에 막힌 소리가 된다.
 * 리버브를 안 쓰는 이유: 컨볼버 하나가 IR 에셋을 또 부른다.
 */
export const stepCutoffOf = (s: GameState): number => {
  if (s.player.rampId) return 3200                    // 계단통 — 좁고 울린다
  return Math.abs(s.player.pos.z - FLOOR.L0) < 1.5 ? 6800 : 2400
}

/** 존별 앰비언스 대역(Hz) — 지상은 밝고 지하는 먹먹하다 */
export const ambienceHzOf = (s: GameState): number => {
  const z = s.player.pos.z
  if (Math.abs(z - FLOOR.L0) < 1.5) return 900        // 지상 — 교통 소음
  if (Math.abs(z - FLOOR.B2) < 3.0) return 320        // 승강장 — 터널 저역
  return 520                                          // 대합실
}
