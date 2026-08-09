/**
 * 방해요소 판정 — OBS-05·06·07·08·10 (`docs/P2-SPEC.md` §4).
 *
 * ★ **표 하나에 한 줄을 더하면 방해요소가 하나 는다.** 6종을 6일이 아니라 하루에 짜는 방법이고,
 *   동시에 "이 방해는 무엇으로 막는가"가 한 화면에서 읽히게 하는 방법이다.
 *
 * ★ 활성 목록에 없는 id 는 **조건을 만족해도 침묵한다** (`s.obstacles`).
 *   시드가 12종 중 8종만 켜기 때문이고, 그게 두 번째 판이 첫 판과 달라지는 이유다.
 *
 * ★ 이 시스템은 `crowd` **뒤**에 온다. 인파에 밀려 물청소 구역으로 들어가는 일이 있고,
 *   앞에 두면 밀리기 전 위치로 판정해 "분명 밟았는데 안 미끄러졌다"가 된다.
 *
 * OBS-13(역무원)은 위치·시야를 가진 액터라 `systems/staff.ts` 가 따로 맡는다.
 */

import { itemDef } from '../data/items'
import { OBSTACLES, type ObsId } from '../data/obstacles'
import { OBSTACLE } from '../data/tuning'
import { FLOOR } from '../data/world'
import type { Action, GameState, ItemId } from '../state/types'
import { ZOMBIE_TALK_LINES } from './zombieTalk'

export type ObsCtx = Readonly<{ dtMs: number; prev: GameState }>

/** 축에 나란한 사각 구역 [xMin, yMin, xMax, yMax] */
type Rect = readonly [number, number, number, number]

const inRect = (r: Rect, x: number, y: number): boolean =>
  x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]

const onFloor = (z: number, floor: number): boolean => Math.abs(z - floor) < 2.5

const near = (s: GameState, x: number, y: number, m: number): boolean =>
  Math.hypot(s.player.pos.x - x, s.player.pos.y - y) <= m

const wearing = (s: GameState, item: ItemId): boolean => {
  const f = itemDef(item).flag
  return f ? s.flags.includes(f) : false
}

const holding = (s: GameState, item: ItemId): boolean => s.inventory.includes(item)

// ─────────────────────────── 배치 ───────────────────────────

/** OBS-05 물청소 구역 — Z4 운임구역 통로(x 72~95.8 · y 2~12) 한가운데 */
export const WET_ZONE: Rect = [82, 4.4, 89, 9.6]

/**
 * OBS-07 "도 아세요" 아주머니+학생 — Z1 지상, 인도 남북 구간을 각자 독립적으로 왕복한다
 * (디렉터 지시). 원래 학생 역할이 개발 중 전단지 배포원(구 OBS-06)으로 떨어져 나갔던 걸
 * 다시 아주머니의 파트너로 합쳤다 — 더 이상 붙어 다니지 않고, 7.6m 떨어진 평행선을
 * 각자 순찰한다. 아무나 반경에 걸리면 같은 강제 대화(`systems/preach.ts`)가 시작된다.
 */
const PREACH_Y_MIN = 22.7
const PREACH_Y_MAX = 32.7
const AUNTIE_X = -8.2
const STUDENT_X = -15.8

/**
 * 순찰 y — 좀비폰족(`zombieAt`)과 같은 수법: **시간의 순수 함수**라 렌더와 판정이
 * 같은 식을 쓴다. 아주머니·학생 둘 다 같은 위상으로 걷는다(디렉터가 위상차를
 * 특정하지 않았다 — 각자 독립된 경로만 요구했다).
 */
const preachPatrolY = (elapsedMs: number): number => {
  const period = OBSTACLE.preachPeriodMs
  const t = ((elapsedMs % period) / period) * 2          // 0..2
  const k = t <= 1 ? t : 2 - t                           // 삼각파 0..1..0
  return PREACH_Y_MIN + k * (PREACH_Y_MAX - PREACH_Y_MIN)
}

export const auntieAt = (elapsedMs: number): { x: number; y: number } =>
  ({ x: AUNTIE_X, y: preachPatrolY(elapsedMs) })

export const studentAt = (elapsedMs: number): { x: number; y: number } =>
  ({ x: STUDENT_X, y: preachPatrolY(elapsedMs) })

/**
 * OBS-10 공사중 막다른 길 — `OBJ-28-N`(y 6.6~7.0, x 44~56)과
 * `OBJ-28-W`(x 43.8~44.2) 가 감싸는 남쪽 주머니. 들어가면 되돌아 나와야 한다.
 */
export const CONSTRUCTION_POCKET: Rect = [44.4, 0.4, 55.8, 6.4]

/**
 * OBS-08 좀비폰족 — **시간의 순수 함수**다(열차·역류와 같은 규약).
 * Z2 유도선 축(y 14)을 x 6↔40 왕복. 위치가 상태에 없으므로 렌더도 같은 식을 쓴다.
 */
export const zombieAt = (elapsedMs: number): { x: number; y: number } => {
  const period = OBSTACLE.zombiePeriodMs
  const t = ((elapsedMs % period) / period) * 2          // 0..2
  const k = t <= 1 ? t : 2 - t                           // 삼각파 0..1..0
  return { x: 6 + k * 34, y: 14 }
}

// ─────────────────────────── 규칙표 ───────────────────────────

type Rule = Readonly<{
  id: ObsId
  /** 발동 조건 — 순수. 상태만 본다 */
  fires: (s: GameState) => boolean
  /** 발동 시 효과 (무효화되지 않았을 때만) */
  effect: (s: GameState) => readonly Action[]
  /** 무효화됐을 때의 안내 — 조용히 지나가면 아이템이 일한 줄 모른다 */
  negatedText: string
  cooldownMs: number
}>

/** 미끄러질 때 떨어뜨릴 칸 — 뒤에서부터 찾는다(0번은 방금 주운 것일 확률이 높다) */
const fumbleSlot = (s: GameState): number => {
  for (let i = s.inventory.length - 1; i >= 0; i--) if (s.inventory[i]) return i
  return -1
}

const RULES: readonly Rule[] = [
  {
    id: 'OBS-05',
    // **뛸 때만 미끄러진다.** 걸으면 안전한 것이 이 방해의 대응책 하나다
    // (신문지가 없어도 통과할 길이 있어야 한다 — GDD §11 "재미없는 실패" 회피)
    fires: (s) => onFloor(s.player.pos.z, FLOOR.B1) &&
      inRect(WET_ZONE, s.player.pos.x, s.player.pos.y) && s.player.sprinting,
    effect: (s) => {
      const slot = fumbleSlot(s)
      return [
        { t: 'STALL', ms: OBSTACLE.wetStallMs },
        { t: 'FX', kind: 'shake', text: '', lifeMs: 380, value: 1 },
        { t: 'FX', kind: 'toast', text: '젖은 바닥 — 미끄러졌다', lifeMs: 1800, value: 0 },
        ...(slot >= 0 ? [{ t: 'FUMBLE', slot } as Action] : []),
      ]
    },
    negatedText: '신문지를 깔고 지났다',
    cooldownMs: OBSTACLE.wetCooldownMs,
  },
  {
    id: 'OBS-07',
    fires: (s) => {
      // 대화가 이미 진행 중이면 다시 발동하지 않는다 — 좀비폰족(OBS-08)과 같은 이유:
      // 쿨다운(25s)이 대화 길이(약 26s)보다 짧아, 이 가드가 없으면 막바지에 재충돌로
      // 다시 시작될 수 있다
      if (s.preach.active) return false
      if (!onFloor(s.player.pos.z, FLOOR.L0)) return false
      const auntie = auntieAt(s.elapsedMs)
      const student = studentAt(s.elapsedMs)
      return near(s, auntie.x, auntie.y, OBSTACLE.preachRangeM) ||
        near(s, student.x, student.y, OBSTACLE.preachRangeM)
    },
    // 시간을 깎지 않는다 — 대화가 끝날 때까지 그 자리에 붙잡힌다 (`systems/movement.ts` isTalkLocked)
    effect: () => [{ t: 'PREACH_START' }],
    negatedText: '이어폰 — 못 들은 척했다',
    cooldownMs: OBSTACLE.talkCooldownMs,
  },
  {
    id: 'OBS-08',
    fires: (s) => {
      // 대화가 이미 진행 중이면 다시 발동하지 않는다 — 쿨다운(6s)이 대화 길이(8s)보다
      // 짧아서, 이 가드가 없으면 대화 막바지에 재충돌로 다시 시작될 수 있다
      if (s.zombieTalk.active) return false
      if (!onFloor(s.player.pos.z, FLOOR.B1)) return false
      const z = zombieAt(s.elapsedMs)
      return near(s, z.x, z.y, OBSTACLE.zombieRangeM)
    },
    // 시간을 깎지 않는다 — 대화가 끝날 때까지 그 자리에 붙잡힌다 (`systems/movement.ts` isTalkLocked)
    effect: (s) => [
      // 세트 3종을 순환한다 — 시드가 아니라 이번 충돌 시각으로 고른다(Math.random 금지 규칙)
      { t: 'ZOMBIE_TALK_START', variant: Math.floor(s.elapsedMs) % ZOMBIE_TALK_LINES.length },
    ],
    negatedText: 'EMP — 폰이 꺼지자 길이 열렸다',
    cooldownMs: OBSTACLE.zombieCooldownMs,
  },
  {
    id: 'OBS-10',
    fires: (s) => onFloor(s.player.pos.z, FLOOR.B1) &&
      inRect(CONSTRUCTION_POCKET, s.player.pos.x, s.player.pos.y),
    effect: () => [
      { t: 'TIME_PENALTY', ms: OBSTACLE.constructionPenaltyMs, label: '공사중' },
      { t: 'FX', kind: 'toast', text: '공사중 — 막다른 길이다. 돌아가야 한다', lifeMs: 2600, value: 0 },
    ],
    negatedText: '노선도 — 공사 구간을 미리 알았다',
    cooldownMs: OBSTACLE.constructionCooldownMs,
  },
]

export const RULE_IDS: readonly ObsId[] = RULES.map((r) => r.id)

/**
 * 무효화 판정 — **아이템 정의(`items.ts negates`)를 단일 원천으로 쓴다.**
 * 방해요소 테이블에도 같은 정보가 있지만 그쪽은 문서용이고, 유닛 테스트가 둘을 대조한다.
 */
const counterFor = (s: GameState, id: ObsId): ItemId | null => {
  for (const item of OBSTACLES[id].counteredBy) {
    const def = itemDef(item)
    if (def.use === 'wear') { if (wearing(s, item)) return item }
    else if (holding(s, item)) return item
  }
  return null
}

export const obstacleSystem = (s: GameState, ctx: ObsCtx): Action[] => {
  if (s.phase !== 'playing') return []

  const out: Action[] = []

  // 봉쇄 중이면 이동을 되돌린다 — `crowd` 의 수법과 같다(그래서 이 시스템이 이동 뒤다)
  if (s.player.stallMs > 0) {
    out.push({
      t: 'MOVE',
      pos: ctx.prev.player.pos,
      vel: { x: 0, y: 0 },
      facing: s.player.facing,
      rampId: s.player.rampId,
      moving: false,
      sprinting: false,
      vz: 0,
      grounded: true,
      airborneMs: 0,
      jumpBufferMs: 0,
    })
  }

  for (const rule of RULES) {
    if (!s.obstacles.includes(rule.id)) continue          // 이번 판에 안 켜진 방해
    if ((s.obsCooldown[rule.id] ?? 0) > 0) continue
    if (!rule.fires(s)) continue

    out.push({ t: 'OBS_FIRE', id: rule.id, cooldownMs: rule.cooldownMs })

    const counter = counterFor(s, rule.id)
    if (counter) {
      const def = itemDef(counter)
      const slot = s.inventory.indexOf(counter)
      // 자동 소모형(신문지·EMP)은 여기서 값을 치른다. 착용형은 그대로 남는다
      if (def.consumable && def.use === 'auto' && slot >= 0) {
        out.push({ t: 'ITEM_SPEND', slot }, { t: 'ITEM_USED', item: counter })
      }
      out.push({ t: 'FX', kind: 'toast', text: rule.negatedText, lifeMs: 1800, value: 0 })
      continue
    }

    out.push(...rule.effect(s))
  }

  return out
}
