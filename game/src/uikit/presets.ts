/**
 * UI 킷 프리셋 — "이 UI를 보려면 상태가 어떤 모양이어야 하는가"의 목록.
 *
 * ★ 여기서 UI를 **다시 만들지 않는다.** 상태만 만들고, 그리는 일은 게임의 실제
 *   `createHud` · `createDialog` 가 한다. 마크업을 손으로 베끼면 UI를 고칠 때마다
 *   두 곳을 고쳐야 하고, 그건 반드시 갈라진다 — 킷이 예쁜데 게임은 아닌 상태.
 *
 * 각 프리셋은 시간 `t`(초)를 받아 상태를 돌려준다. 진행링·QTE 마커·양심 펄스처럼
 * **움직여야 판단되는 것**이 있어서 정지 화면으로는 부족하다.
 */

import { QTE } from '../data/tuning'
import { initialState } from '../state/reducer'
import type { FlagId, GameState, ItemId } from '../state/types'

export type Preset = Readonly<{
  id: string
  /** 사이드바 그룹 */
  group: string
  label: string
  /** 무엇을 보는 화면인지 한 줄 */
  note: string
  /** 시간(초) → 상태. 정적 화면은 t 를 무시한다 */
  state: (t: number) => GameState
}>

/** 대합실에 서 있는 기본 상태 — 모든 프리셋의 바탕 */
const base = (patch: Partial<GameState> = {}): GameState => {
  const s = initialState(7)
  return {
    ...s,
    phase: 'playing',
    cardBalance: 1600,
    player: { ...s.player, pos: { x: 42, y: 13.4, z: -6 } },
    zone: 'Z2',
    ...patch,
  }
}

const act = (s: GameState, patch: Partial<GameState['act']>): GameState =>
  ({ ...s, act: { ...s.act, ...patch } })

const inv = (items: readonly (ItemId | null)[]): readonly (ItemId | null)[] => items

/** 0..1 을 왕복하는 삼각파 — 진행률을 손으로 굴린다 */
const pingpong = (t: number, period: number): number => {
  const x = (t % period) / period
  return x < 0.5 ? x * 2 : 2 - x * 2
}

export const PRESETS: readonly Preset[] = [
  // ─────────────── 프롬프트 ───────────────
  {
    id: 'prompt-aimed',
    group: '프롬프트',
    label: '조준 — 골드 3px',
    note: '화면 중앙 레이가 대상을 물었을 때. 라벨 + [E]',
    state: () => act(base(), { targetId: 'OBJ-16', aimed: true }),
  },
  {
    id: 'prompt-near',
    group: '프롬프트',
    label: '근접 폴백 — 흐리게',
    note: '1.5m 안이지만 조준은 아님. 아웃라인이 얇고 프롬프트도 옅다',
    state: () => act(base(), { targetId: 'ACT-02-GP', aimed: false }),
  },
  {
    id: 'prompt-long',
    group: '프롬프트',
    label: '긴 라벨',
    note: '라벨이 길어도 안 깨지는지 — 붕어빵 노점(가격 포함)',
    state: () => {
      const s = base({ zone: 'Z1' })
      return act({ ...s, player: { ...s.player, pos: { x: -50, y: 30.2, z: 0 } } },
        { targetId: 'OBJ-03', aimed: true })
    },
  },

  // ─────────────── 진행링 ───────────────
  {
    id: 'ring-pickup',
    group: '진행링',
    label: '습득 0.8s',
    note: '짧은 동작 — 남은 초를 안 띄운다. 링만 채워진다',
    state: (t) => act(base(), {
      targetId: 'OBJ-16', aimed: true,
      busyId: 'OBJ-16', busyKind: 'pickup',
      busyTotalMs: 800, busyLeftMs: 800 * (1 - pingpong(t, 1.6)),
    }),
  },
  {
    id: 'ring-story',
    group: '진행링',
    label: '대화 15s — 남은 초',
    note: '3초 이상이면 남은 초를 같이 띄운다. 안 띄우면 멈춘 것처럼 느껴진다',
    state: (t) => act(base(), {
      targetId: 'ACT-02-GP', aimed: true,
      busyId: 'ACT-02-GP', busyKind: 'story',
      busyTotalMs: 15_000, busyLeftMs: 15_000 * (1 - (t % 8) / 8),
    }),
  },
  {
    id: 'ring-aside',
    group: '진행링',
    label: '"저기요…" 3s',
    note: 'O-03 인파벽에 말을 거는 동안',
    state: (t) => act(base({ zone: 'Z4' }), {
      targetId: 'ACT-CP', aimed: true,
      busyId: 'ACT-CP', busyKind: 'aside',
      busyTotalMs: 3000, busyLeftMs: 3000 * (1 - (t % 3.4) / 3.4),
    }),
  },

  // ─────────────── 사유 ───────────────
  {
    id: 'deny-need',
    group: '사유',
    label: '효자손이 필요하다',
    note: '조건 미충족. 상태는 아무것도 안 바뀌고 이 한 줄만 뜬다 (GDD §5.1)',
    state: () => act(base(), {
      targetId: 'OBJ-06', aimed: true, denyText: '효자손이 필요하다', denyMs: 1400,
    }),
  },
  {
    id: 'deny-money',
    group: '사유',
    label: '돈이 부족하다',
    note: '붕어빵 500원을 못 낼 때',
    state: () => act(base({ cardBalance: 300 }), {
      targetId: 'OBJ-03', aimed: true, denyText: '돈이 부족하다', denyMs: 1400,
    }),
  },
  {
    id: 'deny-long',
    group: '사유',
    label: '긴 사유',
    note: '두 줄로 넘어가지 않는지 — 최장 문안',
    state: () => act(base(), {
      targetId: 'ACT-02-GP', aimed: true,
      denyText: '이번엔 꽉 쥐고 있다 — 훔칠 수 없다', denyMs: 1400,
    }),
  },

  // ─────────────── 대화 3분기 ───────────────
  {
    id: 'dlg-plain',
    group: '대화 3분기',
    label: '붕어빵 없음 — [2] 회색',
    note: '회색 항목이 **왜** 회색인지 한 줄로 말한다',
    state: () => act(base(), { dialogId: 'ACT-02-GP' }),
  },
  {
    id: 'dlg-fish',
    group: '대화 3분기',
    label: '붕어빵 보유 — 3분기 전부',
    note: '세 줄 다 활성. 비용(+0s / +1.5s / +15s)이 오른쪽에',
    state: () => act(base({ inventory: inv(['I-12', null, null]) }), { dialogId: 'ACT-02-GP' }),
  },
  {
    id: 'dlg-locked',
    group: '대화 3분기',
    label: '훔치기 잠김',
    note: '한 번 당한 뒤 — [1] 이 닫히고 사유가 대신 들어간다',
    state: () => act(base({
      inventory: inv(['I-12', null, null]),
      flags: ['CHASE_DONE'] as readonly FlagId[],
    }), { dialogId: 'ACT-02-GP' }),
  },

  // ─────────────── QTE ───────────────
  {
    id: 'qte-start',
    group: 'QTE',
    label: '시작 — 0/3',
    note: '판정창(초록)과 마커(골드). 창이 안 보이면 판정은 운으로 읽힌다',
    state: () => ({
      ...base({ inventory: inv(['I-01', null, null]) }),
      qte: { active: true, vendorId: 'OBJ-06', strokes: 0, dir: 0, travel: 0,
        beatMs: QTE.beatMs, misses: 0, elapsedMs: 0 },
    }),
  },
  {
    id: 'qte-live',
    group: 'QTE',
    label: '진행 — 마커가 창을 지난다',
    note: '마커가 판정창 중앙에 있을 때 임계를 넘겨야 성공',
    state: (t) => {
      const beat = QTE.beatMs - ((t * 1000) % QTE.beatMs)
      return {
        ...base({ inventory: inv(['I-01', null, null]) }),
        qte: {
          active: true, vendorId: 'OBJ-06',
          strokes: Math.floor(t / 1.1) % 3,
          dir: (Math.floor(t) % 2 === 0 ? 1 : -1) as 1 | -1,
          travel: QTE.strokeTravel * pingpong(t, 1.1),
          beatMs: beat - QTE.beatMs / 2,
          misses: 0, elapsedMs: t * 1000,
        },
      }
    },
  },
  {
    id: 'qte-miss',
    group: 'QTE',
    label: '2/3 + 미스 1',
    note: '성공 점과 미스 카운터가 같이 보이는 상태',
    state: () => ({
      ...base({ inventory: inv(['I-01', null, null]) }),
      qte: { active: true, vendorId: 'OBJ-06', strokes: 2, dir: -1,
        travel: QTE.strokeTravel * 0.55, beatMs: 40, misses: 1, elapsedMs: 3200 },
    }),
  },

  // ─────────────── 인벤 3슬롯 ───────────────
  {
    id: 'inv-empty',
    group: '인벤 3슬롯',
    label: '빈 슬롯',
    note: '슬롯 압박 자체가 정보다 — 비어 있어도 칸은 보인다',
    state: () => base(),
  },
  {
    id: 'inv-full',
    group: '인벤 3슬롯',
    label: '가득 — 효자손·마스크·우산',
    note: '4번째를 주우면 0번이 밀려 바닥에 남는다',
    state: () => base({ inventory: inv(['I-01', 'I-06', 'I-09']) }),
  },
  {
    id: 'inv-worn',
    group: '인벤 3슬롯',
    label: '마스크 착용 — 녹색 테두리',
    note: '착용은 슬롯을 비우지 않는다. 테두리 색으로만 구분',
    state: () => base({
      inventory: inv(['I-06', 'I-12', null]),
      flags: ['MASK_ON'] as readonly FlagId[],
    }),
  },

  // ─────────────── 양심 게이지 ───────────────
  {
    id: 'cons-zero',
    group: '양심 게이지',
    label: '0 — 아무 일 없음',
    note: '상시 옅다. 시선을 끌면 도덕 점수판이 된다 (GDD §7.2)',
    state: () => base(),
  },
  {
    id: 'cons-good',
    group: '양심 게이지',
    label: '+3 — 선행',
    note: '0을 중심으로 우측(녹)으로 자란다. **숫자는 없다**',
    state: () => base({ scores: { conscience: 3, style: 2, knowledge: 1 } }),
  },
  {
    id: 'cons-bad',
    group: '양심 게이지',
    label: '−5 — 하한',
    note: '절도 −3 + 피격 누적. 이 상태로 승강장에 가면 E-10',
    state: () => base({ scores: { conscience: -5, style: 0, knowledge: 0 } }),
  },
  {
    id: 'cons-live',
    group: '양심 게이지',
    label: '변화 순간 — 0.6s 발광',
    note: '값이 바뀔 때만 밝아진다. 그 순간만 눈에 들어와야 한다',
    state: (t) => base({
      scores: { conscience: Math.floor(t) % 2 === 0 ? 1 : -2, style: 0, knowledge: 0 },
    }),
  },

  // ─────────────── HUD 계기판 ───────────────
  // Figma `game-hud-ui` 적용 후 신설. 위젯 4개가 각 모서리에 흩어졌으므로
  // "한 화면에서 같이 봐야" 균형을 판단할 수 있다.
  {
    id: 'hud-calm',
    group: 'HUD 계기판',
    label: '평시 — 3:00',
    note: '좌상단 스태미너 · 우상단 미니맵(잠김) · 하단 소지품 · 우하단 잔액',
    state: () => base(),
  },
  {
    id: 'hud-warn',
    group: 'HUD 계기판',
    label: '타이머 60s — 노랑',
    note: '4단계 중 2단계. 색만 바뀌고 자리는 그대로여야 같은 계기로 읽힌다',
    state: () => base({ timeLeftMs: 45_000 }),
  },
  {
    id: 'hud-crit',
    group: 'HUD 계기판',
    label: '타이머 8s — 적색 + 비네팅',
    note: '심박 애니 + 화면 가장자리 붉은 비네팅이 같이 걸린다',
    state: () => base({ timeLeftMs: 8000 }),
  },
  {
    id: 'hud-stam-low',
    group: 'HUD 계기판',
    label: '스태미너 잠김',
    note: '원형 게이지가 시안 → 적색. 위치·크기는 안 바뀐다',
    state: (t) => {
      const s = base()
      return { ...s, player: { ...s.player,
        stamina: 8 + Math.sin(t * 2) * 6, sprintLocked: true } }
    },
  },
  {
    id: 'hud-lowbal',
    group: 'HUD 계기판',
    label: '잔액 부족 — 적색 진동',
    note: '요금 1,400원 미달. 개찰구 도착 **전에** 알려야 한다 (GDD §7.2)',
    state: () => base({ cardBalance: 900 }),
  },
  {
    id: 'hud-zones',
    group: 'HUD 계기판',
    label: '존 배너 — 승강장',
    note: '예전 foot 의 Zone 칸이 미니맵 하단 배너로 옮겨졌다',
    state: () => {
      const s = base()
      return { ...s, zone: 'Z5', player: { ...s.player, pos: { x: 150, y: 6, z: -20 } } }
    },
  },

  // ─────────────── 종합 ───────────────
  {
    id: 'combo-chase',
    group: '종합',
    label: '추격 중 + 프롬프트',
    note: '단소 피격 토스트와 상호작용 프롬프트가 겹칠 때의 가독성',
    state: (t) => {
      const s = base({
        inventory: inv(['I-01', null, null]),
        scores: { conscience: -4, style: 0, knowledge: 0 },
        flags: ['GRANDPA_ANGRY'] as readonly FlagId[],
      })
      return act({
        ...s,
        fx: [
          { id: 1, kind: 'toast', text: '딱!  "이놈아!"', lifeMs: 1200 - (t % 1.2) * 1000, value: 0 },
          { id: 2, kind: 'balance', text: '+1,000원 동전', lifeMs: 1600 - (t % 1.6) * 1000, value: 1000 },
        ],
      }, { targetId: 'OBJ-06', aimed: true })
    },
  },
  {
    id: 'combo-lowbal',
    group: '종합',
    label: '잔액 부족 경고 + 사유',
    note: '적색 잔액(미세 진동)과 사유가 같이 뜰 때',
    state: () => act(base({ cardBalance: 900 }), {
      targetId: 'OBJ-06', aimed: true, denyText: '효자손이 필요하다', denyMs: 1400,
    }),
  },
]

export const GROUPS: readonly string[] =
  [...new Set(PRESETS.map((p) => p.group))]
