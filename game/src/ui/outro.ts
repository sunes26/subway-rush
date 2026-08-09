/**
 * 엔딩 컷 오버레이 — **화면에만 존재하는 것들**. `ui/intro.ts` 와 짝이다.
 *
 * 여기 있는 것은 둘뿐이다:
 *   · 한 마디 — 주인공의 속말. 컷 끝에 잠깐 떴다가 결과판에 자리를 넘긴다
 *   · 붉은 기 — WRONG WAY 에서 화면에 도는 색. 3D 가 아니라 화면 위 한 겹이다
 *
 * ■ 왜 한 줄뿐인가
 *
 * 인트로가 자막을 안 쓰기로 한 것과 같은 이유다(`ui/intro.ts` 헤더). 무슨 일이
 * 있었는지는 **몸과 창밖이 이미 말했다** — 무릎을 짚었고, 안내판이 신촌을 띄웠고,
 * 터널이 걷혔다. 거기에 설명을 얹으면 방금 본 것을 글자로 다시 읽히는 꼴이 된다.
 * 남기는 한 줄은 설명이 아니라 **반응**이다. 그래서 짧고, 문장이 아니다.
 *
 * 엔딩의 이름·등급·수치는 여기서 말하지 않는다. 그건 결과판(`ui/screens.ts`)의 일이고,
 * 두 화면이 같은 것을 두 번 말하면 둘 다 안 읽힌다.
 */

import type { OutroKind } from '../render/outro'
import { OUTRO_MS, SHOT } from '../render/outro'
import CSS from './css/outro.css?inline'

export type Outro = Readonly<{
  /** 컷 종류를 정하고 화면을 켠다 */
  show(kind: OutroKind): void
  /** 경과 시각(ms)을 받아 화면을 그 시점으로 맞춘다 */
  sync(tMs: number, red: number): void
  hide(): void
}>

/**
 * 한 마디 — 셋 다 **반응**이다. 상황 설명도, 평가도 아니다.
 * WRONG WAY 만 물음표로 끝난다: 아직 받아들이지 못한 사람의 말이라서다.
 */
const SAY: Readonly<Record<OutroKind, string>> = {
  success: '무사히 탔다!',
  jit: '세이프...!',
  wrongway: '방향이 반대잖아?!',
}

/**
 * 한 마디가 뜨는 시각.
 *
 * 성공 계열은 **터널이 걷힌 뒤**다 — 창밖을 먼저 보고, 그 다음에 말이 나온다.
 * WRONG WAY 는 안내판을 읽고 무너지는 순간에 붙는다.
 *
 * ★ 끝나기 0.9 → **2.6초** 전으로 당겼다. 0.9초는 "글자가 빈 순간이 없게" 하려던
 *   값인데, 실제로는 **문구가 뜨자마자 화면이 끝났다.** 말이 나온 뒤에도 배경과
 *   빛이 남아 있어야 그 말이 장면 안에서 울린다 — 바로 결과판으로 넘기면 문구가
 *   화면 전환 신호로만 읽힌다.
 */
const SAY_IN = OUTRO_MS - 2600
/** WRONG WAY 는 조금 이르다 — 무너지는 몸과 같이 나와야 농담이 맞는다 */
const SAY_IN_WRONG = SHOT.turn + 700

export const createOutro = (mount: HTMLElement): Outro => {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)

  const el = document.createElement('div')
  el.id = 'outro'
  el.innerHTML = '<div class="veil"></div><div class="say"></div>'
  mount.appendChild(el)

  const veil = el.querySelector<HTMLElement>('.veil')!
  const say = el.querySelector<HTMLElement>('.say')!
  let kind: OutroKind = 'success'

  return {
    show(k) {
      kind = k
      say.textContent = SAY[k]
      el.classList.add('on')
      el.classList.remove('say-on')
      veil.style.opacity = '0'
    },
    hide() {
      el.className = ''
      veil.style.opacity = '0'
    },
    /**
     * 클래스 토글은 **현재 시각으로부터 다시 계산한다**(누적하지 않는다) —
     * `ui/intro.ts` 와 같은 규칙이라 시간을 앞뒤로 움직여도 화면이 그 시각의 모습이 된다.
     */
    sync(t, red) {
      el.classList.toggle('say-on', t >= (kind === 'wrongway' ? SAY_IN_WRONG : SAY_IN))
      veil.style.opacity = String(Math.max(0, Math.min(1, red)))
    },
  }
}
