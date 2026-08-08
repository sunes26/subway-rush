/**
 * 타이틀 · 로딩 · 엔딩 화면.
 *
 * ★ **두 화면 다 실물 여객 안내 설비다.** 게임 메뉴가 아니다.
 *   서울 지하철 80% · 게임 UI 20%. 판 밖으로 나가는 카드·박스를 만들지 않는다.
 *
 * ── 이번 판에서 **덜어 낸** 것 ──
 *   앞선 판은 방향은 맞았는데 **큰 전광판에 웹 UI 를 넣은 꼴**이었다. 작은 글자가
 *   너무 많아 어느 것도 안 읽혔다. 그래서 요소를 더하는 대신 지웠다.
 *     · 타이틀 하단 조작법 한 줄 — 이것 하나가 화면을 개발 데모로 만들었다
 *     · 타이틀의 SEED · 플레이 횟수 — 결과에 영향을 주지 않는 디버그성 수치
 *     · 엔딩의 혼잡도·체력·양심·스타일·발견 **동시 노출** — 6개를 다 보여 주면
 *       무슨 엔딩인지가 안 보인다. 엔딩마다 **관련 있는 값 최대 2개**만 고른다
 *     · 엔딩 NEW 배지 — 도감을 화면에서 숨긴 이상 혼자서는 뜻이 안 선다
 *
 * 기준 하나: **읽을 수 없는 정보는 정보가 아니다.**
 */

import { formatClock } from '../core/math'
import { pickLine, resolveEnding, type EndingDef } from '../data/endings'
import { QUEUE_MARKERS } from '../data/world'
import type { GameState } from '../state/types'
// 스타일은 `css/screens.css` 가 단일 원천이다 — UI 킷(/uikit.html)이 같은 파일을 읽는다.
import CSS from './css/screens.css?inline'

export type Screens = Readonly<{
  sync(s: GameState): void
  hideLoading(): void
  setLoading(text: string): void
}>

/**
 * 다음 열차까지. **타이틀과 엔딩이 같은 값을 쓴다** — 한쪽만 고치면 같은 역의
 * 두 안내판이 서로 다른 말을 하게 된다. 시뮬에 없는 값이라 표시 상수로만 둔다
 * (열차 스케줄은 `systems/train.ts` 가 이번 편성 하나만 다룬다).
 */
const NEXT_TRAIN = '4분 30초'

/** 판정 문구 — 상태값에만 색이 붙는다. 판 전체를 물들이지 않는다. */
const TONE_WORD = { success: '성공', fail: '실패', hidden: '특별' } as const

/** 화면에 띄우는 결과값 한 칸. `wide` 면 두 칸을 합쳐 한 줄로 쓴다. */
type Fact = Readonly<{ label: string; value: string; wide?: boolean }>

const won = (n: number): string => `${n.toLocaleString('ko-KR')}원`

/** 3-1 승차위치에서 탔는가 — E-03 의 판정과 같은 식(`data/endings.ts`)이다 */
const atFirstQueue = (s: GameState): boolean =>
  s.boardedDoorX !== null && Math.abs(s.boardedDoorX - QUEUE_MARKERS[0].x) <= 3

/**
 * 이 엔딩에서 **기억에 남는 값**을 고른다 — 최대 2개.
 *
 * ★ 여기가 이번 개편의 핵심이다. 예전엔 16종 전부에 같은 6개 수치를 뿌리고
 *   색만 갈랐다. 그러면 "무슨 일이 있었나"가 아니라 "성적표"가 된다.
 *   동전 부자에게 필요한 건 동전이지 스타일 점수가 아니고, 단소에 맞아 끝난
 *   판에 필요한 건 몇 대 맞았나지 시크릿 개수가 아니다.
 *
 * 데이터를 새로 만들지 않는다 — 전부 `GameState` 와 `EndingDef` 에 이미 있는 값이다.
 * 판단만 여기(표현 계층)서 하고 `data/endings.ts` 는 건드리지 않는다.
 */
const factsFor = (e: EndingDef, s: GameState): readonly Fact[] => {
  const left: Fact = { label: '남은 시간', value: formatClock(Math.max(0, s.timeLeftMs)) }
  const next: Fact = { label: '다음 열차', value: NEXT_TRAIN }
  // 실패 계열 중 **원인이 곧 교훈**인 것들은 힌트 한 줄이 어떤 수치보다 값지다
  const hint = (): readonly Fact[] =>
    e.hint ? [{ label: '', value: e.hint, wide: true }] : [next]

  switch (e.id) {
    // ── 시간이 곧 이 엔딩인 것들 ──
    case 'E-01': case 'E-02': case 'E-04':
      return [left]
    case 'E-03':
      // 앉아서 간다 — 승차위치가 조건이다. 그게 이 엔딩이 특별한 이유다
      return atFirstQueue(s) ? [{ label: '승차위치', value: '3-1' }, left] : [left]

    // ── 열차를 놓친 것들 — 다음 열차가 유일하게 쓸모 있는 정보다 ──
    case 'E-06':
      return [next]
    case 'E-07':
      return [next]

    // ── 원인이 분명한 실패 — 힌트가 결과값을 대신한다 ──
    case 'E-08': case 'E-09': case 'E-15': case 'E-16':
      return hint()

    // ── 값 자체가 사건인 것들 ──
    case 'E-10':
      return [{ label: '양심', value: `${s.scores.conscience}` }]
    case 'E-11':
      return [{ label: '밀친 횟수', value: `${s.tally.pushes}회` }]
    case 'E-14':
      return [{ label: '획득 동전', value: won(s.tally.coinsEarned) }, left]

    // ── 히든 — 왜 이게 떴는지가 곧 보상이다 ──
    case 'E-05': {
      const why = e.reason?.(s)
      return why ? [{ label: '달성', value: why, wide: true }] : [left]
    }
    case 'E-12':
      return [{ label: '', value: '유실물 반납 · 할아버지 · 자리 양보', wide: true }]
    case 'E-13':
      return []                    // 문구 하나로 끝나는 엔딩이다. 억지로 채우지 않는다

    default:
      return s.boarded ? [left] : [next]
  }
}

export const createScreens = (mount: HTMLElement): Screens => {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)

  const loading = document.createElement('div')
  loading.id = 'load'
  loading.textContent = 'LOADING…'
  mount.appendChild(loading)

  const el = document.createElement('div')
  el.id = 'screen'
  mount.appendChild(el)

  let lastKey = ''

  /**
   * 타이틀 — 매달린 안내판 한 장. 화면에서 **가장 먼저 읽혀야 하는 것은 게임 이름**이다.
   *
   * 그래서 `PRESS ENTER` 를 흰 LED 로 내린다. 앰버로 두면 로고와 같은 밝기라
   * 시선이 갈린다 — 안내판에서 앰버는 "지금 무슨 열차가 오는가"의 색이지
   * 버튼의 색이 아니다.
   */
  const title = (): string => `
    <div class="board title">
      <div class="brackets"><i></i><i></i></div>
      <div class="face">
        <div class="row">
          <div class="logo">
            <span class="train" aria-hidden="true"></span>
            <b class="ko"><em>지하철</em> <u>러쉬</u></b>
            <span class="speed" aria-hidden="true"><i></i><i></i><i></i></span>
            <small>SUBWAY RUSH</small>
          </div>
          <div class="arrive">
            <div class="dir"><span class="line2">2</span>신도림 방면</div>
            <dl><dt>이번 열차</dt><dd class="soon">잠시 후 도착</dd></dl>
            <dl><dt>다음 열차</dt><dd>${NEXT_TRAIN}</dd></dl>
          </div>
        </div>
        <div class="cta"><i>▶</i><b>PRESS ENTER</b><i>◀</i></div>
        <div class="keys"><span><b>ESC</b> 설정</span></div>
      </div>
    </div>`

  const ending = (s: GameState): string => {
    const e = resolveEnding(s)
    el.className = `on ${e.tone}`
    const facts = factsFor(e, s)

    return `
      <div class="board result">
        <div class="brackets"><i></i><i></i></div>
        <div class="face">
          <div class="head">
            <span><span class="line2">2</span>신도림 방면</span>
            <span>${e.id}</span>
          </div>
          <div class="title-row">
            <div class="name">${e.tone === 'hidden' ? '★ ' : ''}${e.title}</div>
            <div class="verdict">${TONE_WORD[e.tone]}</div>
          </div>
          <div class="say">${pickLine(e, s.seed)}</div>
          ${facts.length === 0 ? '' : `<div class="facts">${facts.map((f) => `
            <dl${f.wide ? ' class="wide"' : ''}>
              ${f.label ? `<dt>${f.label}</dt>` : ''}<dd>${f.value}</dd>
            </dl>`).join('')}</div>`}
          <div class="keys"><span><b>R</b> 다시하기</span><span><b>ESC</b> 설정</span></div>
        </div>
      </div>`
  }

  return {
    hideLoading() { loading.style.display = 'none' },
    setLoading(text: string) { loading.textContent = text },
    sync(s) {
      // 엔딩 화면이 읽는 값이 바뀌면 다시 그린다. 안 넣으면 첫 렌더 시점 값이 굳는다.
      const key = `${s.phase}:${s.endingId ?? ''}:${s.seed}:${s.boarded}:` +
        `${s.timeLeftMs}:${s.scores.conscience},${s.tally.coinsEarned},${s.tally.pushes}`
      if (key === lastKey) return
      lastKey = key
      if (s.phase === 'title') {
        el.className = 'on'
        el.innerHTML = title()
      } else if (s.phase === 'ended') {
        el.innerHTML = ending(s)
      } else {
        el.className = ''
        el.innerHTML = ''
      }
    },
  }
}
