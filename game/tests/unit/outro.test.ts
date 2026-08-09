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
import { CABIN_Y1 } from '../../src/data/world'
import { OUTRO_MS, outroAt, outroKindOf, SHOT, STAND_Y } from '../../src/render/outro'

const PX = 112

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
  it('4~7초 안이다 — 반복 플레이 게임이라 그 이상은 벌이 된다', () => {
    expect(OUTRO_MS).toBeGreaterThanOrEqual(4000)
    expect(OUTRO_MS).toBeLessThanOrEqual(7000)
  })

  it('컷 경계가 순서대로다', () => {
    expect(SHOT.body).toBeLessThan(SHOT.turn)
    expect(SHOT.turn).toBeLessThan(SHOT.outside)
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
        const { cam } = outroAt(kind, t, PX)
        expect(cam.y, `${kind} t=${t}`).toBeGreaterThan(12.42)
        expect(cam.y, `${kind} t=${t}`).toBeLessThan(CABIN_Y1)
        expect(cam.ly, `${kind} t=${t}`).toBeGreaterThan(cam.y)
        // 시선은 창밖 판(차체 바깥면 바로 뒤)까지만 나간다
        expect(cam.ly, `${kind} t=${t}`).toBeLessThanOrEqual(TRAIN.bodyYMax + 0.1)
      }
    }
  })

  it('시간을 벗어난 값도 양끝으로 물린다 — 스킵·되감기에서 튀지 않는다', () => {
    expect(outroAt('success', -500, PX)).toEqual(outroAt('success', 0, PX))
    expect(outroAt('success', OUTRO_MS + 9000, PX)).toEqual(outroAt('success', OUTRO_MS, PX))
  })

  it('주인공은 객실 안쪽에 선다 — 문 앞이면 카메라를 못 뺀다', () => {
    expect(STAND_Y).toBeGreaterThan(13.5)
    expect(STAND_Y).toBeLessThan(CABIN_Y1)
  })
})

describe('반대 방면 승강장', () => {
  /**
   * 두 승강장은 **y 만 다르다**(`Y_OFFSET_OPP`). 오프셋을 빠뜨리면 카메라만 본편
   * 자리에 남아 40m 떨어진 빈 곳을 비춘다 — 실측으로 그 그림을 한 번 봤다.
   */
  it('오프셋을 주면 카메라도 인물도 통째로 따라간다', () => {
    const a = outroAt('wrongway', 1000, PX, 0)
    const b = outroAt('wrongway', 1000, PX, 40)
    expect(b.cam.y - a.cam.y).toBeCloseTo(40)
    expect(b.cam.ly - a.cam.ly).toBeCloseTo(40)
    expect(b.actor.y - a.actor.y).toBeCloseTo(40)
    // x 와 높이는 안 건드린다
    expect(b.cam.x).toBe(a.cam.x)
    expect(b.cam.eye).toBe(a.cam.eye)
  })
})

describe('컷마다 자기 몫의 몸짓이 있다', () => {
  it('JUST IN TIME 은 무릎을 짚는다 — 그리고 끝까지 다 펴지 않는다', () => {
    expect(outroAt('jit', 500, PX).actor.brace).toBeGreaterThan(0.9)
    const last = outroAt('jit', OUTRO_MS, PX).actor.brace
    expect(last).toBeGreaterThan(0)      // 5초 만에 숨이 돌아오지는 않는다
    expect(last).toBeLessThan(0.5)
  })

  it('WRONG WAY 는 안내판을 읽은 뒤에야 무너진다', () => {
    // 그 전까지는 성공한 사람과 똑같이 서 있어야 뒤집히는 순간이 농담이 된다
    expect(outroAt('wrongway', SHOT.turn - 100, PX).actor.slump).toBe(0)
    expect(outroAt('wrongway', OUTRO_MS, PX).actor.slump).toBeGreaterThan(0.9)
  })

  it('WRONG WAY 는 터널을 안 걷는다 — 잘못 탄 사람에게 일출은 보상이다', () => {
    expect(outroAt('wrongway', OUTRO_MS, PX).stage.tunnel).toBe(1)
    expect(outroAt('wrongway', OUTRO_MS, PX).stage.red).toBeGreaterThan(0)
  })

  it('성공 계열은 터널이 걷히고 붉은 기가 없다', () => {
    for (const kind of ['success', 'jit'] as const) {
      expect(outroAt(kind, OUTRO_MS, PX).stage.tunnel, kind).toBeLessThan(0.02)
      expect(outroAt(kind, OUTRO_MS, PX).stage.red, kind).toBe(0)
    }
  })

  it('창밖은 멈춰 있다가 붙는다 — 처음부터 최고 속도면 이미 달리던 열차다', () => {
    const early = outroAt('success', 200, PX).stage.scroll
    const mid = outroAt('success', 1000, PX).stage.scroll
    const late = outroAt('success', OUTRO_MS, PX).stage.scroll
    expect(early).toBeLessThan(mid)
    expect(mid).toBeLessThan(late)
    // 가속 구간이 실제로 가속인가 — 뒤 1초가 앞 1초보다 많이 흐른다
    expect(mid - early).toBeLessThan(late - outroAt('success', OUTRO_MS - 800, PX).stage.scroll)
  })
})
