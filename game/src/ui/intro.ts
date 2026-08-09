/**
 * 인트로 오버레이 — **화면에만 존재하는 것들**을 맡는다.
 *
 * 실내도 휴대폰도 여기 없다. 둘 다 실물 지오메트리로 옮겼다
 * (`render/bus-interior.ts` · `render/phone.ts`). 화면 구석에 뜨는 앱 카드는
 * 주인공이 보는 물건이 아니라 플레이어에게 주는 HUD 라 공간이 두 겹이 됐다.
 *
 * 남은 것은 속도선 · 아주 짧은 섬광 · 3:00 뿐이다.
 *
 * ■ 자막을 쓰지 않는다
 *
 * 브리프의 핵심 제약이다 — *"대사나 장문의 자막으로 상황을 설명하지 않는다"*.
 * 그래서 이 화면에 있는 글자는 **휴대폰 앱 화면의 정보**와 마지막 `3:00` 뿐이다.
 * 둘 다 설명이 아니라 **주인공이 실제로 보고 있는 것**이라 자막이 아니다.
 * "이 열차를 놓치면 지각이다" 같은 문장은 한 줄도 넣지 않았다. 08:47 이라는 시각과
 * 09:00 이라는 출근 시각, 그리고 3분이라는 배차를 나란히 놓으면 그 문장은
 * 플레이어의 머릿속에서 저절로 만들어진다 — 그쪽이 훨씬 세다.
 */

import { INTRO_MS, SHOT } from '../render/intro'
import CSS from './css/intro.css?inline'

export type Intro = Readonly<{
  /** 경과 시각(ms)을 받아 화면을 그 시점으로 맞춘다 */
  sync(tMs: number): void
  show(): void
  hide(): void
}>

/** 열차 시간을 알아보는 순간 — 화면을 아주 짧게 한 번 친다 */
const BEAT_MS = SHOT.interior + 620
/**
 * `3:00` — **뛰기 시작하고 0.3초 뒤**에 뜬다.
 *
 * 내리자마자 크게 띄우면 하차 장면 위에 UI 가 얹혀 둘 다 죽는다. 몇 걸음
 * 달린 뒤에 떠야 "여기서부터 게임이다" 라는 신호가 된다.
 */
const CLOCK_IN = SHOT.door + 300
const CLOCK_OUT = INTRO_MS - 240

const MARKUP = `
<div class="rush"></div>
<div class="jolt"></div>
<div class="clock">3:00</div>
<div class="skip">ESC 건너뛰기</div>`

export const createIntro = (mount: HTMLElement): Intro => {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)

  const el = document.createElement('div')
  el.id = 'intro'
  el.innerHTML = MARKUP
  mount.appendChild(el)

  /**
   * 클래스 토글은 **현재 시각으로부터 다시 계산한다**(누적하지 않는다).
   *
   * `classList.toggle(name, cond)` 는 이미 그 상태면 아무 일도 안 하므로 매 프레임
   * 불러도 전이가 다시 시작되지 않는다. 이 성질 덕분에 시간을 앞뒤로 움직여도
   * 화면이 늘 그 시각의 모습이 된다 — 되감기가 필요한 디버깅에서 이게 중요하다.
   */
  return {
    show() { el.classList.add('on') },
    hide() { el.className = '' },
    sync(t) {
      // 놀람은 화면을 한 번 치는 것으로 끝낸다 — 큰 `!!!` 에 기대지 않는다(브리프 §17)
      el.classList.toggle('beat', t >= BEAT_MS && t < BEAT_MS + 240)
      // 속도선은 하차가 끝나고 나서다. 내려서는 동안 흐르면 넘어진 것처럼 보인다
      el.classList.toggle('rush-on', t >= SHOT.door + 120 && t < INTRO_MS - 200)
      el.classList.toggle('clock-on', t >= CLOCK_IN)
      el.classList.toggle('clock-out', t >= CLOCK_OUT)
    },
  }
}
