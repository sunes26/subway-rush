/**
 * NPC 배치·상태 동기 — 할아버지(GP) · 인파 3인(CP) · 에스컬레이터 승객(장식) · P2 방해요소 액터 4종.
 *
 * 이 파일은 **게임 규칙을 담지 않는다.** 무엇이 소진됐는지·누가 화났는지는 시뮬이 정하고
 * 여기서는 그 결과를 읽어 클립과 좌표로 옮긴다. 그래서 상태를 되짚어 쓰는 코드가 없고,
 * 프레임을 건너뛰어도 화면이 어긋나지 않는다(항상 현재 상태에서 다시 계산한다).
 *
 * 좌표는 `data/interactables.ts` 에서 읽는다. 여기서 새로 만들지 않는다 —
 * 그림과 판정이 갈라지는 결함을 P0 에서 열한 번 봤다. 상호작용 대상이 곧 그 사람이다.
 */

import { Group } from 'three'
import { RIDER_SPOTS, disembarkAt, disembarkAtOpp } from '../data/crowd'
import { CP_IDS, GRANDPA_ID, byId } from '../data/interactables'
import { DISEMBARK, OBSTACLE, UMBRELLA } from '../data/tuning'
import { ESCALATOR, FLOOR } from '../data/world'
import type { GameState, ObsId } from '../state/types'
import { rampZ } from '../systems/collision'
import { secondsSinceDoorsOpen, secondsSinceDoorsOpenOpp } from '../systems/disembark'
import { FLYER_AT, ajummaAt, zombieAt } from '../systems/obstacles'
import { staffAt } from '../systems/staff'
import { loadNpcRig, type NpcRig } from './npc-rig'

export type Actors = Readonly<{
  root: Group
  sync(s: GameState, dtSec: number): void
  dispose(): void
}>

/**
 * P2 방해요소 액터 — **리그는 진작 있었는데 반입이 안 돼 있었다.**
 *
 * 판정(`systems/obstacles.ts` · `systems/staff.ts`)만 돌고 몸이 없어서
 * *"도 아십니까 아주머니가 구현 안 된 것 같다"* 는 지적이 나왔다. 보이지 않는 방해요소는
 * GDD §11 이 금지한 **단서 없는 랜덤 처형**이다 — 피할 대상이 화면에 있어야 피한다.
 *
 * 프롭이 곧 정체다: `PR_Flyer`(전단지) · `PR_Book`(도 아세요) · `PR_Phone`(좀비폰족).
 */
const OBS_ACTORS = [
  { key: 'ajp', obs: 'OBS-06' as ObsId, file: 'ajp_character_rigged.glb' },
  { key: 'aj', obs: 'OBS-07' as ObsId, file: 'aj_character_rigged.glb' },
  { key: 'zp', obs: 'OBS-08' as ObsId, file: 'zp_character_rigged.glb' },
  { key: 'ss', obs: 'OBS-13' as ObsId, file: 'ss_character_rigged.glb' },
] as const

/**
 * 이 거리를 넘으면 통째로 끈다.
 *
 * 스킨드 메시는 인스턴싱이 안 된다 — 캐릭터 한 명이 곧 드로우콜 몇 개다.
 * 선례는 존 가시성(`station.ts:806`)과 차량(`main.ts:158`)이고, 둘 다 "존 밖인데
 * 계속 그리고 있었다"를 실측으로 잡은 뒤에 들어갔다. 같은 값을 미리 지불한다.
 * 40 m 는 안개 far 안쪽이라, 꺼지는 순간이 화면에 잡히지 않는다.
 */
const CULL_RANGE_M = 40

/**
 * P2 액터 컬링 — GP·CP 보다 **짧다**(26 m).
 *
 * 스킨드 메시는 인스턴싱이 안 되므로 한 명이 곧 드로우 콜 몇 개다. Z2 핫스팟이 이미
 * 236/245 라 여유가 없다. 26 m 는 아주머니 반경(3 m)의 8배 이상이라
 * **보이는 것과 잡히는 것이 갈라지지 않는다**(`render/props.ts` 와 같은 기준).
 */
const OBS_CULL_M = 26

/**
 * 할아버지가 보는 방향 — 남쪽(−y).
 * `ACT-02-BENCH` 는 at(42, 15, 2.4, 0.8) 로 장변이 x 축이다. 벤치에 앉은 사람은
 * 장변에 수직으로 보므로 남/북 둘 중 하나뿐이고, 남쪽이 대합실 통행 흐름(Z2 남측)이다.
 * 등을 보이면 말 걸 대상으로 안 읽힌다.
 */
const GP_FACING = -Math.PI / 2

/** 캐리어 승객은 서쪽(+x 반대) — 에스컬레이터로 올라오는 사람과 마주 선다 */
const CP_FACING = Math.PI

/** 비켜선 뒤 북쪽으로 물러나는 거리 — 에스컬 좌측 차선을 비운다 (GDD §4 O-03) */
const CP_ASIDE_NORTH_M = 1.0

/**
 * 횡이동 시간. `CP_MoveAside` 는 '비키는 자세'만 들어 있고 **실제 이동은 코드가 준다**
 * (README ACT-06 항목). 자세를 잡는 동안 좌표를 같이 밀어야 미끄러지지 않는다.
 */
const CP_ASIDE_SEC = 0.45

/**
 * 발도 연출 길이. `GP_Draw` 뒤에 추격이 시작된다 — 0.6 s 는 P1-SPEC §O-14 의 값이다.
 * 원샷 클립은 `clampWhenFinished` 로 마지막 포즈를 물고 있으므로 조금 넘겨도 무해하다.
 */

type Anchor = Readonly<{ x: number; y: number; z: number }>

const anchorOf = (id: string): Anchor => {
  const it = byId(id)
  if (it) return { x: it.x, y: it.y, z: it.z }
  // 테이블에서 항목이 사라지면 원점에 서 있는 NPC 로 즉시 드러나야 한다
  console.error(`[actors] ${id} 가 상호작용 테이블에 없다 — 원점에 세운다`)
  return { x: 0, y: 0, z: 0 }
}

/**
 * 추격 좌표 (GDD §4.1 — 할아버지 단소 추격).
 *
 * `systems/chase.ts` 가 `chase.pos` 를 채운다. **Vec2 다** — 고도는 상태에 없다.
 * 할아버지는 Z2 대합실(B1) 평면만 돌아다니므로 층 고도를 여기서 붙인다.
 * (시뮬이 z 를 들고 있을 이유가 없다: 추격 해제선이 x ≥ 56 이라 층을 바꿀 일이 없다)
 *
 * `phase === 'idle'` 이면 아직 일어서지 않았다 — 벤치 좌표를 쓴다.
 */
const chasePosOf = (s: GameState): Anchor | null => {
  if (s.chase.phase === 'idle') return null
  return { x: s.chase.pos.x, y: s.chase.pos.y, z: FLOOR.B1 }
}

/** 로드 실패용 빈 리그 — 호출부가 분기하지 않게 모양만 맞춘다 (`main.ts:220` 선례) */
const noopRig = (): NpcRig => ({
  root: new Group(),
  place: () => {},
  play: () => {},
  current: () => null,
  update: () => {},
  setVisible: () => {},
  setProp: () => {},
  dispose: () => {},
})

/**
 * 캐릭터 배율 — 에셋(0.84~0.92m)을 실척 맵(문 1.9m · 벤치 0.9m)에 맞춘다.
 *
 * 1.6 을 쓰면 MC 1.48m · GP 1.34m · CP 1.48m 이 된다. GDD §7.3 의 "3등신 SD" 를
 * 유지하면서(머리가 크고 키가 작다) **인형이 아니라 짧은 사람**으로 읽히는 지점이다.
 * 한 상수로 주는 이유: 작가가 만든 상대 신장(할아버지가 MC보다 9% 작다)을 보존한다.
 */
export const CHAR_SCALE = 1.6

/**
 * 모델 전방축 보정 — 리그마다 다를 수 있어 캐릭터별로 준다.
 *
 * **지금은 전부 0 이다.** 예전에 GP·AJ·AJP 에 π 가 붙어 있었는데, 그건 리그의 문제가 아니라
 * `npc-rig.ts place()` 의 **반사 버그를 가리던 보정**이었다(공식이 `-facing + π/2` 라
 * 북축 대칭이 걸렸다). 공식을 `facing + π/2` 로 고치니 이 리포의 리그는 전부 +z 전방이다.
 *
 * ⚠ 판정 방법: **동·서를 반드시 같이 본다.** 남·북은 그 반사의 고정점이라 버그가 있어도
 *   멀쩡해 보인다 — 실제로 남북으로만 확인하다 두 번 놓쳤다.
 *   `tests/e2e/p2.spec.ts` 의 "네 방향" 테스트가 이걸 잠근다.
 */
const YAW_FIX = { gp: 0, cp: 0, aj: 0, ajp: 0, zp: 0, ss: 0, cl: 0 } as const

/**
 * 앉은 자세 보정(m) — **실척 가구와 축소 캐릭터의 간극**을 메운다.
 *
 * `GP_SitIdle` 은 리그 비율상 정확하다: 엉덩이가 신장의 26% 높이에 있다(사람도 그렇다).
 * 문제는 벤치가 **1.7m 성인 기준 실척**(좌면 0.45m)이라는 것이다. 1.34m 캐릭터의
 * 엉덩이는 0.38m 에 오므로 좌면보다 7cm 낮게, 즉 **좌판을 관통해** 앉는다.
 * 캐릭터를 더 키우면 문·개찰구 비율이 깨지므로, 앉는 순간만 들어올린다.
 */
const GP_SEAT_LIFT = 0.08

/**
 * ACT-12 편의점 점원 — 카운터 뒤, 통로 위.
 *
 * `OBJ-19-CVS` = rect[21.5, 25.7, 26.5, 30.0] 는 플레이어가 못 들어가는 **충돌** 솔리드다
 * (P0에 입장이 없다) — 하지만 그건 충돌 볼륨이지 **비주얼이 아니다.** 점포 내부는
 * 냉장고·곤돌라·카운터로 채워져 있고, 실제로 서 있을 수 있는 바닥은 그 가구들 사이의
 * 통로뿐이다. `Z2_CONCOURSE.glb` 를 정점 단위로 까 보면(CVS 카운터 부분만 격리—
 * 전체 카운터 메시는 편의점+카페 공용이라 x<27 로 잘라야 한다) 카운터는
 * x[24.55, 26.15] · y[26.05, 26.75] 에서 바닥부터 0.95 m 솔리드다. 점원을 y=26.4 에
 * 두면 **카운터 몸통 안**에 다리·엉덩이가 박힌다 — 여기가 이번에 고친 버그다.
 *
 * y=27.1 로 옮긴다: 카운터 뒷면(y=26.75)에서 0.35 m 물러난 자리고, x=24.65 곤돌라는
 * x[24.23, 25.07] 까지만 뻗어 있어 x=25.8 열에는 안 걸리며, 냉장고 정면(VM_TRIM·
 * VM_CAN, y≈29.2)까지 아직 2 m 넘게 열려 있다 — 유리 너머로 보이는 통로 한가운데다.
 *
 * 고정 액터라 충돌을 올리지 않는다 — 플레이어는 어차피 점포 솔리드에 막힌다.
 */
export const CLERK_POS = { x: 25.8, y: 27.1, z: FLOOR.B1 } as const

/**
 * 점원이 보는 방향 — 매대(파사드, y 작은 쪽) 쪽인 남쪽(−y).
 * 등을 보이면 말 걸 대상으로 안 읽힌다(GP_FACING 과 같은 근거).
 * `YAW_FIX.cl` 이 0 이 아니면 실측 후 이 값이 아니라 그쪽을 고친다.
 */
const CL_FACING = -Math.PI / 2

/**
 * 에스컬레이터 승객 — **장식이지만 우산은 맞는다** (디렉터 지시 2026-08-07:
 * "에스컬레이터를 빼곡히 채워줘" → *"다른 승객은 우산에 닿았을때 안 날라가는디?"*).
 *
 * 인파벽 3인(`CP_IDS`)과 역할이 다르다. 그 셋은 **경로 판정**이다 — 비켜세우거나 날려야
 * 길이 열린다(15초 정체·E-11 전제). 여기 있는 승객들은 그 판정에 안 걸린다 — 충돌을
 * 주면 3인 규칙이 무의미해진다. 하지만 **우산 훑기**(`systems/umbrella.ts`)는 걸린다 —
 * 좌표를 `data/crowd.ts` 로 옮겨 판정과 렌더가 같은 표를 읽게 한 이유가 그것이다.
 *
 * ⚠ **리그 루트 이름을 반드시 새로 붙인다.** `loadNpcRig` 는 이름을 URL 파일명에서
 *   따온다 — 같은 `cp_character_rigged.glb` 를 또 로드하면 루트 이름이 기존 3인과
 *   똑같이 `npc:cp_character_rigged.glb` 가 된다. `p1.spec.ts` 의 `__leanDot('npc:cp', …)`
 *   는 이 접두어로 씬 전체를 훑어 **마지막으로 매치된 것 하나**의 머리·엉덩이를 쓴다.
 *   장식 승객은 진행 방향(`RIDER_FACING = 0`)을 보고 인파벽 3인(`CP_FACING = π`)은
 *   반대를 보므로, 장식 승객이 마지막에 걸리면 그 e2e 가 부호를 놓친다.
 *   그래서 로드 직후 `root.name` 을 `npc:esc-rider` 로 덮어써 그 접두어에서 아예 뺀다.
 *
 * 개수(5행 × 2줄 = 10명) 근거: 스킨드 메시라 인스턴싱이 안 되고 한 명이 **14,464
 * 삼각형**이다(실측). 처음엔 7행(14명)으로 채웠더니 Z4·Z5 삼각형 예산(470k)이
 * 435k·418k 까지 차 여유가 7~11%로 떨어졌다. 10명으로 줄이면 380k 대로 내려와
 * 여유가 다시 20% 안팎이 된다.
 */
/** 이동 방향(+x, 하강 방향)을 그대로 본다 — 에스컬레이터에 서 있으면 가는 쪽을 본다 */
const RIDER_FACING = 0

const loadOr = async (url: string, tag: string, yawOffset: number): Promise<NpcRig> => {
  try {
    return await loadNpcRig(url, { scale: CHAR_SCALE, yawOffset })
  } catch (e: unknown) {
    // 게임은 NPC 없이도 끝까지 돌아야 한다 — 열차만 타면 엔딩이 난다
    console.error(`[actors] ${tag} GLB 로드 실패 — 해당 NPC 없이 진행합니다`, e)
    return noopRig()
  }
}

export const loadActors = async (baseUrl: string): Promise<Actors> => {
  const dir = `${baseUrl}models/npc/`
  /**
   * 인파벽은 **3인 1열**이다(P2 복원). 리그를 세 번 로드한다 —
   * `loadNpcRig` 이 스켈레톤까지 복제하므로 셋이 각자 움직인다(얕은 복제는 본을 공유한다).
   * 브라우저가 같은 URL 을 캐시하므로 네트워크 비용은 1회다.
   */
  const [gp, cp0, cp1, cp2, ajp, aj, zp, ss, cl, ...riders] = await Promise.all([
    loadOr(`${dir}gp_character_rigged.glb`, 'GP', YAW_FIX.gp),
    loadOr(`${dir}cp_character_rigged.glb`, 'CP0', YAW_FIX.cp),
    loadOr(`${dir}cp_character_rigged.glb`, 'CP1', YAW_FIX.cp),
    loadOr(`${dir}cp_character_rigged.glb`, 'CP2', YAW_FIX.cp),
    loadOr(`${dir}${OBS_ACTORS[0].file}`, 'AJP', YAW_FIX.ajp),
    loadOr(`${dir}${OBS_ACTORS[1].file}`, 'AJ', YAW_FIX.aj),
    loadOr(`${dir}${OBS_ACTORS[2].file}`, 'ZP', YAW_FIX.zp),
    loadOr(`${dir}${OBS_ACTORS[3].file}`, 'SS', YAW_FIX.ss),
    loadOr(`${dir}cl_character_rigged.glb`, 'CL', YAW_FIX.cl),
    ...RIDER_SPOTS.map((_, i) => loadOr(`${dir}cp_character_rigged.glb`, `RIDER${i}`, YAW_FIX.cp)),
  ])
  const cps = [cp0, cp1, cp2] as const
  // 이름 충돌 회피 — 위 헤더 주석 참고
  for (const r of riders) r.root.name = 'npc:esc-rider'
  const riderAnchors: readonly Anchor[] = RIDER_SPOTS.map((spot) =>
    ({ x: spot.x, y: spot.y, z: rampZ(ESCALATOR, spot.x, spot.y) ?? FLOOR.B1 }))

  /**
   * 하차 인파 40명(디렉터 지시) — 열차가 서면 계단을 올라 개찰구로 빠진다.
   * 자리는 `data/crowd.ts disembarkAt` 이 순수함수로 정한다. 리그는 기존 인파와
   * 똑같이 `cp_character_rigged.glb` 를 재사용한다 — 디렉터 지시로 **일단 스킨드
   * 리그 40개 그대로 시도**한다(에스컬레이터 승객 10명이 이미 삼각형 예산의 상당량을
   * 먹었다는 사실은 `RIDER_SPOTS` 헤더 주석 참고 — 문제가 보이면 그때 렌더 방식을 바꾼다).
   * 이름은 `npc:esc-rider`/`npc:cp` 와 겹치지 않는 접두어를 쓴다 — 안 그러면
   * `p1.spec.ts` 의 접두어 매칭 e2e가 엉뚱한 리그의 머리·엉덩이를 잡는다(위 경고 참고).
   */
  const disembarkRigs = await Promise.all(
    Array.from({ length: DISEMBARK.count },
      (_, i) => loadOr(`${dir}cp_character_rigged.glb`, `DISEMBARK${i}`, YAW_FIX.cp)),
  )
  for (const r of disembarkRigs) r.root.name = 'npc:disembark'

  /** 반대 방면 하차 인파 — 같은 리그 풀을 하나 더 띄운다(디렉터 지시: 반대 방면도 인파가 있어야). */
  const disembarkRigs2 = await Promise.all(
    Array.from({ length: DISEMBARK.count },
      (_, i) => loadOr(`${dir}cp_character_rigged.glb`, `DISEMBARK-OPP${i}`, YAW_FIX.cp)),
  )
  for (const r of disembarkRigs2) r.root.name = 'npc:disembark-opp'

  const root = new Group()
  root.name = 'actors'
  root.add(gp.root, cp0.root, cp1.root, cp2.root, ajp.root, aj.root, zp.root, ss.root, cl.root)
  for (const r of riders) root.add(r.root)
  for (const r of disembarkRigs) root.add(r.root)
  for (const r of disembarkRigs2) root.add(r.root)

  const gpHome = anchorOf(GRANDPA_ID)
  const cpHomes = CP_IDS.map((id) => anchorOf(id))

  /** 발도 이후 경과(s). 화가 풀리는 경로는 없으므로 되돌리지 않는다 */
  /** 비켜선 이후 경과(s) — 횡이동 보간의 유일한 입력 */
  const cpAsideSec: number[] = [0, 0, 0]
  /** 우산에 맞은 이후 경과(s) — 포물선 궤적의 유일한 입력 */
  const cpKnockSec: number[] = [0, 0, 0]
  /** 에스컬레이터 승객용 — 같은 방식, 인원수만 다르다 */
  const riderKnockSec: number[] = RIDER_SPOTS.map(() => 0)

  /** 프롭 토글은 상태가 바뀐 프레임에만 — 매 프레임 traverse 결과를 다시 쓰지 않는다 */
  let propHyojason: boolean | null = null
  let propDanso: boolean | null = null

  const near = (s: GameState, a: Anchor): boolean => {
    const p = s.player.pos
    const dx = p.x - a.x, dy = p.y - a.y, dz = p.z - a.z
    return dx * dx + dy * dy + dz * dz < CULL_RANGE_M * CULL_RANGE_M
  }

  const syncGrandpa = (s: GameState, dtSec: number): void => {
    const angry = s.flags.includes('GRANDPA_ANGRY')
    const handedOver = s.act.consumed.includes(GRANDPA_ID)
    // 효자손은 넘기기 전까지 들고 있고, 단소는 화난 뒤에만 보인다 (GDD §4.1)
    if (propHyojason !== !handedOver) { propHyojason = !handedOver; gp.setProp('PR_Hyojason', propHyojason) }
    if (propDanso !== angry) { propDanso = angry; gp.setProp('PR_Danso', propDanso) }

    /**
     * 일어선 뒤에는 추격 좌표를, 앉아 있는 동안은 벤치를 쓴다.
     * 바라보는 방향도 갈린다 — 앉으면 남쪽 고정, 쫓을 때는 시뮬이 낸 `facing`.
     */
    const chasing = chasePosOf(s)
    const at = chasing ?? gpHome
    // 앉아 있을 때만 좌면 보정을 얹는다. 일어서면 발이 바닥이어야 한다
    const lift = chasing ? 0 : GP_SEAT_LIFT
    gp.place(at.x, at.y, at.z + lift, chasing ? s.chase.facing : GP_FACING)

    const visible = near(s, at)
    gp.setVisible(visible)
    if (!visible) return          // 안 보이는 캐릭터의 믹서를 돌릴 이유가 없다

    if (angry) {
      /**
       * 애니는 **시뮬의 phase 를 따른다.** 자체 타이머로 굴리면
       * 스윙·회수·귀환이 화면에 안 나타난다 — 상태가 이미 그걸 들고 있는데
       * 렌더가 자기 시계로 다시 세는 것은 두 개의 진실을 만드는 짓이다.
       */
      switch (s.chase.phase) {
        case 'draw': gp.play('GP_Draw', true); break
        case 'swing': gp.play('GP_Swing', true); break
        case 'return': gp.play('GP_Chase'); break
        case 'idle': gp.play('GP_SitIdle'); break
        default: gp.play('GP_Chase')
      }
    } else if (s.act.busyKind === 'story' || s.act.dialogId === GRANDPA_ID) {
      gp.play('GP_SitTalk')
    } else {
      gp.play('GP_SitIdle')
    }
    gp.update(dtSec)
  }

  /**
   * 인파벽 3인 — 각자 자기 `ACT-CP*` 를 본다.
   * 비켜선 사람만 북쪽으로 물러나므로 **한 명을 밀어도 나머지 둘이 그대로 서 있는 것**이
   * 화면에 보인다. 그게 15초 정체의 근거이자 우산을 세 번 쓸 이유(E-11)다.
   */
  const syncCarrier = (s: GameState, dtSec: number): void => {
    for (let i = 0; i < cps.length; i++) {
      const rig = cps[i]
      const home = cpHomes[i]
      if (!rig || !home) continue
      const id = CP_IDS[i] as string
      const aside = s.act.consumed.includes(id)

      /**
       * 펼친 우산에 맞았으면 **비켜서는 게 아니라 날아간다** (디렉터 지시 2026-08-07).
       *
       * 소진 처리(`consumed`)는 두 경로가 공유하지만 그림은 완전히 다르다 — 어느 쪽인지는
       * `state.knocks` 에 방향이 남아 있는가로 가른다. 방향만 시뮬이 정하고 **경과는 여기서
       * 센다**(`cpAsideSec` 와 같은 방식) — 이미 끝난 판정의 연출을 상태에 얹을 이유가 없다.
       */
      const knock = s.knocks.find((k) => k.id === id)
      if (knock) {
        cpKnockSec[i] = (cpKnockSec[i] ?? 0) + dtSec
        const t = Math.min(1, (cpKnockSec[i] ?? 0) / (UMBRELLA.knockMs / 1000))
        // 거리는 감속(easeOut) — 맞는 순간이 제일 빠르다
        const d = UMBRELLA.knockM * (1 - (1 - t) * (1 - t))
        // 높이는 포물선. t=0.5 에서 정점, 착지에서 정확히 0으로 돌아온다
        const lift = UMBRELLA.knockLiftM * 4 * t * (1 - t)
        const at: Anchor = { x: home.x + knock.dx * d, y: home.y + knock.dy * d, z: home.z + lift }
        rig.place(at.x, at.y, at.z, Math.atan2(knock.dy, knock.dx))
        /**
         * 구르는 회전. `place()` 는 `rotation.y` 만 건드리므로 x 를 여기서 덮어써도 안전하다.
         * 끝값 π/2 는 **널브러진 자세**다 — 다 돌고 나서 다시 벌떡 서면 맞은 것이 안 읽힌다.
         */
        rig.root.rotation.x = (Math.PI * 2 + Math.PI / 2) * t

        const visible = near(s, at)
        rig.setVisible(visible)
        if (!visible) continue
        rig.play('CP_MoveAside', true)
        rig.update(dtSec)
        continue
      }

      if (aside) cpAsideSec[i] = (cpAsideSec[i] ?? 0) + dtSec

      // 자세 클립에 좌표 이동을 얹는다 — 클립 자체는 제자리다
      const t = aside ? Math.min(1, (cpAsideSec[i] ?? 0) / CP_ASIDE_SEC) : 0
      const at: Anchor = { x: home.x, y: home.y + CP_ASIDE_NORTH_M * t, z: home.z }
      rig.place(at.x, at.y, at.z, CP_FACING)

      const visible = near(s, at)
      rig.setVisible(visible)
      if (!visible) continue

      if (!aside) rig.play('CP_Idle')
      else if (t < 1) rig.play('CP_MoveAside', true)
      else rig.play('CP_AsideIdle')   // 없으면 원위치로 돌아가 버린다 (README ACT-06)
      rig.update(dtSec)
    }
  }

  /**
   * 에스컬레이터 승객 동기화.
   *
   * 자리는 로드 시 한 번 계산해 둔 `riderAnchors` 로 고정이지만, **우산에 맞으면**
   * `syncCarrier` 의 인파벽 넉백과 똑같은 포물선을 그린다 — 판정(`state.knocks`)이
   * `data/crowd.ts` 의 같은 id 로 들어오므로 그림도 같은 코드를 그대로 재사용한다.
   */
  const syncRiders = (s: GameState, dtSec: number): void => {
    for (let i = 0; i < riders.length; i++) {
      const rig = riders[i]
      const at = riderAnchors[i]
      const spot = RIDER_SPOTS[i]
      if (!rig || !at || !spot) continue

      const knock = s.knocks.find((k) => k.id === spot.id)
      if (knock) {
        riderKnockSec[i] = (riderKnockSec[i] ?? 0) + dtSec
        const t = Math.min(1, (riderKnockSec[i] ?? 0) / (UMBRELLA.knockMs / 1000))
        const d = UMBRELLA.knockM * (1 - (1 - t) * (1 - t))
        const lift = UMBRELLA.knockLiftM * 4 * t * (1 - t)
        const kAt: Anchor = { x: at.x + knock.dx * d, y: at.y + knock.dy * d, z: at.z + lift }
        rig.place(kAt.x, kAt.y, kAt.z, Math.atan2(knock.dy, knock.dx))
        rig.root.rotation.x = (Math.PI * 2 + Math.PI / 2) * t

        const visible = near(s, kAt)
        rig.setVisible(visible)
        if (!visible) continue
        rig.play('CP_MoveAside', true)
        rig.update(dtSec)
        continue
      }

      rig.place(at.x, at.y, at.z, RIDER_FACING)
      const visible = near(s, at)
      rig.setVisible(visible)
      if (!visible) continue
      rig.play('CP_Idle')
      rig.update(dtSec)
    }
  }

  /** 이번 판에 안 켜진 방해요소는 **몸도 없다** — 세계가 활성 목록에 대해 거짓말하면 안 된다 */
  const obsOff = (s: GameState, rig: NpcRig, id: ObsId): boolean => {
    if (s.obstacles.includes(id)) return false
    rig.setVisible(false)
    return true
  }

  const nearObs = (s: GameState, x: number, y: number, z: number): boolean => {
    const p = s.player.pos
    const dx = p.x - x, dy = p.y - y, dz = p.z - z
    return dx * dx + dy * dy + dz * dz < OBS_CULL_M * OBS_CULL_M
  }

  /** 전단지 — 제자리. 플레이어가 반경에 들면 말을 걸고, 이어폰이면 무시당한다 */
  const syncTalker = (
    s: GameState, rig: NpcRig, id: ObsId, at: { x: number; y: number }, rangeM: number,
    dtSec: number,
  ): void => {
    if (obsOff(s, rig, id)) return
    // OBS-06 전단지 배포원만 지상(Z1)이다 — 나머지는 대합실
    const zz = id === 'OBS-06' ? FLOOR.L0 : FLOOR.B1
    const p = s.player.pos
    const d = Math.hypot(p.x - at.x, p.y - at.y)
    // 다가오는 사람을 본다 — 등을 보이면 피할 대상으로 안 읽힌다
    const facing = d > 0.05 ? Math.atan2(p.y - at.y, p.x - at.x) : 0
    rig.place(at.x, at.y, zz, facing)

    const visible = nearObs(s, at.x, at.y, zz)
    rig.setVisible(visible)
    if (!visible) return

    const engaged = d <= rangeM
    const ignored = s.flags.includes('EARBUDS_ON')
    if (engaged && ignored) rig.play('AJ_Ignored')
    else if (engaged) rig.play('AJ_Talk')
    else if (d <= rangeM * 2.2) rig.play('AJ_Spot')
    else rig.play('AJ_Idle')
    rig.update(dtSec)
  }

  /**
   * 아주머니 — 좀비폰족과 같은 식으로 순찰하다, 플레이어가 반경(또는 그 2.2배)에 들면
   * 걸음을 멈춘 것처럼 플레이어를 보고 말을 건다. 이어폰이면 무시당한다
   */
  const syncAjumma = (s: GameState, dtSec: number): void => {
    if (obsOff(s, aj, 'OBS-07')) return
    const at = ajummaAt(s.elapsedMs)
    const p = s.player.pos
    const d = Math.hypot(p.x - at.x, p.y - at.y)
    const spotted = d <= OBSTACLE.ajummaRangeM * 2.2
    const prev = ajummaAt(Math.max(0, s.elapsedMs - 120))
    const walkFacing = Math.atan2(at.y - prev.y, at.x - prev.x)
    const lookFacing = d > 0.05 ? Math.atan2(p.y - at.y, p.x - at.x) : 0
    aj.place(at.x, at.y, FLOOR.B1, spotted ? lookFacing : walkFacing)

    const visible = nearObs(s, at.x, at.y, FLOOR.B1)
    aj.setVisible(visible)
    if (!visible) return

    const engaged = d <= OBSTACLE.ajummaRangeM
    const ignored = s.flags.includes('EARBUDS_ON')
    if (engaged && ignored) aj.play('AJ_Ignored')
    else if (engaged) aj.play('AJ_Talk')
    else if (spotted) aj.play('AJ_Spot')
    else aj.play('AJ_Approach')
    aj.update(dtSec)
  }

  /** 좀비폰족 — 위치가 시간의 순수 함수라 렌더도 **같은 식**을 쓴다 */
  const syncZombie = (s: GameState, dtSec: number): void => {
    if (obsOff(s, zp, 'OBS-08')) return
    const at = zombieAt(s.elapsedMs)
    const prev = zombieAt(Math.max(0, s.elapsedMs - 120))
    const facing = Math.atan2(at.y - prev.y, at.x - prev.x)
    zp.place(at.x, at.y, FLOOR.B1, facing)

    const visible = nearObs(s, at.x, at.y, FLOOR.B1)
    zp.setVisible(visible)
    if (!visible) return

    const bumped = s.player.stallMs > 0 &&
      Math.hypot(s.player.pos.x - at.x, s.player.pos.y - at.y) < 2.0
    zp.play(bumped ? 'ZP_Bump' : 'ZP_Walk1H', bumped)
    zp.update(dtSec)
  }

  /** 역무원 — 순찰도 시간의 순수 함수다(`systems/staff.ts staffAt`) */
  const syncStaff = (s: GameState, dtSec: number): void => {
    if (obsOff(s, ss, 'OBS-13')) return
    const pose = staffAt(s.elapsedMs)
    ss.place(pose.x, pose.y, FLOOR.B1, pose.facing)

    const visible = nearObs(s, pose.x, pose.y, FLOOR.B1)
    ss.setVisible(visible)
    if (!visible) return

    // 경보가 잡히면 무전을 든다 — 0.8초 유예를 **보이게** 만드는 절반이다(나머지 절반은 호루라기)
    ss.play(s.staffAlertMs > 0 ? 'SS_RadioAlert' : 'SS_Walk')
    ss.update(dtSec)
  }

  /**
   * 점원 — 카운터 뒤 고정, 게임 상태에 좌우되지 않는다(YAGNI: 이번 범위는 배치뿐).
   * 그래도 매 프레임 `place`+`update` 를 부르는 이유는 믹서 때문이다 —
   * `update` 를 안 돌리면 `CL_Idle` 이 T 포즈로 굳는다.
   */
  const syncClerk = (s: GameState, dtSec: number): void => {
    cl.place(CLERK_POS.x, CLERK_POS.y, CLERK_POS.z, CL_FACING)

    const visible = near(s, CLERK_POS)
    cl.setVisible(visible)
    if (!visible) return

    cl.play('CL_Idle')
    cl.update(dtSec)
  }

  /**
   * 하차 인파 40명 — 자리는 순수함수(`data/crowd.ts disembarkAt`)가 정한다.
   * 걷는 클립이 없다(`cp_character_rigged.glb` 는 Idle·MoveAside뿐) — 제자리 자세로
   * 미끄러지듯 이동한다. 눈에 띄면 그때 걷기 클립을 추가하거나 렌더 방식을 바꾼다
   * (디렉터 지시로 일단 이대로 진행).
   */
  const syncDisembark = (s: GameState, dtSec: number): void => {
    const t = secondsSinceDoorsOpen(s)
    for (let i = 0; i < disembarkRigs.length; i++) {
      const rig = disembarkRigs[i] as NpcRig
      const spot = t >= 0 ? disembarkAt(i, t, s.gates.workingIds) : null
      if (!spot) { rig.setVisible(false); continue }
      rig.place(spot.x, spot.y, spot.z, spot.facing)
      const visible = nearObs(s, spot.x, spot.y, spot.z)
      rig.setVisible(visible)
      if (!visible) continue
      rig.play('CP_Idle')
      rig.update(dtSec)
    }
  }

  /** 반대 방면 하차 인파 — 게이트 선택이 없어 `disembarkAtOpp` 만 순번으로 돈다 */
  const syncDisembarkOpp = (s: GameState, dtSec: number): void => {
    const t = secondsSinceDoorsOpenOpp(s)
    for (let i = 0; i < disembarkRigs2.length; i++) {
      const rig = disembarkRigs2[i] as NpcRig
      const spot = t >= 0 ? disembarkAtOpp(i, t) : null
      if (!spot) { rig.setVisible(false); continue }
      rig.place(spot.x, spot.y, spot.z, spot.facing)
      const visible = nearObs(s, spot.x, spot.y, spot.z)
      rig.setVisible(visible)
      if (!visible) continue
      rig.play('CP_Idle')
      rig.update(dtSec)
    }
  }

  return {
    root,
    sync(s, dtSec) {
      syncGrandpa(s, dtSec)
      syncCarrier(s, dtSec)
      syncRiders(s, dtSec)
      syncTalker(s, ajp, 'OBS-06', FLYER_AT, OBSTACLE.flyerRangeM, dtSec)
      syncAjumma(s, dtSec)
      syncZombie(s, dtSec)
      syncStaff(s, dtSec)
      syncClerk(s, dtSec)
      syncDisembark(s, dtSec)
      syncDisembarkOpp(s, dtSec)
    },
    dispose() {
      gp.dispose()
      for (const c of cps) c.dispose()
      for (const r of riders) r.dispose()
      ajp.dispose(); aj.dispose(); zp.dispose(); ss.dispose()
      cl.dispose()
      for (const r of disembarkRigs) r.dispose()
      for (const r of disembarkRigs2) r.dispose()
    },
  }
}
