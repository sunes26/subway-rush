/**
 * 인트로 오버레이 — **화면에만 존재하는 것들**을 맡는다.
 *
 * 버스 실내는 여기 없다. 3인칭으로 바뀌면서 실물 지오메트리가 필요해져
 * `render/bus-interior.ts` 로 옮겼다(`css/intro.css` 헤더 참고). 문 여닫이도
 * 이제 진짜 문짝이 한다. 남은 것은 휴대폰 화면 · 놀람 · 속도선 · 3:00 이다.
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

/** 휴대폰이 올라오는 구간 */
const PHONE_IN = SHOT.bus + 120
const PHONE_OUT = SHOT.phone - 240
/** 열차 시간을 알아보는 순간 — 놀람 비트 */
const BEAT_MS = SHOT.bus + 700
/** `3:00` — 조작권이 넘어오기 직전에 떴다가 사라진다 */
const CLOCK_IN = INTRO_MS - 900
const CLOCK_OUT = INTRO_MS - 260

const MARKUP = `
<div class="rush"></div>
<div class="bang">!!!</div>
<div class="jolt"></div>
<div class="phone">
  <div class="bar"><span>08:47</span><span>LTE</span></div>
  <div class="app"><span class="l2">2</span><b>신도림역 · 내선순환</b></div>
  <dl class="row now"><dt>이번 열차</dt><dd>3분 후</dd></dl>
  <dl class="row"><dt>다음 열차</dt><dd>7분 30초 후</dd></dl>
  <div class="foot"><span>출근 <b>09:00</b></span><span>도보 4분</span></div>
</div>
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
      el.classList.toggle('phone-on', t >= PHONE_IN && t < PHONE_OUT)
      el.classList.toggle('beat', t >= BEAT_MS && t < BEAT_MS + 520)
      // 속도선은 하차가 끝나고 나서다. 내려서는 동안 흐르면 넘어진 것처럼 보인다
      el.classList.toggle('rush-on', t >= SHOT.alight && t < INTRO_MS - 160)
      el.classList.toggle('clock-on', t >= CLOCK_IN)
      el.classList.toggle('clock-out', t >= CLOCK_OUT)
    },
  }
}
