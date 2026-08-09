/**
 * 방해요소 테이블 — 12종 (GDD 부록 D · `docs/P2-SPEC.md` §4).
 *
 * ★ 여기에는 **무엇이 있는가**만 있다. **어떻게 발동하는가**는 `systems/obstacles.ts` 다.
 *   데이터와 판정을 갈라 두면 시드 선택 로직이 판정을 임포트하지 않아도 되고,
 *   그래서 이 모듈을 리듀서(`initialState`)가 안전하게 부를 수 있다.
 *
 * ⚠ **예전엔 셔플이었다.** 7종 중 4종만 골라 항상 켜지는 4종과 합쳐 8종 활성 —
 *   리플레이 유인으로 회차마다 다른 조합을 만드는 설계였다(GDD §11). 디렉터 지시로
 *   그 무작위성을 없앴다: 이제 OBS-14(플레이어 선택 발동)를 뺀 11종이 매 판 전부 켜진다.
 */

import { streamFor } from '../core/rng'
import type { ItemId, ZoneId } from '../state/types'

export type ObsId =
  | 'OBS-01' | 'OBS-02' | 'OBS-03' | 'OBS-04' | 'OBS-05'
  | 'OBS-07' | 'OBS-08' | 'OBS-10' | 'OBS-11' | 'OBS-12' | 'OBS-13' | 'OBS-14'

export type ObstacleDef = Readonly<{
  id: ObsId
  name: string
  zone: ZoneId
  /** 명목 비용(초) — 밸런스 분석용 참고치다(`costOf`). 실제 페널티는 판정 쪽 상수다. */
  costSec: number
  /** 무효화 아이템 — `systems/obstacles.ts` 의 표와 **양방향 일치**해야 한다(유닛이 강제) */
  counteredBy: readonly ItemId[]
}>

/** OBS-14(플레이어 선택 발동)를 뺀 나머지 11종 — 매 판 전부 켜진다 */
export const ACTIVE_OBSTACLES: readonly ObsId[] = [
  'OBS-01', 'OBS-02', 'OBS-03', 'OBS-04', 'OBS-05',
  'OBS-07', 'OBS-08', 'OBS-10', 'OBS-11', 'OBS-12', 'OBS-13',
]

/** OBS-14 단소 추격은 **유일하게 상시가 아니다** — 플레이어 선택으로만 발동한다 */
export const PLAYER_TRIGGERED: readonly ObsId[] = ['OBS-14']

export const OBSTACLES: Readonly<Record<ObsId, ObstacleDef>> = {
  'OBS-01': { id: 'OBS-01', name: '고장난 개찰구', zone: 'Z3', costSec: 8, counteredBy: ['I-11'] },
  'OBS-02': { id: 'OBS-02', name: '교통카드 잔액부족', zone: 'Z3', costSec: 6, counteredBy: ['I-01', 'I-02'] },
  // I-10(캐리어)은 디렉터 지시로 아이템 체계째 지웠다 — 남은 카운터로만 막는다
  'OBS-03': { id: 'OBS-03', name: '에스컬레이터 인파벽', zone: 'Z4', costSec: 15, counteredBy: ['I-09'] },
  'OBS-04': { id: 'OBS-04', name: '하차 인파 역류', zone: 'Z5', costSec: 10, counteredBy: ['I-06'] },
  'OBS-05': { id: 'OBS-05', name: '물청소 구역', zone: 'Z4', costSec: 6, counteredBy: ['I-08'] },
  // 실제 비용은 강제 대화 25.6초(`systems/preach.ts` PREACH_TOTAL_MS) — 예산 상한 계산용 명목치도 맞춘다.
  // 원래 학생 역할이던 유닛이 한때 "전단지 배포원"(구 OBS-06)으로 떨어져 나갔다가 다시
  // 이 방해요소로 합쳐졌다 — 아주머니·학생 둘 다 Z1 지상에서 순찰하며 아무나 걸리면 발동한다
  'OBS-07': { id: 'OBS-07', name: '"도 아세요" 아주머니+학생', zone: 'Z1', costSec: 26, counteredBy: ['I-05'] },
  // 실제 비용은 강제 대화 8초(`systems/zombieTalk.ts` zombieTalkTotalMs) — 예산 상한 계산용 명목치도 맞춘다.
  // 카운터(I-14 EMP)는 디렉터 지시로 아이템 체계째 지웠다 — 이제 못 막는다(디렉터 지시).
  'OBS-08': { id: 'OBS-08', name: '좀비폰족', zone: 'Z2', costSec: 8, counteredBy: [] },
  'OBS-10': { id: 'OBS-10', name: '공사중 출구 안내', zone: 'Z2', costSec: 20, counteredBy: ['I-13'] },
  'OBS-11': { id: 'OBS-11', name: '승차 대기줄 오선택', zone: 'Z5', costSec: 12, counteredBy: ['I-13'] },
  'OBS-12': { id: 'OBS-12', name: '스크린도어 닫힘', zone: 'Z5', costSec: 0, counteredBy: [] },
  'OBS-13': { id: 'OBS-13', name: '역무원 순찰', zone: 'Z3', costSec: 8, counteredBy: [] },
  'OBS-14': { id: 'OBS-14', name: '할아버지 단소 추격', zone: 'Z2', costSec: 12, counteredBy: ['I-12'] },
}

/** 명목 비용 합(초) — 밸런스 분석용. `ACTIVE_OBSTACLES` 11종을 다 더하면 얼마인지 */
export const costOf = (ids: readonly ObsId[]): number =>
  ids.reduce((sum, id) => sum + OBSTACLES[id].costSec, 0)

export const isActive = (active: readonly ObsId[], id: ObsId): boolean => active.includes(id)

// ═══════════════════════ 승차 대기줄 (R3 해소) ═══════════════════════

/**
 * 대기줄 3개의 인원. **합계는 고정, 분포는 시드**다 (`docs/P2-SPEC.md` §2.2).
 *
 * R3: *"노선도를 주우면 Z5 대기줄 ⓒ가 항상 정답이라 판단이 사라진다."*
 * 환승계단 위치는 실제 역이니 고정이고(노선도가 주는 정보), 줄 길이만 흔든다.
 * **둘을 곱해야 답이 나오므로 노선도가 있어도 판단이 남는다.**
 */
export const QUEUE_TOTAL = 21
export const QUEUE_MIN = 3
export const QUEUE_MAX = 11

const MAX_TRIES = 8

export const rollQueues = (seed: number): readonly number[] => {
  const rng = streamFor(seed, 'queue')
  const slack = QUEUE_TOTAL - QUEUE_MIN * 3          // 12
  const room = QUEUE_MAX - QUEUE_MIN                 // 8
  for (let i = 0; i < MAX_TRIES; i++) {
    const a = rng.int(0, room + 1)
    const b = rng.int(0, Math.min(room, slack - a) + 1)
    const c = slack - a - b
    if (c >= 0 && c <= room) return [QUEUE_MIN + a, QUEUE_MIN + b, QUEUE_MIN + c]
  }
  return [7, 7, 7]
}
