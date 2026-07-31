/**
 * 게이트 램프 · 플랩 동기화.
 *
 * 램프 색은 `workingIds.includes(id)`의 직접 투영이다. 별도 데이터가 없으므로
 * "램프가 거짓말한다"는 버그가 구조적으로 불가능하다 (MAP §5.4).
 */

import { BoxGeometry, Group, InstancedMesh, Matrix4, Quaternion, Vector3, type Mesh as TMesh } from 'three'
import { PALETTE } from '../data/tuning'
import { FLOOR, GATES, GATE_BODY } from '../data/world'
import type { GameState } from '../state/types'
import { emissiveMat, toonMat } from './toon'

const GREEN = PALETTE.line2
const RED = PALETTE.danger

export type GateRig = Readonly<{ root: Group; sync(s: GameState, dtSec: number): void }>

export const createGateRig = (lamps: readonly TMesh[]): GateRig => {
  const root = new Group()
  root.name = 'gate-flaps'

  // 플랩 12장(게이트당 2) — 인스턴싱. 개별 Mesh로 두면 Z3에서만 드로우 콜 12개다.
  const flapMesh = new InstancedMesh(
    new BoxGeometry(0.1, 0.95, 1), toonMat(0xd7dce1), GATES.length * 2,
  )
  root.add(flapMesh)
  const cx = (GATE_BODY.xMin + GATE_BODY.xMax) / 2
  const m4 = new Matrix4()
  const q = new Quaternion()
  const flaps = GATES.map((g) => ({ def: g, open: 0 }))

  const green = emissiveMat(GREEN)
  const red = emissiveMat(RED)

  return {
    root,
    sync(s, dtSec) {
      lamps.forEach((lamp, i) => {
        const gate = GATES[i]
        if (!gate) return
        const ok = s.gates.workingIds.includes(gate.id)
        lamp.material = ok ? green : red
        // 정상 게이트는 은은히 맥동해 시선을 끈다. 고장은 정적 — 침묵이 곧 신호다
        const k = ok ? 0.9 + Math.sin(performance.now() * 0.004 + i) * 0.1 : 1
        lamp.scale.setScalar(k)
      })

      flaps.forEach((f, i) => {
        const shouldOpen = s.gates.passed || (s.gates.state === 'open' && s.gates.activeId === f.def.id)
        const target = shouldOpen ? 1 : 0
        f.open += (target - f.open) * (1 - Math.exp(-dtSec / 0.09))
        // 플랩이 양옆으로 접혀 들어간다. 다 열리면 스케일 0으로 접어 완전히 감춘다
        const hidden = f.open > 0.97
        for (let k = 0; k < 2; k++) {
          const sgn = k === 0 ? -1 : 1
          const y = f.def.y + sgn * (f.def.width / 4 + f.open * 0.55)
          m4.compose(
            new Vector3(cx, FLOOR.B1 + 0.5, -y), q,
            hidden ? new Vector3(0, 0, 0) : new Vector3(1, 1, f.def.width / 2),
          )
          flapMesh.setMatrixAt(i * 2 + k, m4)
        }
      })
      flapMesh.instanceMatrix.needsUpdate = true
    },
  }
}
