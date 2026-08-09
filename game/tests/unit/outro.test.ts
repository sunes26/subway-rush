/**
 * 엔딩 컷 — 순수 함수 가드.
 *
 * `render/intro.ts` 를 `intro.test.ts` 가 잠그는 것과 같은 이유다: 컷이 시간의
 * 순수 함수라서 **마지막 프레임의 그림을 단정할 수 있다.** 벽시계로 굴리는 연출은
 * 이걸 못 한다.
 *
 * 여기서 지키는 것은 넷이다.
 *   ① 어떤 엔딩이 어떤 컷을 받는가 — **탄 채로 끝나는 실패에 성공 컷이 붙지 않는다**
 *   ② 컷 길이가 반복 플레이가 견딜 범위인가
 *   ③ 카메라가 객실 밖으로 나가지 않는가
 *   ④ 각 컷이 자기 몫의 몸짓을 실제로 내는가
 */

import { describe, expect, it } from 'vitest'
import { TRAIN } from '../../src/data/tuning'
import { CABIN_Y1, DOOR_XS } from '../../src/data/world'
import {
  anchorXOf, OUTRO_MS, outroAt, outroKindOf, SHOT, STAND_Y, WALK_MS,
} from '../../src/render/outro'

/** 창 중심 x — 실제로는 `anchorXOf(boardedDoorX, train.x)` 가 낸다 */
const AX = 114

/**
 * 앵커 — **32개 문 전수로 잠근다.**
 *
 * 이 파일에서 가장 값비싼 테스트다. 여기가 뚫려 있어서 "사람이 벽에 껴 있다"가
 * 세 번 반복됐다. E2E 는 문 하나(`DOOR_XS[8]`, 오프셋 +2)만 밟았고 유닛은 앵커를
 * 아예 안 봤다. 둘 다 통과하는 채로 문 넷 중 하나가 사람을 **차량 연결부**에
 * 세우고 있었다(`render/outro.ts anchorXOf` 주석에 실측 있음).
 */
describe('엔딩 앵커는 어느 문으로 타든 안전한 창 중심이다', () => {
  /** 차량 경계 = 연결부. 앵커가 여기 앉으면 좌석도 창도 차체도 없다 */
  const isCarBoundary = (x: number): boolean =>
    Math.abs(((x - TRAIN.firstCarX) % TRAIN.carLength + TRAIN.carLength) % TRAIN.carLength) < 1e-6

  it('32개 문 어디서 타도 앵커가 차량 경계에 앉지 않는다', () => {
    for (const doorX of DOOR_XS) {
      const ax = anchorXOf(doorX, TRAIN.firstCarX)   // 미끄러짐 0 인 명목 좌표로 본다
      expect(isCarBoundary(ax), `문 ${doorX} → 앵커 ${ax} 가 연결부다`).toBe(false)
    }
  })

  it('앵커는 문 사이 중점 셋(+4·+8·+12) 중 하나다 — 창이 있는 자리', () => {
    for (const doorX of DOOR_XS) {
      const inCar = (anchorXOf(doorX, TRAIN.firstCarX) - TRAIN.firstCarX) % TRAIN.carLength
      expect([4, 8, 12], `문 ${doorX}`).toContain(inCar)
    }
  })

  it('앵커는 열차 밖으로 안 나간다 — 마지막 문(204)이 꼬리 끝을 가리켰었다', () => {
    const tail = TRAIN.firstCarX + TRAIN.carCount * TRAIN.carLength
    for (const doorX of DOOR_XS) {
      const ax = anchorXOf(doorX, TRAIN.firstCarX)
      expect(ax, `문 ${doorX}`).toBeGreaterThan(TRAIN.firstCarX)
      expect(ax, `문 ${doorX}`).toBeLessThan(tail)
    }
  })

  it('어느 문에서든 걸어갈 거리가 같다 — 문마다 템포가 달라지면 안 된다', () => {
    const walks = DOOR_XS.map((d) => Math.abs(anchorXOf(d, TRAIN.firstCarX) - d))
    expect(new Set(walks).size, `거리가 여러 종류다: ${[...new Set(walks)].join()}`).toBe(1)
  })

  it('열차가 미끄러진 만큼 앵커도 같이 밀린다', () => {
    const slide = -0.544
    expect(anchorXOf(112, TRAIN.firstCarX + slide)).toBeCloseTo(114 + slide, 6)
  })
})

/**
 * 앵커까지 걸어가기 — **종점이 정확해야 한다.**
 *
 * 순간이동을 안 쓰는 대신, 보간이 끝나는 순간의 값이 곧 앵커여야 한다. 미세한
 * 오차가 남으면 그 뒤 컷 전체가 그만큼 어긋난 자리에서 돌아간다.
 */
describe('탄 자리에서 앵커까지 걸어온다', () => {
  const FROM = { x: AX - 2, y: 13.2 }

  it('시작은 탄 자리, 끝은 앵커 — 오차가 안 남는다', () => {
    for (const kind of ['success', 'jit', 'wrongway'] as const) {
      const a0 = outroAt(kind, 0, AX, 0, FROM).actor
      expect(a0.x, kind).toBeCloseTo(FROM.x, 6)
      expect(a0.y, kind).toBeCloseTo(FROM.y, 6)

      const done = outroAt(kind, WALK_MS[kind], AX, 0, FROM).actor
      expect(done.x, kind).toBeCloseTo(AX, 9)
      expect(done.y, kind).toBeCloseTo(STAND_Y, 9)
    }
  })

  it('도착 뒤에는 앵커에 붙어 있다 — 끝까지 한 번도 안 떠난다', () => {
    for (const kind of ['success', 'jit', 'wrongway'] as const) {
      for (let t = WALK_MS[kind]; t <= OUTRO_MS; t += 100) {
        const a = outroAt(kind, t, AX, 0, FROM).actor
        expect(a.x, `${kind} t=${t}`).toBeCloseTo(AX, 9)
        expect(a.y, `${kind} t=${t}`).toBeCloseTo(STAND_Y, 9)
      }
    }
  })

  it('걷는 동안은 걷는 클립이고, 도착하면 아니다', () => {
    for (const kind of ['success', 'jit', 'wrongway'] as const) {
      expect(outroAt(kind, WALK_MS[kind] - 50, AX, 0, FROM).actor.clip, kind).toBe('Walk')
      expect(outroAt(kind, WALK_MS[kind] + 50, AX, 0, FROM).actor.clip, kind).not.toBe('Walk')
    }
  })

  /** JIT 은 **급해야 한다** — 같은 배경을 쓰는 두 엔딩을 가르는 것은 템포뿐이다 */
  it('JUST IN TIME 이 가장 빨리 걷는다', () => {
    expect(WALK_MS.jit).toBeLessThan(WALK_MS.success)
  })

  /** 걷는 시간이 컷의 첫 박자를 잡아먹으면 안 된다 */
  it('걷기가 ① 안에서 끝난다', () => {
    for (const kind of ['success', 'jit', 'wrongway'] as const) {
      expect(WALK_MS[kind], kind).toBeLessThan(SHOT.body)
    }
  })

  /** `from` 을 안 주면 예전처럼 처음부터 앵커에 서 있다 — 기존 호출을 안 깬다 */
  it('탄 자리를 안 주면 걷지 않는다', () => {
    const a = outroAt('success', 0, AX).actor
    expect(a.x).toBe(AX)
    expect(a.y).toBe(STAND_Y)
  })

  /**
   * 객차 마지막 문(+14)에서는 앵커가 **−x 쪽**이다. 그때도 몸이 가는 쪽을 봐야 한다 —
   * 뒷걸음질로 미끄러져 가면 그게 그대로 보인다.
   */
  it('앵커가 뒤쪽이면 몸도 뒤로 돈다', () => {
    const back = outroAt('success', 200, AX, 0, { x: AX + 2, y: 13.2 }).actor.facing
    const fwd = outroAt('success', 200, AX, 0, { x: AX - 2, y: 13.2 }).actor.facing
    expect(Math.abs(back)).toBeGreaterThan(Math.PI / 2)   // −x 쪽을 본다
    expect(Math.abs(fwd)).toBeLessThan(Math.PI / 2)       // +x 쪽을 본다
  })

  it('반대 방면에서도 종점이 앵커다 — y 오프셋을 두 번 더하면 안 된다', () => {
    const a = outroAt('success', WALK_MS.success, AX, 40, { x: AX - 2, y: 53.2 }).actor
    expect(a.y).toBeCloseTo(STAND_Y + 40, 9)
  })
})

describe('어떤 엔딩이 어떤 컷을 받는가', () => {
  it('E-04 는 JUST IN TIME, E-08 은 WRONG WAY', () => {
    expect(outroKindOf('E-04', true)).toBe('jit')
    expect(outroKindOf('E-08', true)).toBe('wrongway')
  })

  it('정상 탑승 계열은 성공 컷을 받는다', () => {
    for (const id of ['E-01', 'E-02', 'E-03', 'E-05', 'E-14']) {
      expect(outroKindOf(id, true), id).toBe('success')
    }
  })

  /**
   * ★ **이 테스트가 이 파일의 존재 이유다.**
   *
   * E-09(부정승차 적발) · E-10(양심 파산) · E-11(에스컬레이터 참사) 는 우선순위가
   * E-04·E-02 보다 높아서 **열차에 타고도** 그쪽이 뜬다. `boarded` 만 보고 컷을
   * 고르면 양심이 바닥난 판에 한강 일출이 뜬다 — 연출이 위로가 되는 순간이다.
   */
  it('탄 채로 끝나는 실패에는 컷이 안 붙는다', () => {
    for (const id of ['E-09', 'E-10', 'E-11']) {
      expect(outroKindOf(id, true), id).toBeNull()
    }
  })

  it('못 탄 판과 엔딩 미정에는 컷이 없다', () => {
    expect(outroKindOf('E-06', false)).toBeNull()
    expect(outroKindOf('E-01', false)).toBeNull()
    expect(outroKindOf(null, true)).toBeNull()
  })
})

describe('컷 길이', () => {
  it('4~9초 안이다 — 반복 플레이 게임이라 그 이상은 벌이 된다', () => {
    expect(OUTRO_MS).toBeGreaterThanOrEqual(4000)
    expect(OUTRO_MS).toBeLessThanOrEqual(9000)
  })

  it('컷 경계가 순서대로다', () => {
    expect(SHOT.body).toBeLessThan(SHOT.turn)
    expect(SHOT.turn).toBeLessThan(SHOT.outside)
  })
})

/**
 * 인물이 서는 자리 — **실측한 객실 치수에 걸어 둔다.**
 *
 * 두 번 고쳤고 두 번 다 "좌석에 껴 보인다"였다(`outro.ts STAND_Y` 주석). 숫자만
 * 바꿔 두면 다음에 카메라를 만지다가 조용히 되돌아간다. 실측값은 이렇다:
 *   객실 내부 y 12.40 ~ 15.48 · 좌석 앞면 15.14 · 몸통 반경 약 0.35
 */
describe('인물은 통로 한가운데 선다', () => {
  const SEAT_FRONT = 15.14
  const CABIN_Y0 = 12.40
  const BODY_R = 0.35

  it('몸통 뒤와 좌석 사이가 0.6m 넘게 뜬다 — 닿는 것과 떨어져 보이는 것은 다르다', () => {
    expect(SEAT_FRONT - (STAND_Y + BODY_R)).toBeGreaterThan(0.6)
  })

  it('통로 한가운데에서 크게 안 벗어난다', () => {
    expect(Math.abs(STAND_Y - (CABIN_Y0 + SEAT_FRONT) / 2)).toBeLessThan(0.25)
  })

  /** 가까워진 만큼 화각으로 메운다 — 안 그러면 얼굴만 잡힌다 */
  it('세 컷 모두 인물에서 1.2m 넘게 떨어져 서고, 화각이 그만큼 넓다', () => {
    for (const kind of ['success', 'jit', 'wrongway'] as const) {
      for (let t = 0; t <= OUTRO_MS; t += 100) {
        const { cam } = outroAt(kind, t, AX)
        const d = Math.hypot(cam.x - AX, cam.y - STAND_Y)
        expect(d, `${kind} t=${t}`).toBeGreaterThan(1.2)
        expect(cam.fov, `${kind} t=${t}`).toBeGreaterThanOrEqual(54)
      }
    }
  })

  /**
   * 옆으로 비켜서는 각도의 상한. 1.6m(42°)까지 갔다가 화면이 객실이 아니라
   * **복도**가 됐다 — 32m 짜리 벽을 비껴보게 되기 때문이다.
   */
  it('옆으로 비켜서는 각이 30° 를 안 넘는다', () => {
    for (const kind of ['success', 'jit', 'wrongway'] as const) {
      for (let t = 0; t <= OUTRO_MS; t += 100) {
        const { cam } = outroAt(kind, t, AX)
        const deg = Math.atan2(Math.abs(cam.x - AX), STAND_Y - cam.y) * 180 / Math.PI
        expect(deg, `${kind} t=${t}`).toBeLessThan(30)
      }
    }
  })
})

describe('카메라는 객실 안에 머문다', () => {
  /**
   * 남쪽으로 나가면 안전문과 차문이 화면을 막고, 북쪽으로 나가면 창을 통과해
   * 터널 텍스처 뒤로 빠진다. 둘 다 실측에서 한 번씩 겪은 실패다.
   */
  it('세 컷 모두, 전 구간에서 y 가 문과 창 사이다', () => {
    for (const kind of ['success', 'jit', 'wrongway'] as const) {
      for (let t = 0; t <= OUTRO_MS; t += 100) {
        const { cam } = outroAt(kind, t, AX)
        expect(cam.y, `${kind} t=${t}`).toBeGreaterThan(12.42)
        expect(cam.y, `${kind} t=${t}`).toBeLessThan(CABIN_Y1)
        expect(cam.ly, `${kind} t=${t}`).toBeGreaterThan(cam.y)
        // 시선은 창밖 판(차체 바깥면 바로 뒤)까지만 나간다
        expect(cam.ly, `${kind} t=${t}`).toBeLessThanOrEqual(TRAIN.bodyYMax + 0.1)
      }
    }
  })

  it('시간을 벗어난 값도 양끝으로 물린다 — 스킵·되감기에서 튀지 않는다', () => {
    expect(outroAt('success', -500, AX)).toEqual(outroAt('success', 0, AX))
    expect(outroAt('success', OUTRO_MS + 9000, AX)).toEqual(outroAt('success', OUTRO_MS, AX))
  })

  it('주인공은 객실 안쪽에 선다 — 문 앞이면 카메라를 못 뺀다', () => {
    expect(STAND_Y).toBeGreaterThan(13.5)
    expect(STAND_Y).toBeLessThan(CABIN_Y1)
  })

  /**
   * ★ **카메라도 인물도 창(기준점)에서 1m 안에 있어야 한다.**
   *
   * 창은 문 사이 2.4m 구간에만 있다. 기준점에서 1.2m 를 넘어가면 옆 문 개구로
   * 들어가고, 거기서는 문틀이 화면을 자른다 — JUST IN TIME 컷이 그렇게 깨졌다.
   */
  it('카메라와 인물이 창 구간을 안 벗어난다', () => {
    for (const kind of ['success', 'jit', 'wrongway'] as const) {
      for (let t = 0; t <= OUTRO_MS; t += 100) {
        const f = outroAt(kind, t, AX)
        expect(Math.abs(f.cam.x - AX), `cam ${kind} t=${t}`).toBeLessThan(1.0)
        expect(Math.abs(f.cam.lx - AX), `look ${kind} t=${t}`).toBeLessThan(1.0)
        expect(f.actor.x, `actor ${kind} t=${t}`).toBe(AX)
      }
    }
  })

  /**
   * 기준점은 **열차를 따라간다.** 열차가 미끄러진 만큼 카메라도 같이 가야
   * 창 앞에 남는다 — 사람 기준으로 두면 그 둘이 어긋난다(`anchorXOf` 주석).
   */
  it('기준점을 옮기면 카메라·인물이 통째로 따라간다', () => {
    const a = outroAt('success', 1000, 100)
    const b = outroAt('success', 1000, 103.5)
    expect(b.cam.x - a.cam.x).toBeCloseTo(3.5)
    expect(b.cam.lx - a.cam.lx).toBeCloseTo(3.5)
    expect(b.actor.x - a.actor.x).toBeCloseTo(3.5)
  })

})

describe('기준점 — 창 중심', () => {
  /**
   * `boardedDoorX` 는 **명목 좌표**다. 열차가 미끄러진 만큼 더해야 실제 렌더 위치가
   * 되고, 거기서 2m 옆이 창 중심이다. 이 셈이 틀리면 컷 전체가 문틀을 본다.
   */
  it('명목 문 x + 열차 오프셋 + 2m 다', () => {
    // 열차가 제자리(78)면 문 옆 2m
    expect(anchorXOf(112, 78)).toBeCloseTo(114)
    // 0.544m 미끄러졌으면 기준점도 그만큼 따라간다 (실측값)
    expect(anchorXOf(112, 77.456)).toBeCloseTo(113.456)
  })
})

describe('반대 방면 승강장', () => {
  /**
   * 두 승강장은 **y 만 다르다**(`Y_OFFSET_OPP`). 오프셋을 빠뜨리면 카메라만 본편
   * 자리에 남아 40m 떨어진 빈 곳을 비춘다 — 실측으로 그 그림을 한 번 봤다.
   */
  it('오프셋을 주면 카메라도 인물도 통째로 따라간다', () => {
    const a = outroAt('wrongway', 1000, AX, 0)
    const b = outroAt('wrongway', 1000, AX, 40)
    expect(b.cam.y - a.cam.y).toBeCloseTo(40)
    expect(b.cam.ly - a.cam.ly).toBeCloseTo(40)
    expect(b.actor.y - a.actor.y).toBeCloseTo(40)
    // x 와 높이는 안 건드린다
    expect(b.cam.x).toBe(a.cam.x)
    expect(b.cam.eye).toBe(a.cam.eye)
  })
})

describe('WRONG WAY 전용 효과', () => {
  /**
   * ★ **지속 흔들림이 아니다.** 판이 끝난 뒤 보는 화면이라 계속 흔들면 멀미만 남는다.
   *   놀란 한 순간(안내판 직후 0.45초)에 몰려 있고, 그 앞뒤로는 정확히 0 이어야 한다.
   */
  it('흔들림은 안내판 직후 0.45초에만 있다', () => {
    expect(outroAt('wrongway', SHOT.turn - 50, AX).cam.shakeX).toBe(0)
    expect(Math.abs(outroAt('wrongway', SHOT.turn + 120, AX).cam.shakeX)).toBeGreaterThan(0)
    expect(outroAt('wrongway', SHOT.turn + 500, AX).cam.shakeX).toBe(0)
    expect(outroAt('wrongway', OUTRO_MS, AX).cam.shakeX).toBe(0)
  })

  it('진폭이 2cm 를 안 넘는다', () => {
    for (let t = SHOT.turn; t < SHOT.turn + 500; t += 5) {
      const c = outroAt('wrongway', t, AX).cam
      expect(Math.abs(c.shakeX), `t=${t}`).toBeLessThanOrEqual(0.021)
      expect(Math.abs(c.shakeZ), `t=${t}`).toBeLessThanOrEqual(0.015)
    }
  })

  it('성공 계열은 절대 안 흔들린다', () => {
    for (const kind of ['success', 'jit'] as const) {
      for (let t = 0; t <= OUTRO_MS; t += 100) {
        expect(outroAt(kind, t, AX).cam.shakeX, `${kind} t=${t}`).toBe(0)
        expect(outroAt(kind, t, AX).stage.flash, `${kind} t=${t}`).toBe(1)
      }
    }
  })

  /** 번개는 **지옥이 드러난 뒤에** 친다 — 터널에서 번쩍이면 그냥 오류로 보인다 */
  it('번개는 짧고, 지옥이 드러난 뒤에 친다', () => {
    expect(outroAt('wrongway', SHOT.turn + 100, AX).stage.flash).toBe(1)
    expect(outroAt('wrongway', SHOT.turn + 1020, AX).stage.flash).toBeGreaterThan(1.5)
    expect(outroAt('wrongway', SHOT.turn + 1200, AX).stage.flash).toBe(1)
  })
})

describe('컷마다 자기 몫의 몸짓이 있다', () => {
  it('JUST IN TIME 은 무릎을 짚는다 — 그리고 끝까지 다 펴지 않는다', () => {
    // ⚠ 시각을 `WALK_MS` 에서 파생시킨다 — 휘청임은 **걸어 들어온 뒤**에 온다
    expect(outroAt('jit', WALK_MS.jit + 500, AX).actor.brace).toBeGreaterThan(0.9)
    const last = outroAt('jit', OUTRO_MS, AX).actor.brace
    expect(last).toBeGreaterThan(0)      // 몇 초 만에 숨이 돌아오지는 않는다
    expect(last).toBeLessThan(0.5)
  })

  it('WRONG WAY 는 안내판을 읽은 뒤에야 무너진다', () => {
    // 그 전까지는 성공한 사람과 똑같이 서 있어야 뒤집히는 순간이 농담이 된다
    expect(outroAt('wrongway', SHOT.turn - 100, AX).actor.slump).toBe(0)
    expect(outroAt('wrongway', OUTRO_MS, AX).actor.slump).toBeGreaterThan(0.9)
  })

  /**
   * ★ 순서가 이 엔딩의 전부다. **안내판을 먼저 읽고, 그 다음에 창밖이 바뀐다.**
   *   반대로 두면 그냥 무서운 배경이 지나간 것이 되고, 「신촌」이 원인이 아니게 된다.
   */
  it('WRONG WAY 는 안내판이 먼저, 지옥이 나중이다', () => {
    const atLed = outroAt('wrongway', SHOT.turn - 200, AX).stage
    expect(atLed.led, '안내판은 이미 켜져 있다').toBeGreaterThan(0.9)
    expect(atLed.tunnel, '창밖은 아직 터널이다').toBe(1)

    const last = outroAt('wrongway', OUTRO_MS, AX).stage
    expect(last.tunnel, '지옥이 드러났다').toBeLessThan(0.02)
    expect(last.glow, '붉은 빛이 객실로 들어온다').toBeGreaterThan(0.9)
    expect(last.red).toBeGreaterThan(0)
  })

  /**
   * 창밖 빛이 **객실 안으로 들어오는가.** unlit 판만 바꾸면 "창에 붙인 사진"이 된다 —
   * 배경과 인물이 같은 공간에 있다는 증거는 이 값 하나뿐이다(`ending-stage.ts` 광원).
   */
  it('세 컷 모두 끝에서 창밖 빛이 들어와 있다', () => {
    for (const kind of ['success', 'jit', 'wrongway'] as const) {
      expect(outroAt(kind, OUTRO_MS, AX).stage.glow, kind).toBeGreaterThan(0.9)
      expect(outroAt(kind, 0, AX).stage.glow, kind).toBe(0)
    }
  })

  it('성공 계열은 터널이 걷히고 붉은 기가 없다', () => {
    for (const kind of ['success', 'jit'] as const) {
      expect(outroAt(kind, OUTRO_MS, AX).stage.tunnel, kind).toBeLessThan(0.02)
      expect(outroAt(kind, OUTRO_MS, AX).stage.red, kind).toBe(0)
    }
  })

  it('창밖은 멈춰 있다가 붙는다 — 처음부터 최고 속도면 이미 달리던 열차다', () => {
    const early = outroAt('success', 200, AX).stage.scroll
    const mid = outroAt('success', 1000, AX).stage.scroll
    const late = outroAt('success', OUTRO_MS, AX).stage.scroll
    expect(early).toBeLessThan(mid)
    expect(mid).toBeLessThan(late)
    // 가속 구간이 실제로 가속인가 — 뒤 1초가 앞 1초보다 많이 흐른다
    expect(mid - early).toBeLessThan(late - outroAt('success', OUTRO_MS - 800, AX).stage.scroll)
  })
})
