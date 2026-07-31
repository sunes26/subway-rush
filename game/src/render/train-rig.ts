/**
 * 열차 8량 + 가동문 32개소 + 안전문(PSD) 슬라이드.
 * 상태는 전부 GameState.train에서 읽는다 — 렌더는 게임플레이에 영향을 주지 않는다.
 */

import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3 } from 'three'
import { PALETTE, TRAIN } from '../data/tuning'
import { DOOR_XS, FLOOR, PSD_Y } from '../data/world'
import type { GameState } from '../state/types'
import { emissiveMat, toonMat } from './toon'

const DOOR_W = 1.6
const DOOR_H = 1.9
const PANEL_W = DOOR_W / 2

export type TrainRig = Readonly<{ root: Group; sync(s: GameState): void }>

export const createTrainRig = (): TrainRig => {
  const root = new Group()
  root.name = 'train'

  // ── 차체 8량 (부록 A: 차체 y12.42~15.58, 바닥 z−20.0)
  const bodyDepth = TRAIN.bodyYMax - TRAIN.bodyYMin
  const bodyGeo = new BoxGeometry(TRAIN.carLength - 0.35, 3.3, bodyDepth)
  const bodies = new InstancedMesh(bodyGeo, toonMat(PALETTE.trainBody), TRAIN.carCount)
  bodies.name = 'train:bodies'
  root.add(bodies)

  // ⚠ InstancedMesh의 바운딩 스피어는 **처음 보인 프레임의 인스턴스 위치로 캐시**된다.
  //   열차는 x=330에서 78까지 250m를 움직이므로 캐시가 즉시 낡고, 프러스텀 컬링이
  //   "안 보이는 곳에 있다"고 판단해 통째로 사라진다. 움직이는 인스턴스는 컬링을 끈다.
  //   (개수가 5개라 컬링을 꺼도 비용이 없다)

  // 노선색 띠 — 2호선 그린. "어느 선인지"를 한 눈에
  const bandGeo = new BoxGeometry(TRAIN.carLength - 0.35, 0.34, bodyDepth + 0.04)
  const bands = new InstancedMesh(bandGeo, emissiveMat(PALETTE.line2), TRAIN.carCount)
  bands.name = 'train:bands'
  root.add(bands)

  // ── 창문 띠 — 이게 없으면 차체가 승강장 벽과 같은 흰 덩어리로 읽힌다.
  //    "열차"라는 인상은 폴리곤이 아니라 창문 한 줄에서 나온다.
  const winGeo = new BoxGeometry(TRAIN.carLength - 3.2, 1.05, bodyDepth + 0.06)
  const windows = new InstancedMesh(winGeo, toonMat(0x1e2a33), TRAIN.carCount)
  windows.name = 'train:windows'
  root.add(windows)

  // ── 출입구 안쪽 — 문이 열렸을 때 어두운 실내가 보여야 "탈 수 있다"가 읽힌다
  const holeGeo = new BoxGeometry(DOOR_W, DOOR_H, 0.1)
  const holes = new InstancedMesh(holeGeo, toonMat(0x14191f), DOOR_XS.length)
  holes.name = 'train:holes'
  root.add(holes)

  // ── 차문 32개소 × 2패널
  const doorGeo = new BoxGeometry(PANEL_W, DOOR_H, 0.14)
  const carDoors = new InstancedMesh(doorGeo, toonMat(0x6f8797), DOOR_XS.length * 2)
  carDoors.name = 'train:doors'
  root.add(carDoors)

  // ── 안전문(PSD) 가동문 32개소 × 2패널 — 승강장에 고정
  const psdGeo = new BoxGeometry(PANEL_W, 1.95, 0.16)
  const psdDoors = new InstancedMesh(psdGeo, toonMat(0xc6ced4), DOOR_XS.length * 2)
  psdDoors.name = 'psd:doors'
  root.add(psdDoors)

  // ── 선로 (시각용)
  const rail = new Mesh(new BoxGeometry(200, 0.16, 0.12), toonMat(0x6b6f74))
  rail.position.set(142, FLOOR.B2 - 1.02, -13.34)
  root.add(rail)
  const rail2 = rail.clone()
  rail2.position.z = -14.66
  root.add(rail2)

  for (const m of [bodies, bands, carDoors, psdDoors, windows, holes]) m.frustumCulled = false

  const m4 = new Matrix4()
  const q = new Quaternion()
  const one = new Vector3(1, 1, 1)

  return {
    root,
    sync(s) {
      const t = s.train
      const visible = t.state !== 'incoming'
      bodies.visible = visible
      bands.visible = visible
      carDoors.visible = visible
      windows.visible = visible
      holes.visible = visible

      if (visible) {
        for (let k = 0; k < TRAIN.carCount; k++) {
          const cx = t.x + k * TRAIN.carLength + TRAIN.carLength / 2
          const cz = -(TRAIN.bodyYMin + bodyDepth / 2)
          m4.compose(new Vector3(cx, FLOOR.B2 + 1.65, cz), q, one)
          bodies.setMatrixAt(k, m4)
          m4.compose(new Vector3(cx, FLOOR.B2 + 0.95, cz), q, one)
          bands.setMatrixAt(k, m4)
          m4.compose(new Vector3(cx, FLOOR.B2 + 2.25, cz), q, one)
          windows.setMatrixAt(k, m4)
        }
        bodies.instanceMatrix.needsUpdate = true
        bands.instanceMatrix.needsUpdate = true
        windows.instanceMatrix.needsUpdate = true
      }

      // 문 패널: progress 0 → 닫힘(중앙), 1 → 완전 개방(양쪽 PANEL_W만큼)
      const slide = t.doorProgress * PANEL_W
      const trainOffset = t.x - TRAIN.firstCarX
      DOOR_XS.forEach((x, i) => {
        const cx = x + trainOffset
        m4.compose(new Vector3(cx, FLOOR.B2 + DOOR_H / 2, -(TRAIN.bodyYMin + 0.2)), q, one)
        holes.setMatrixAt(i, m4)
        for (const sgn of [-1, 1] as const) {
          const idx = i * 2 + (sgn === -1 ? 0 : 1)
          m4.compose(
            new Vector3(cx + sgn * (PANEL_W / 2 + slide), FLOOR.B2 + DOOR_H / 2, -(TRAIN.bodyYMin + 0.07)),
            q, one,
          )
          carDoors.setMatrixAt(idx, m4)
          m4.compose(
            new Vector3(x + sgn * (PANEL_W / 2 + slide), FLOOR.B2 + 0.98, -PSD_Y),
            q, one,
          )
          psdDoors.setMatrixAt(idx, m4)
        }
      })
      carDoors.instanceMatrix.needsUpdate = true
      psdDoors.instanceMatrix.needsUpdate = true
      holes.instanceMatrix.needsUpdate = true
    },
  }
}
