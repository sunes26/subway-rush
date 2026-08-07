/**
 * 펼친 우산 — **몸으로 미는 동사** (디렉터 지시 2026-08-07).
 *
 * 우산을 들고(`슬롯 키`) 펼친 뒤(`좌클릭`) 인파벽으로 걸어 들어가면 닿는 사람이 날아간다.
 * 여기서 하는 일은 그 판정 하나뿐이다: **반경 안에 든 사람을 소진 처리하고 방향을 준다.**
 *
 * ── 왜 시스템을 따로 뺐는가
 * `interact.ts` 는 **입력에 반응하는** 시스템이다. 이건 입력이 아니라 **위치**에 반응한다 —
 * 아무 키도 안 누르고 걷기만 해도 발동한다. 두 성격을 한 파일에 섞으면 "슬롯 키를
 * 눌렀을 때만 사람이 밀린다"는 P1의 가정이 조용히 남는다.
 *
 * ── 왜 이동 뒤인가
 * 판정 위치는 이번 스텝의 **최종 위치**여야 한다. 이동 앞이면 한 프레임 전 좌표로 재서
 * 스치듯 지나갈 때 "분명 닿았는데 안 날아갔다"가 나온다 (`chase.ts` 와 같은 근거).
 *
 * ★ 밀기 계수(`PUSH` · E-11)를 내는 곳은 **이 파일 하나뿐이다.** 예전 슬롯 키 경로는
 *   지웠다 — 두 경로가 남으면 같은 엔딩 조건이 경로마다 다른 속도로 찬다.
 *
 * ── 인파벽 3인 + 에스컬레이터 승객(장식)
 * 처음엔 `CP_IDS` 3인만 훑었다. *"다른 승객은 우산에 닿았을때 안 날라가는디?"* — 맞는
 * 지적이다. 화면에 서 있는 사람이면 다 맞아야지, "판정 대상이냐 장식이냐"는 플레이어
 * 눈에는 안 보이는 구분이다. `data/crowd.ts` 의 승객 좌표를 **같은 반경·같은 방식**으로
 * 훑는다 — 별도 시스템으로 안 쪼갠 이유가 바로 이거다(경로가 갈리면 나중에 또 하나만
 * 빼먹은 채 남는다).
 */

import { CP_IDS, byId } from '../data/interactables'
import { RIDER_SPOTS } from '../data/crowd'
import { UMBRELLA } from '../data/tuning'
import { ESCALATOR, FLOOR } from '../data/world'
import type { Action, GameState } from '../state/types'
import { rampZ } from './collision'

export type UmbrellaCtx = Readonly<{ dtMs: number }>

/** 훑기 대상 하나 — 인파벽·장식 승객이 같은 모양으로 들어온다 */
type SweepTarget = Readonly<{ id: string; x: number; y: number; z: number }>

const sweepTargets = (): readonly SweepTarget[] => [
  ...CP_IDS
    .map((id) => byId(id))
    .filter((it): it is NonNullable<typeof it> => !!it)
    .map((it) => ({ id: it.id, x: it.x, y: it.y, z: it.z })),
  // 좌표가 전부 ESCALATOR rect 안이라 rampZ 는 실제로 null 을 안 낸다 — 타입만 맞춘다
  ...RIDER_SPOTS.map((r) => ({ id: r.id, x: r.x, y: r.y, z: rampZ(ESCALATOR, r.x, r.y) ?? FLOOR.B1 })),
]

/**
 * 지금 우산이 사람을 날릴 수 있는 상태인가.
 *
 * 순수 함수로 빼 둔 이유는 렌더(`render/held.ts`)와 HUD 가 같은 판정을 읽어야 하기
 * 때문이다 — "펼쳤다"와 "효력이 있다"가 갈라지면 화면이 거짓말을 한다.
 */
export const umbrellaArmed = (s: GameState): boolean =>
  s.hand.item === 'I-09' && s.hand.open && s.phase === 'playing'

export const umbrellaSystem = (s: GameState, ctx: UmbrellaCtx): Action[] => {
  void ctx.dtMs                       // 시간 적분이 없다 — 닿았는가만 본다
  if (!umbrellaArmed(s)) return []

  const p = s.player.pos
  const out: Action[] = []
  /**
   * 토스트는 **이번 판에 한 번뿐이다.**
   *
   * 3인이 1.2m 간격이라 뛰어서 훑으면 0.24초 간격으로 셋이 다 맞는다. 토스트 수명이
   * 1.4초라 같은 문장이 세 줄 쌓여 화면 가운데를 덮었다(실측). 두 번째부터는 **사람이
   * 날아가는 것 자체가 피드백**이고, 흔들림은 매번 준다.
   */
  let toasted = s.tally.pushes > 0

  for (const it of sweepTargets()) {
    if (s.act.consumed.includes(it.id)) continue        // 이미 비켰거나 날아갔다
    // 층이 다르면 안 닿는다 — 대합실(B1)의 인파를 승강장(B2)에서 훑을 수는 없다
    if (Math.abs(it.z - p.z) > 1.2) continue
    const dx = it.x - p.x
    const dy = it.y - p.y
    const d = Math.hypot(dx, dy)
    if (d > UMBRELLA.sweepM) continue

    /**
     * 날아가는 방향 = **플레이어 → 그 사람**. 겹쳐 서서 거리가 0에 가까우면 방향이
     * 정의되지 않으므로 그때만 플레이어가 보는 쪽으로 보낸다(뒤로 날아가는 것보다 낫다).
     */
    const [ux, uy] = d > 1e-3
      ? [dx / d, dy / d]
      : [Math.cos(s.player.facing), Math.sin(s.player.facing)]

    out.push(
      { t: 'ACT_CONSUME', id: it.id },
      { t: 'KNOCK', id: it.id, dx: ux, dy: uy },
      { t: 'PUSH' },
      { t: 'ITEM_USED', item: 'I-09' },
      { t: 'FX', kind: 'shake', text: '', lifeMs: 220, value: 0.6 },
    )
    if (!toasted) {
      out.push({ t: 'FX', kind: 'toast', text: '우산에 걸려 날아갔다', lifeMs: 1400, value: 0 })
      toasted = true
    }
  }

  return out
}
