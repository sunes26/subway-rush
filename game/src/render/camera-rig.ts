/**
 * F-02 카메라 — 2.5D 쿼터뷰. 고정각이되 플레이어를 따라간다.
 *
 * 존 전환은 컷이 아니라 1.2s 보간이다. 3분 게임에 로딩·컷 5번은 사망(MAP §2).
 */

import type { Object3D, PerspectiveCamera } from 'three'
import { Raycaster, Vector3 } from 'three'
import type { InputFrame } from '../core/input'
import { clamp01, easeInOut, lerp, lerpExp } from '../core/math'
import { CAMERA, MOVE } from '../data/tuning'
import { GATES } from '../data/world'
import type { GameState, ZoneId } from '../state/types'

export type CamPreset = Readonly<{ yaw: number; pitch: number; dist: number; fov: number }>

const D = Math.PI / 180

/**
 * MAP §7 존별 프레이밍.
 *
 * 요(yaw)는 전부 0 근처로 잡는다 — 레벨이 +x로 뻗으므로 **W는 항상 목표 방향**이어야 한다.
 * 거리는 3등신 SD 캐릭터가 화면에서 읽히는 선(12~16m)으로 조인다.
 * Z3만 예외다: 게이트 6기를 한 화면에 넣어야 해서 거리 대신 **화각**을 넓힌다.
 */
const PRESETS: Record<ZoneId, CamPreset> = {
  // 스폰이 맵 서쪽 끝이라 카메라를 뒤로 못 뺀다 → 피치를 세워 위에서 내려다본다
  // ⚠ 요는 "W를 눌렀을 때 가는 방향"을 정한다. 통로 폭이 좁은 존에서 요가 크면
  //   직진만 해도 벽에 붙는다 (Z1은 −14°에서 8m 만에 연석에 닿았다).
  //   각 존의 실제 동선 방향에 맞추고, 쿼터뷰의 각도는 피치가 만든다.
  //   Z1 인도는 북쪽(y34)이 비어 있으므로 살짝 +로 눕힌다.
  Z1: { yaw: 7 * D, pitch: -44 * D, dist: 16, fov: 40 },
  // Z2는 진입(4,28) → Z3 개구부(56, 9~19)로 남동진이 정답 동선이다
  Z2: { yaw: -11 * D, pitch: -38 * D, dist: 16, fov: 40 },
  Z3: { yaw: -3 * D, pitch: -34 * D, dist: 24, fov: 54 },   // dist는 아래에서 재계산
  // Z4 통로는 y2~12(10m)뿐이다. 요를 눕히면 난간에 붙는다
  Z4: { yaw: -6 * D, pitch: -32 * D, dist: 16, fov: 42 },
  // 승강장은 +x로 뻗고 열차는 +y(북)에 선다. 요를 26°로 눕혀
  // W가 "승강장을 따라 + 열차 쪽"을 동시에 향하게 한다.
  Z5: { yaw: 26 * D, pitch: -30 * D, dist: 17, fov: 42 },
}

/**
 * Z3 특례 — 게이트 뱅크 6개(y 6~26, 20m)가 화면 세로 70%에 반드시 들어가야 한다.
 * MAP §5.4: "정보를 전부 보여준 뒤에 선택시킨다". 그 경계선을 카메라로 긋는다.
 */
export const z3Distance = (fovDeg: number, pitch: number): number => {
  const first = GATES[0]
  const last = GATES[GATES.length - 1]
  const span = (last?.y ?? 26) - (first?.y ?? 6) + 3          // 여유 3m
  const halfFov = (fovDeg * D) / 2
  const need = span / 2 / Math.tan(halfFov) / 0.72
  // 피치가 눕을수록 화면 세로가 지면을 더 많이 담는다 → 그만큼 가까이 붙을 수 있다
  return need * Math.max(0.55, Math.cos(pitch))
}

export type CameraRig = Readonly<{
  update(state: GameState, input: InputFrame, dtSec: number): void
  /** 이동 입력을 월드로 변환할 때 쓰는 현재 요 */
  yaw(): number
  target(): Vector3
}>

/** 카메라와 플레이어 사이를 막는 지오메트리가 있으면 그만큼 당겨 붙인다 (S2-6). */
const OCCLUDE_MARGIN = 0.6
/** 이보다 가까운 히트는 무시한다 — 플레이어가 쉘터·문틀 안에 서 있을 때 카메라가 붕괴한다 */
const OCCLUDE_IGNORE = 3.0
/** 아무리 가려도 이 비율 아래로는 안 당긴다. 지오메트리 안으로 들어가는 것보다는 가려지는 게 낫다 */
const OCCLUDE_MIN = 0.5

export const createCameraRig = (camera: PerspectiveCamera, occluders?: Object3D): CameraRig => {
  const ray = new Raycaster()
  ray.far = 200
  let occDist = 1        // 0..1 — 목표 거리에 대한 실제 비율. 부드럽게 수렴시킨다
  const anchor = new Vector3()
  const look = new Vector3()
  let cur: CamPreset = { ...PRESETS.Z1 }
  let from: CamPreset = { ...PRESETS.Z1 }
  let to: CamPreset = { ...PRESETS.Z1 }
  let blend = 1
  let zone: ZoneId = 'Z1'
  let started = false
  let idleOrbit = 0
  /** 오빗까지 반영한 실효 요. 이동 방향은 **플레이어가 보는 화면** 기준이어야 한다. */
  let effYaw = PRESETS.Z1.yaw

  const presetFor = (z: ZoneId): CamPreset => {
    const p = PRESETS[z]
    if (z !== 'Z3') return p
    return { ...p, dist: z3Distance(p.fov, p.pitch) }
  }

  return {
    yaw: () => effYaw,
    target: () => look.clone(),
    update(state, input, dtSec) {
      if (state.zone !== zone) {
        zone = state.zone
        from = { ...cur }
        to = presetFor(zone)
        blend = 0
      }
      if (blend < 1) {
        blend = clamp01(blend + dtSec / CAMERA.zoneBlendSec)
        const e = easeInOut(blend)
        cur = {
          yaw: lerp(from.yaw, to.yaw, e),
          pitch: lerp(from.pitch, to.pitch, e),
          dist: lerp(from.dist, to.dist, e),
          fov: lerp(from.fov, to.fov, e),
        }
      }
      if (Math.abs(camera.fov - cur.fov) > 0.01) {
        camera.fov = cur.fov
        camera.updateProjectionMatrix()
      }

      const p = state.player
      // 선행 오프셋 — 진행 방향을 미리 보여준다
      const ax = p.pos.x + p.vel.x * CAMERA.lookAheadSec
      const ay = p.pos.y + p.vel.y * CAMERA.lookAheadSec
      const want = new Vector3(ax, p.pos.z + MOVE.eyeHeight, -ay)

      if (!started) { anchor.copy(want); started = true }
      anchor.set(
        lerpExp(anchor.x, want.x, dtSec, CAMERA.followTau),
        lerpExp(anchor.y, want.y, dtSec, CAMERA.followTau),
        lerpExp(anchor.z, want.z, dtSec, CAMERA.followTau),
      )
      look.copy(anchor)

      // 마우스 오빗은 프리셋에 더해진다. 손을 떼면 input이 유지하므로 즉시 튀지 않는다.
      const yaw = cur.yaw + input.orbitYaw
      effYaw = yaw
      const pitch = Math.max(-60 * D, Math.min(-16 * D, cur.pitch + input.orbitPitch))
      const dist = cur.dist * input.zoom

      // 아주 느린 자동 회전 — 정적인 쿼터뷰의 답답함을 덜어준다
      idleOrbit += dtSec * 0.02 * (state.player.moving ? 0 : 1)
      const ry = yaw + Math.sin(idleOrbit) * 0.012

      // 앵커 → 카메라 방향 단위벡터
      const dir = new Vector3(
        -Math.cos(ry) * Math.cos(pitch),
        -Math.sin(pitch),
        Math.sin(ry) * Math.cos(pitch),
      ).normalize()

      // ── 차폐 검사: 앵커에서 카메라 쪽으로 쏴서 먼저 맞는 벽까지만 물러난다
      let clearance = 1
      if (occluders) {
        ray.set(anchor, dir)
        ray.far = dist
        const hits = ray.intersectObject(occluders, true)
        const first = hits.find((h) => h.distance > OCCLUDE_IGNORE)
        if (first) clearance = Math.max(OCCLUDE_MIN, (first.distance - OCCLUDE_MARGIN) / dist)
      }
      // 당길 때는 빠르게(가려지면 즉시), 풀 때는 천천히(덜컹거리지 않게)
      const tau = clearance < occDist ? 0.05 : 0.5
      occDist += (clearance - occDist) * (1 - Math.exp(-dtSec / tau))

      camera.position.copy(anchor).addScaledVector(dir, dist * occDist)
      camera.lookAt(anchor)
    },
  }
}
