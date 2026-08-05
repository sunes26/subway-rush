/**
 * NPC 배치·상태 동기 — 할아버지(GP)와 캐리어 승객(CP).
 *
 * 이 파일은 **게임 규칙을 담지 않는다.** 무엇이 소진됐는지·누가 화났는지는 시뮬이 정하고
 * 여기서는 그 결과를 읽어 클립과 좌표로 옮긴다. 그래서 상태를 되짚어 쓰는 코드가 없고,
 * 프레임을 건너뛰어도 화면이 어긋나지 않는다(항상 현재 상태에서 다시 계산한다).
 *
 * 좌표는 `data/interactables.ts` 에서 읽는다. 여기서 새로 만들지 않는다 —
 * 그림과 판정이 갈라지는 결함을 P0 에서 열한 번 봤다. 상호작용 대상이 곧 그 사람이다.
 */

import { Group } from 'three'
import { GRANDPA_ID, byId } from '../data/interactables'
import { FLOOR } from '../data/world'
import type { GameState } from '../state/types'
import { loadNpcRig, type NpcRig } from './npc-rig'

export type Actors = Readonly<{
  root: Group
  sync(s: GameState, dtSec: number): void
  dispose(): void
}>

/** 에스컬레이터 진입부 승객 — `interactables.ts` 의 `ACT-CP` 항목 */
const CP_ID = 'ACT-CP'

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

const loadOr = async (url: string, tag: string): Promise<NpcRig> => {
  try {
    return await loadNpcRig(url)
  } catch (e: unknown) {
    // 게임은 NPC 없이도 끝까지 돌아야 한다 — 열차만 타면 엔딩이 난다
    console.error(`[actors] ${tag} GLB 로드 실패 — 해당 NPC 없이 진행합니다`, e)
    return noopRig()
  }
}

export const loadActors = async (baseUrl: string): Promise<Actors> => {
  const dir = `${baseUrl}models/npc/`
  const [gp, cp] = await Promise.all([
    loadOr(`${dir}gp_character_rigged.glb`, 'GP'),
    loadOr(`${dir}cp_character_rigged.glb`, 'CP'),
  ])

  const root = new Group()
  root.name = 'actors'
  root.add(gp.root, cp.root)

  const gpHome = anchorOf(GRANDPA_ID)
  const cpHome = anchorOf(CP_ID)

  /** 발도 이후 경과(s). 화가 풀리는 경로는 없으므로 되돌리지 않는다 */
  /** 비켜선 이후 경과(s) — 횡이동 보간의 유일한 입력 */
  let cpAsideSec = 0

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
    gp.place(at.x, at.y, at.z, chasing ? s.chase.facing : GP_FACING)

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
        case 'seize': gp.play('GP_Recover', true); break
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

  const syncCarrier = (s: GameState, dtSec: number): void => {
    const aside = s.act.consumed.includes(CP_ID)
    if (aside) cpAsideSec += dtSec

    // 자세 클립에 좌표 이동을 얹는다 — 클립 자체는 제자리다
    const t = aside ? Math.min(1, cpAsideSec / CP_ASIDE_SEC) : 0
    const at: Anchor = { x: cpHome.x, y: cpHome.y + CP_ASIDE_NORTH_M * t, z: cpHome.z }
    cp.place(at.x, at.y, at.z, CP_FACING)

    const visible = near(s, at)
    cp.setVisible(visible)
    if (!visible) return

    if (!aside) cp.play('CP_Idle')
    else if (t < 1) cp.play('CP_MoveAside', true)
    else cp.play('CP_AsideIdle')     // 없으면 원위치로 돌아가 버린다 (README ACT-06)
    cp.update(dtSec)
  }

  return {
    root,
    sync(s, dtSec) {
      syncGrandpa(s, dtSec)
      syncCarrier(s, dtSec)
    },
    dispose() {
      gp.dispose()
      cp.dispose()
    },
  }
}
