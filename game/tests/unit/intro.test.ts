/**
 * 인트로 카메라 · 주인공.
 *
 * 이 테스트가 실제로 지키는 것은 **이음매**와 **무대 경계** 둘이다.
 *
 *  1. 인트로의 마지막 프레임과 1인칭이 스폰에서 잡는 첫 프레임이 다르면, 조작권이
 *     넘어오는 순간 화면이 한 번 튄다. 그 튐은 "연출이 끝났다"를 눈으로 알려 주는
 *     신호라, 보이는 순간 인트로는 게임의 일부가 아니라 앞에 붙은 영상이 된다.
 *
 *  2. Z1 의 지면은 x −64 에서 끝난다. 카메라가 그 밖으로 나가거나 그쪽을 보면
 *     세계가 공중에 뜬 섬처럼 보인다 — 실제로 첫 구현이 그랬고, 스크린샷으로
 *     확인하기 전까지 아무 테스트도 안 걸렸다. 그래서 숫자로 잠근다.
 */

import { describe, expect, it } from 'vitest'
import { FPV } from '../../src/data/tuning'
import { SLABS, SPAWN } from '../../src/data/world'
import { BUS } from '../../src/render/bus-interior'
import { WEST } from '../../src/render/west-road'
import { SIT_DROP } from '../../src/render/pose'
import {
  actorAt, busDx, busShake, BUS_STOP_MS, FINAL_POSE, INTRO_MS, poseAt, SHOT, SWAP_MS,
} from '../../src/render/intro'

/** 50ms 격자로 인트로 전체를 훑는다 */
const everyFrame = (fn: (t: number) => void): void => {
  for (let t = 0; t <= INTRO_MS; t += 50) fn(t)
}

describe('인트로 — 이음매', () => {
  it('마지막 프레임이 스폰의 1인칭 포즈와 정확히 같다', () => {
    const end = poseAt(INTRO_MS)
    expect(end.x).toBeCloseTo(SPAWN.x, 6)
    expect(end.y).toBeCloseTo(SPAWN.y, 6)
    expect(end.eye).toBeCloseTo(SPAWN.z + FPV.eyeHeight, 6)
    // 요 0 = 동쪽 = 역 방향. 여기가 틀리면 넘겨받는 순간 몸이 홱 돈다
    expect(end.yaw).toBeCloseTo(0, 6)
    expect(end.pitch).toBeCloseTo(0, 6)
    // 화각이 안 닫히면 시야가 벌어진 채로 게임이 시작된다
    expect(end.fov).toBeCloseTo(FPV.fovDeg, 6)
    expect(end).toEqual(FINAL_POSE)
  })

  it('3인칭 → 1인칭 전환에 컷이 없다', () => {
    /**
     * `SWAP_MS` 는 카메라가 주인공의 머리에 도달하는 시각이다. 그 전후 1ms 가
     * 다르면 그건 밀고 들어간 게 아니라 **컷**이다.
     */
    const a = poseAt(SWAP_MS - 1)
    const b = poseAt(SWAP_MS + 1)
    expect(Math.hypot(b.x - a.x, b.y - a.y), '전환에서 위치가 튄다').toBeLessThan(0.01)
    expect(Math.abs(b.yaw - a.yaw), '전환에서 시선이 튄다').toBeLessThan(0.01)
    expect(Math.abs(b.eye - a.eye), '전환에서 눈높이가 튄다').toBeLessThan(0.01)
    expect(Math.abs(b.fov - a.fov), '전환에서 화각이 튄다').toBeLessThan(0.2)
    /**
     * 주인공은 **끝나기 300ms 전에** 사라진다.
     *
     * 마지막 프레임까지 켜 두면 카메라가 머리 속으로 들어가 흰 덩어리가 화면을
     * 덮는다 — 녹화본에서 평균 밝기가 107 → 117 로 튀던 그 프레임이다.
     * 300ms 앞서 끄면 그때 카메라는 아직 0.4m 뒤라 머리가 화면을 다 안 덮는다.
     */
    expect(actorAt(INTRO_MS - 400).visible, '아직 보인다').toBe(true)
    expect(actorAt(INTRO_MS - 200).visible, '카메라가 닿기 전에 사라진다').toBe(false)
  })

  it('샷 **안에서는** 카메라가 안 튄다', () => {
    /**
     * 샷 경계는 이제 **컷이다** — 거기서 값이 바뀌는 것은 의도다. 예전엔 어깨
     * 오프셋 하나로 계속 따라다녀서 경계가 없었고, 그게 "자유 카메라처럼
     * 움직인다"의 정체였다. 지킬 것은 **한 샷 안에서 카메라가 흔들리지 않는 것**이다.
     */
    /**
     * ①②③ 은 **서 있는 카메라**다 — 20ms 에 3cm 넘게 움직이면 그건 밀기(dolly)가
     * 아니라 떠다니는 것이다. ④ 만 예외로 빠르게 따라간다(주인공이 뛰므로 당연하다).
     * 대신 ④ 는 **가속이 튀지 않는지**를 본다 — 속도가 아니라 덜컹거림이 문제다.
     */
    /**
     * ①② 는 **버스와 함께** 달린다 — 그 이동은 카메라가 떠다니는 게 아니라
     * 차가 가는 것이다. 그래서 `busDx` 를 빼고 **차 안에서의 움직임**만 본다.
     */
    const still: [number, number][] = [
      [0, SHOT.interior], [SHOT.interior, SHOT.phone], [SHOT.phone, SHOT.door],
    ]
    for (const [a0, a1] of still) {
      for (let t = a0 + 20; t < a1 - 20; t += 20) {
        const a = poseAt(t)
        const b = poseAt(t + 20)
        const dx = busDx(t + 20) - busDx(t)
        expect(Math.hypot(b.x - a.x - dx, b.y - a.y), `${t}ms 위치`).toBeLessThan(0.03)
        expect(Math.abs(b.yaw - a.yaw), `${t}ms 시선`).toBeLessThan(0.03)
      }
    }
    let prevStep = 0
    for (let t = SHOT.door + 20; t < INTRO_MS - 20; t += 20) {
      const a = poseAt(t)
      const b = poseAt(t + 20)
      const step = Math.hypot(b.x - a.x, b.y - a.y)
      if (prevStep > 0) {
        expect(Math.abs(step - prevStep), `${t}ms 에서 카메라가 덜컹거린다`).toBeLessThan(0.02)
      }
      prevStep = step
    }
  })

  it('구간 밖을 물어도 끝값으로 잠긴다', () => {
    expect(poseAt(-999)).toEqual(poseAt(0))
    expect(poseAt(INTRO_MS + 9999)).toEqual(FINAL_POSE)
  })
})

describe('인트로 — 무대 경계', () => {
  it('카메라가 지면 밖으로 나가지 않는다', () => {
    /**
     * 지면의 서쪽 끝. 여기를 넘으면 세계가 떠 있는 섬이 된다.
     * 인트로에는 `west-road` 연장(x −96~−64)이 붙으므로 그만큼 더 갈 수 있다 —
     * 버스가 실제로 달릴 거리를 그 연장이 만든다.
     */
    const westEdge = Math.min(
      ...SLABS.filter((s) => s.id.startsWith('Z1-')).map((s) => s.rect[0]), WEST.xMin)
    everyFrame((t) => {
      expect(poseAt(t).x, `${t}ms 에서 지도 밖이다`).toBeGreaterThanOrEqual(westEdge)
      expect(actorAt(t).x, `${t}ms 에 주인공이 지도 밖이다`).toBeGreaterThanOrEqual(westEdge)
    })
  })

  it('밖에 나온 뒤에는 시선이 서쪽으로 넘어가지 않는다', () => {
    /**
     * 화각이 수평 106° 라 요가 π/2(북)를 넘으면 화면 왼쪽 절반이 서쪽을 향한다.
     * Z1 지면은 x −64 에서 끝나므로 밖에서 서쪽을 보면 지도 끝이 화면에 든다.
     *
     * ①② 는 예외다 — **닫힌 버스 안**이라 어느 쪽을 봐도 차체가 시야를 막는다.
     * 실제로 ① 은 주인공 앞(동쪽)에서 돌아보는 3/4 정면이라 요가 146° 지만,
     * 그 방향은 버스 서쪽 격벽이다.
     */
    for (let t = SHOT.phone; t <= INTRO_MS; t += 50) {
      const { yaw } = poseAt(t)
      expect(yaw, `${t}ms 에서 서쪽을 봤다`).toBeLessThanOrEqual(Math.PI / 2)
      expect(yaw, `${t}ms 에서 북쪽 너머를 봤다`).toBeGreaterThanOrEqual(-Math.PI / 2)
    }
  })

  it('버스 안 샷에서 카메라와 주인공이 차체를 안 뚫는다', () => {
    // 버스는 `busDx` 만큼 서쪽에 있다 — 경계도 같이 움직인다
    for (let t = 0; t < SHOT.phone; t += 50) {
      const dx = busDx(t)
      for (const [who, p] of [['카메라', poseAt(t)], ['주인공', actorAt(t)]] as const) {
        expect(p.x, `${t}ms ${who} x`).toBeGreaterThan(BUS.xMin + dx)
        expect(p.x, `${t}ms ${who} x`).toBeLessThan(BUS.xMax + dx)
        expect(p.y, `${t}ms ${who} y`).toBeGreaterThan(BUS.yMin)
        expect(p.y, `${t}ms ${who} y`).toBeLessThan(BUS.yMax)
      }
    }
  })
})

describe('인트로 — 연출 규칙', () => {
  it('버스는 하차가 시작되기 전에 완전히 선다', () => {
    // 브리프: "움직이는 버스에서 뛰어내리는 것처럼 보이면 안 된다"
    expect(BUS_STOP_MS).toBeLessThan(SHOT.phone)
    expect(Math.abs(busDx(BUS_STOP_MS)), '정차 시각에 오프셋이 0 이어야 한다').toBeLessThan(1e-9)
    expect(Math.abs(busDx(BUS_STOP_MS + 400)), '선 뒤에 다시 움직이면 안 된다').toBeLessThan(1e-9)
  })

  it('버스는 감속만 한다 — 뒤로 가거나 다시 빨라지지 않는다', () => {
    let prev = -Infinity
    let prevStep = Infinity
    for (let t = 0; t <= BUS_STOP_MS; t += 100) {
      const x = busDx(t)
      expect(x, `${t}ms 에서 뒤로 갔다`).toBeGreaterThanOrEqual(prev)
      if (prev > -Infinity) {
        const step = x - prev
        // 100ms 마다의 이동량이 계속 줄어드는 것이 곧 제동이다
        expect(step, `${t}ms 에서 다시 빨라졌다`).toBeLessThanOrEqual(prevStep + 1e-9)
        prevStep = step
      }
      prev = x
    }
  })

  it('버스가 서면 흔들림도 같이 그친다', () => {
    /**
     * 선 버스가 계속 떨면 이상하다 — 정차 후에는 프레임마다 값이 같아야 한다.
     *
     * ⚠ 정차 **직후**를 재면 안 된다. 제동 쏠림(`brakeDip`)은 일부러 260ms 더
     *   남아서 몸이 앞으로 갔다가 돌아오는 것을 그린다 — 관성이라 버스가 선
     *   순간 딱 끊기면 오히려 틀린 그림이다. 그게 끝난 뒤부터가 "정지"다.
     */
    expect(Math.abs(busShake(BUS_STOP_MS)), '정차 시각').toBeLessThan(1e-9)
    expect(Math.abs(busShake(BUS_STOP_MS + 400)), '정차 후').toBeLessThan(1e-9)
    // 달리는 동안에는 실제로 흔들려야 한다 — 0 이면 넣으나 마나다
    let peak = 0
    for (let t = 0; t < BUS_STOP_MS * 0.6; t += 17) peak = Math.max(peak, Math.abs(busShake(t)))
    expect(peak, '주행 중에는 흔들려야 한다').toBeGreaterThan(0.3)
  })

  it('3인칭 구간에서 카메라가 바닥을 보지 않는다', () => {
    /**
     * 처음엔 겨냥점을 배꼽(0.82)에 두고 카메라를 60cm 위에 올렸다. 그랬더니
     * 화면 아래 절반이 통째로 바닥이 되고, 접지 그림자 원판(반경 0.42×1.6 = 0.67m)이
     * 주인공보다 눈에 띄었다 — 가까이서 보면 그 원판이 카메라 쪽으로 뻗어 나온다.
     * 카메라를 가슴 높이(`AIM_H` 1.15)로 낮춰 거의 수평으로 본다.
     */
    // ① 실내 미디엄. ② OTS 는 휴대폰을 내려다보는 샷이라 여기 해당하지 않는다
    for (const t of [200, 700, 1300]) {
      expect(Math.abs(poseAt(t).pitch), `${t}ms 에서 시선이 기울었다`).toBeLessThan(0.25)
    }
    // 1인칭으로 넘어가면 정확히 수평이다
    expect(poseAt(INTRO_MS).pitch).toBeCloseTo(0, 6)
  })

  it('질주 구간에서만 화각이 열린다', () => {
    expect(poseAt(SHOT.door + 500).fov).toBeGreaterThan(FPV.fovDeg + 5)
    // 버스 안에서는 기본 화각 그대로 — 서 있는데 시야가 넓어질 이유가 없다
    expect(poseAt(800).fov).toBeCloseTo(FPV.fovDeg, 6)
  })

  it('앉아 있다가 인도로 내려선다', () => {
    /**
     * 앉은 동안 리그 원점은 바닥보다 `SIT_DROP` 만큼 **아래**다. 다리를 접어도
     * 골반은 안 내려오므로 리그를 통째로 내려야 엉덩이가 좌면에 얹힌다.
     */
    expect(actorAt(0).sit).toBe(1)
    expect(actorAt(0).z).toBeCloseTo(BUS.floor - SIT_DROP, 6)
    expect(actorAt(SWAP_MS).z).toBeCloseTo(0, 6)
    // 내려서는 동안 위로 올라가면 안 된다
    let prev = Infinity
    for (let t = 4280; t <= SWAP_MS; t += 20) {
      const z = actorAt(t).z
      expect(z, `${t}ms 에서 다시 올라갔다`).toBeLessThanOrEqual(prev + 1e-9)
      prev = z
    }
  })

  it('걷기 → 뛰기 순서가 지켜진다', () => {
    expect(actorAt(500).clip, '창밖을 볼 땐 서 있다').toBe('Idle')
    expect(actorAt(3900).clip, '문으로 갈 땐 걷는다').toBe('Walk')
    expect(actorAt(SWAP_MS).clip, '내려선 뒤엔 뛴다').toBe('Run')
  })
})
