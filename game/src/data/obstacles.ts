/**
 * 방해요소 테이블 — 13종 (GDD 부록 D · `docs/P2-SPEC.md` §4).
 *
 * ★ 여기에는 **무엇이 있는가**만 있다. **어떻게 발동하는가**는 `systems/obstacles.ts` 다.
 *   데이터와 판정을 갈라 두면 시드 선택 로직이 판정을 임포트하지 않아도 되고,
 *   그래서 이 모듈을 리듀서(`initialState`)가 안전하게 부를 수 있다.
 *
 * 시드는 12종 중 **4종**을 고른다(항상 켜지는 4종과 합쳐 8종 활성).
 * GDD §11: *"시드당 8~9종만 활성화. 나머지는 다른 회차에 등장 → 리플레이 유인으로 전환."*
 */

import { streamFor } from '../core/rng'
import type { ItemId, ZoneId } from '../state/types'

export type ObsId =
  | 'OBS-01' | 'OBS-02' | 'OBS-03' | 'OBS-04' | 'OBS-05' | 'OBS-06'
  | 'OBS-07' | 'OBS-08' | 'OBS-10' | 'OBS-11' | 'OBS-12' | 'OBS-13' | 'OBS-14'

export type ObstacleDef = Readonly<{
  id: ObsId
  name: string
  zone: ZoneId
  /**
   * 명목 비용(초). **예산 상한 계산에만 쓴다** — 실제 페널티는 판정 쪽 상수다.
   * OBS-13(역무원)은 시간을 안 깎지만 0으로 두면 "공짜 방해요소"가 되어
   * 셔플이 매번 집어 온다. 위험 대용치로 8을 매긴다.
   */
  costSec: number
  /** 무효화 아이템 — `systems/obstacles.ts` 의 표와 **양방향 일치**해야 한다(유닛이 강제) */
  counteredBy: readonly ItemId[]
}>

/**
 * 항상 켜진다 — 이 4종이 게임의 뼈대다.
 * 고장 개찰구가 없으면 개찰구가 그냥 문이고, 대기줄이 없으면 승강장에 판단이 없다.
 */
export const ALWAYS_ON: readonly ObsId[] = ['OBS-01', 'OBS-02', 'OBS-11', 'OBS-12']

/** 시드가 이 8종 중 4종을 고른다 */
export const SHUFFLE_POOL: readonly ObsId[] = [
  'OBS-03', 'OBS-04', 'OBS-05', 'OBS-06', 'OBS-07', 'OBS-08', 'OBS-10', 'OBS-13',
]

/** OBS-14 단소 추격은 **유일하게 시드 무관** — 플레이어 선택으로만 발동한다 */
export const PLAYER_TRIGGERED: readonly ObsId[] = ['OBS-14']

export const OBSTACLES: Readonly<Record<ObsId, ObstacleDef>> = {
  'OBS-01': { id: 'OBS-01', name: '고장난 개찰구', zone: 'Z3', costSec: 8, counteredBy: ['I-11'] },
  'OBS-02': { id: 'OBS-02', name: '교통카드 잔액부족', zone: 'Z3', costSec: 6, counteredBy: ['I-01', 'I-02'] },
  'OBS-03': { id: 'OBS-03', name: '에스컬레이터 인파벽', zone: 'Z4', costSec: 15, counteredBy: ['I-09', 'I-10'] },
  'OBS-04': { id: 'OBS-04', name: '하차 인파 역류', zone: 'Z5', costSec: 10, counteredBy: ['I-06', 'I-10'] },
  'OBS-05': { id: 'OBS-05', name: '물청소 구역', zone: 'Z4', costSec: 6, counteredBy: ['I-08'] },
  'OBS-06': { id: 'OBS-06', name: '전단지 배포원', zone: 'Z1', costSec: 5, counteredBy: ['I-05'] },
  // 실제 비용은 강제 대화 25.6초(`systems/preach.ts` PREACH_TOTAL_MS) — 예산 상한 계산용 명목치도 맞춘다
  'OBS-07': { id: 'OBS-07', name: '"도 아세요" 아주머니', zone: 'Z2', costSec: 26, counteredBy: ['I-05'] },
  'OBS-08': { id: 'OBS-08', name: '좀비폰족', zone: 'Z2', costSec: 4, counteredBy: ['I-14'] },
  'OBS-10': { id: 'OBS-10', name: '공사중 출구 안내', zone: 'Z2', costSec: 20, counteredBy: ['I-13'] },
  'OBS-11': { id: 'OBS-11', name: '승차 대기줄 오선택', zone: 'Z5', costSec: 12, counteredBy: ['I-13'] },
  'OBS-12': { id: 'OBS-12', name: '스크린도어 닫힘', zone: 'Z5', costSec: 0, counteredBy: [] },
  'OBS-13': { id: 'OBS-13', name: '역무원 순찰', zone: 'Z3', costSec: 8, counteredBy: [] },
  'OBS-14': { id: 'OBS-14', name: '할아버지 단소 추격', zone: 'Z2', costSec: 12, counteredBy: ['I-12'] },
}

/** 셔플로 고르는 개수 */
export const SHUFFLE_PICK = 4

/**
 * 선택된 4종의 명목 비용 합 상한(초).
 *
 * 상한이 필요한 이유: 8종 pool 의 상위 4종을 다 뽑으면 20+15+15+10 = **60초**다.
 * 표준 플레이가 183초에 제한 180초라 의도적 적자가 3초뿐인데(프로젝트 메모),
 * 여기서 60초가 얹히면 그 시드는 시작부터 실패다.
 */
export const COST_CAP_SEC = 45

const MAX_TRIES = 8

/**
 * 이번 판의 활성 방해요소.
 *
 * 상한을 못 맞추면 **비용 낮은 순 4종**으로 격하한다. 던지지 않는다 —
 * `initialState` 가 부르는 자리라 예외는 곧 검은 화면이다.
 * (격하는 도달 불가가 아니라 *덜 재밌는* 결과다. 게임은 계속 돈다.)
 */
export const rollObstacles = (seed: number, all = false): readonly ObsId[] => {
  /**
   * `?obs=all` — **전량 활성 디버그 스위치.**
   *
   * 시드가 12종 중 8종만 켜므로 아주머니나 좀비폰족이 **통째로 없는 판**이 정상적으로 존재한다.
   * 그건 설계지만(리플레이 유인), 확인할 때는 다 서 있어야 한다 —
   * "구현이 안 된 것 같다"와 "이번 판에 안 켜졌다"를 눈으로 구분할 수 없기 때문이다.
   * 밸런스에는 안 쓴다(스윕·테스트는 항상 시드 경로를 탄다).
   */
  if (all) return [...ALWAYS_ON, ...SHUFFLE_POOL].sort()
  const rng = streamFor(seed, 'obstacles')
  for (let i = 0; i < MAX_TRIES; i++) {
    const pick = rng.shuffle(SHUFFLE_POOL).slice(0, SHUFFLE_PICK)
    if (costOf(pick) <= COST_CAP_SEC) return [...ALWAYS_ON, ...pick].sort()
  }
  const cheap = [...SHUFFLE_POOL]
    .sort((a, b) => OBSTACLES[a].costSec - OBSTACLES[b].costSec)
    .slice(0, SHUFFLE_PICK)
  return [...ALWAYS_ON, ...cheap].sort()
}

export const costOf = (ids: readonly ObsId[]): number =>
  ids.reduce((sum, id) => sum + OBSTACLES[id].costSec, 0)

/** 셔플 대상만의 비용 — 항상 켜지는 4종은 예산 상한 밖이다(뼈대라 뺄 수 없다) */
export const shuffledCostOf = (ids: readonly ObsId[]): number =>
  costOf(ids.filter((id) => SHUFFLE_POOL.includes(id)))

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
