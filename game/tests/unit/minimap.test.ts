/**
 * 미니맵 유닛 표시 — 디렉터 지시로 "적을 안 찍는다" 원칙을 뒤집었다(`ui/minimap.ts` 헤더).
 * 캔버스 픽셀은 못 재지만 `unitsOf`는 순수 함수라 여기서 그대로 잰다.
 */

import { describe, expect, it } from 'vitest'
import { byId, GRANDPA_ID } from '../../src/data/interactables'
import { unitsOf } from '../../src/ui/minimap'
import { start } from './_pilot'

describe('unitsOf', () => {
  it('할아버지는 평소 벤치 좌표에 중립(danger=false)으로 찍힌다', () => {
    const s = start(1)
    const gp = unitsOf(s).find((u) => Math.abs(u.x - 42) < 0.01 && Math.abs(u.y - 14.9) < 0.01)
    expect(gp).toBeDefined()
    expect(gp?.danger).toBe(false)
  })

  it('추격 중이면 벤치 좌표 대신 chase.pos 를 위험으로 찍는다 — 둘 다 찍지 않는다', () => {
    const base = start(1)
    const s = {
      ...base,
      chase: { ...base.chase, active: true, pos: { x: 10, y: 20 } },
    }
    const units = unitsOf(s)
    const atChase = units.find((u) => u.x === 10 && u.y === 20)
    expect(atChase?.danger).toBe(true)
    // 벤치 좌표(42, 14.9)는 이제 안 찍힌다 — 같은 사람이 두 점으로 안 겹친다
    expect(units.some((u) => Math.abs(u.x - 42) < 0.01 && Math.abs(u.y - 14.9) < 0.01)).toBe(false)
  })

  it('이번 시드에 꺼진 방해요소는 안 찍는다', () => {
    const s = start(1, { obstacles: [] })
    const units = unitsOf(s)
    // 항상 찍는 NPC(할아버지·붕어빵 아저씨·승객 3)만 남는다 — 방해요소 액터는 전부 빠진다
    expect(units.filter((u) => u.danger).length).toBe(0)
  })

  it('켜진 방해요소만 danger 유닛으로 찍힌다', () => {
    // OBS-07은 아주머니·학생 둘을 찍는다 — 2 + 좀비폰족 1 + 역무원 1 = 4
    const s = start(1, { obstacles: ['OBS-07', 'OBS-08', 'OBS-13'] })
    const units = unitsOf(s)
    expect(units.filter((u) => u.danger).length).toBe(4)
  })

  it('할아버지·붕어빵 아저씨·승객 3명은 항상 찍힌다(방해요소 무관)', () => {
    const s = start(1, { obstacles: [] })
    expect(unitsOf(s).filter((u) => !u.danger).length).toBe(1 + 1 + 3)
  })

  it('GRANDPA_ID 좌표(interactables.ts)와 어긋나지 않는다 — 좌표를 여기서 새로 안 만든다', () => {
    const gp = byId(GRANDPA_ID)!
    const s = start(1)
    const u = unitsOf(s).find((x) => !x.danger && x.x === gp.x && x.y === gp.y)
    expect(u).toBeDefined()
  })
})
