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
import { loadSave } from '../core/save'
import { ENDINGS, resolveEnding, type EndingDef } from '../data/endings'
import { QUEUE_MARKERS } from '../data/world'
import type { EndingId, GameState } from '../state/types'
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
const NEXT_TRAIN = '20분 26초'

/**
 * 최종 상태 셋. **`실패` 라는 한글 라벨은 쓰지 않는다.**
 *
 * 열차를 놓친 것과 단소에 맞아 끝난 것은 둘 다 목표 미달성이지만, `실패` 는
 * 플레이어를 채점하는 말이라 남는 감정이 자책뿐이다. `GAME OVER` 는 상태를
 * 말할 뿐이고, 그 위에 얹히는 문구가 체념이든 황당함이든 자유로워진다.
 *
 * 색이 아니라 **글자가 상태를 말한다** — 색만으로 구분하면 색각 이상이나
 * 저대비 환경에서 세 상태가 같은 화면이 된다. 색은 거들 뿐이다.
 */
const STATUS = { success: 'SUCCESS', fail: 'GAME OVER', hidden: 'SPECIAL' } as const

/**
 * **무슨 일이 일어났는가** — 엔딩마다 한 줄. 농담보다 먼저 온다.
 *
 * 예전 판은 제목과 대사만 있어서, 처음 보는 사람은 `다음 열차` + `승강장 의자가
 * 비어 있다` 를 읽고도 자기가 열차를 놓친 건지 탄 건지 몰랐다. 재치 있는 문구가
 * 설명을 대신하면 안 된다 — 사실 → 수치 → 속마음, 세 겹으로 쌓는다.
 *
 * `data/endings.ts` 는 건드리지 않는다. 이건 표현 계층의 문장이다.
 */
/**
 * ★ **선행을 칭찬하지 않는다.** 예전엔 E-12 를 `오늘은 남을 도왔습니다` 로 적었는데,
 *   그건 사건 서술이 아니라 플레이어의 행동에 의미를 붙이는 문장이다. 이 게임은
 *   공익광고가 아니고, 도덕성을 평가하지 않는다. 일어난 일만 적는다.
 *
 * ★ 여기도 **조건을 흘리면 안 된다.** 히든 계열이 특히 그렇다.
 *   `모든 조건을 채우고` 는 조건이 존재한다는 사실 자체를 알려 주고,
 *   `세 사람을 도왔습니다` 는 몇 명을 도와야 하는지까지 알려 준다.
 *   일어난 일만 적고 개수·임계값·규칙은 적지 않는다.
 */
const WHAT_HAPPENED: Readonly<Record<EndingId, string>> = {
  'E-01': '열차에 탑승했습니다.',
  'E-02': '여유 있게 열차에 탑승했습니다.',
  'E-03': '여유 있게 열차에 탑승했습니다.',
  'E-04': '닫히는 문 사이로 간신히 탑승했습니다.',
  'E-05': '흠잡을 데 없이 탑승했습니다.',
  'E-06': '눈앞에서 열차를 놓쳤습니다.',
  'E-08': '반대 방향 열차에 탑승했습니다.',
  'E-09': '요금을 내지 않고 통과하다 적발됐습니다.',
  'E-11': '우산으로 인파를 밀어냈습니다.',
  'E-12': '열차가 떠났습니다.',
  'E-13': '볼일을 보는 사이 열차가 떠났습니다.',
  'E-14': '동전을 모아 열차에 탑승했습니다.',
  'E-15': '할아버지가 선물을 돌려주셨습니다.',
  'E-16': '도망치지 못했습니다.',
  'E-17': '개찰구에서 붙잡혔습니다.',
  'E-18': '차에 치였습니다.',
}

/** 화면에 띄우는 결과값 한 칸. `wide` 면 두 칸을 합쳐 한 줄로 쓴다. */
type Fact = Readonly<{ label: string; value: string; wide?: boolean }>

const won = (n: number): string => `${n.toLocaleString('ko-KR')}원`

/** 3-1 승차위치에서 탔는가 — E-03 의 판정과 같은 식(`data/endings.ts`)이다 */
const atFirstQueue = (s: GameState): boolean =>
  s.boardedDoorX !== null && Math.abs(s.boardedDoorX - QUEUE_MARKERS[0].x) <= 3

/**
 * 이 엔딩에서 보여 줄 값 — 최대 2개. 없으면 안 보여 준다.
 *
 * ★ **결과는 보여주되 해답은 보여주지 않는다.**
 *
 *   이 게임의 재미 한 축은 *실패 → 스스로 해석 → 다시 플레이 → 다른 선택* 이다.
 *   결과 화면이 그 탐색을 대신하면 두 번째 판이 심부름이 된다.
 *
 *   그래서 예전에 띄우던 것들을 전부 걷어냈다. 하나같이 **다음 판의 정답**이었다:
 *     · `e.hint` (E-08·09·15·16) — "벤치 근처 바닥을 살펴보면", "개찰구를 넘으면
 *        멈추신다" 는 결과가 아니라 공략이다
 *     · `e.reason` (E-05) — 히든 엔딩의 획득 조건 **전체**를 그대로 적고 있었다
 *     · E-12 의 선행 3종 목록 — 마찬가지로 조건 전체
 *     · E-11 밀친 횟수 — 발동 **임계값**이 그대로 읽힌다
 *
 *   남는 것은 **플레이하며 이미 겪어 안 것**뿐이다 — 남은 시간, 다음 열차,
 *   획득 동전, 내가 선 승차위치. 히든 계열은 값 없이 제목과 한마디로 끝낸다.
 */
const factsFor = (e: EndingDef, s: GameState): readonly Fact[] => {
  const left: Fact = { label: '남은 시간', value: formatClock(Math.max(0, s.timeLeftMs)) }
  const next: Fact = { label: '다음 열차', value: NEXT_TRAIN }

  switch (e.id) {
    // ── 시간이 곧 이 엔딩인 것들 ──
    case 'E-01': case 'E-02': case 'E-04':
      return [left]
    case 'E-03':
      // 승차위치는 조건이 아니라 **내가 선 자리**다 — 바닥에 적혀 있고 직접 밟았다
      return atFirstQueue(s) ? [{ label: '승차위치', value: '3-1' }, left] : [left]

    // ── 열차를 놓친 것들 — 다음 열차는 승강장에 서면 어차피 보인다 ──
    case 'E-06':
      return [next]

    // ── 동전은 주우면서 이미 셌다 ──
    case 'E-14':
      return [{ label: '획득 동전', value: won(s.tally.coinsEarned) }, left]

    /**
     * 나머지는 **아무것도 안 보여 준다.**
     * 부정승차·오답 선물·단소·반대편처럼 원인이 명백한 실패에 수치를 얹으면
     * 그 수치가 곧 다음 판의 정답이 된다. 히든 계열은 더더욱 — "내가 뭘 해서
     * 이게 나온 거지" 를 남겨 두는 것이 이 엔딩들의 값이다.
     */
    default:
      return []
  }
}

/**
 * 화면에 띄울 엔딩 — **`state.endingId` 가 먼저다.**
 *
 * 매번 `resolveEnding(s)` 로 다시 계산하면 E-15(오답 선물)·E-16(단소 2대째)이
 * 절대 안 나온다. 그 둘은 `when` 이 항상 거짓인 강제 엔딩이라(`data/endings.ts`),
 * 시스템이 발행해 놓아도 재계산은 못 고른다 — 실측: E-16 으로 끝낸 판이 화면에는
 * E-06 다음 열차로 떴다. 발행된 id 가 있으면 그것을 쓴다.
 */
const shown = (s: GameState): EndingDef =>
  (s.endingId ? ENDINGS.find((e) => e.id === s.endingId) : undefined) ?? resolveEnding(s)

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
   * 타이틀 — 매달린 안내판 한 장. **가로 3단 사인 구조**다.
   *
   *   1단  로고 | 행선 정보
   *   2단  목표 — "180초 안에 신도림 방면 지하철에 탑승하세요."
   *   3단  입력 — ENTER 게임 시작 | ESC 설정
   *
   * 2단이 이번에 새로 들어갔다. 처음 오는 사람은 앞선 판을 보고 **무엇을 해야
   * 하는 게임인지 알 수 없었다** — 로고와 열차 시각만으로는 규칙이 안 나온다.
   * 광고 문구가 아니라 규칙 한 줄이다.
   *
   * `PRESS ENTER` 는 흰 LED 로 두되 문구를 `ENTER 게임 시작` 으로 바꿔 **동작**을
   * 적는다. 두 번째 판부터는 `출근 시작` 이 된다 — 규칙을 이미 아는 사람에게
   * 같은 안내를 반복하지 않는다.
   */
  const title = (): string => {
    const save = loadSave()
    const first = save.plays === 0
    /**
     * 도감 진행도. 한동안 화면에서 숨겨 뒀다가 다시 노출한다 —
     * 기록은 그동안에도 계속 쌓이고 있었으므로(`recordEnding`) 켜기만 하면 된다.
     */
    const got = Object.keys(save.endings).length
    return `
    <div class="board title">
      <div class="brackets"><i></i><i></i></div>
      <div class="face">
        <div class="row s1">
          <div class="logo">
            <span class="train" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
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
        <div class="goal s2">
          <b>180초 안에 신도림 방면 지하철에 탑승하세요.</b>
          <span>뛰는 것만으로는 안 될 수 있습니다.</span>
        </div>
        <div class="keys s3">
          <span class="go"><b>ENTER</b> ${first ? '게임 시작' : '출근 시작'}</span>
          <span><b>C</b> 도감 ${got} / ${ENDINGS.length}</span>
          <span><b>ESC</b> 설정</span>
        </div>
      </div>
    </div>`
  }

  /**
   * 엔딩 — 같은 판, 다른 내용. **사실 → 수치 → 속마음** 순으로 쌓는다.
   *
   *   1단  제목
   *   2단  무슨 일이 있었는가 (한 줄 사실)
   *   3단  상태 + 관련 값 최대 2개
   *   4단  속마음 한 줄
   *   5단  입력
   *
   * 상태는 `상태 실패` 처럼 **글자로** 적는다. 색만 바꾸면 색각 이상이나
   * 저대비 환경에서 성공과 실패가 같은 화면이 된다.
   */
  const ending = (s: GameState): string => {
    const e = shown(s)
    el.className = `on ${e.tone}`
    const facts = factsFor(e, s)

    return `
      <div class="board result">
        <div class="brackets"><i></i><i></i></div>
        <div class="face">
          <div class="head s1">
            <span><span class="line2">2</span>2호선 신도림 방면</span>
            <span class="eid">${e.id}</span>
          </div>
          <div class="title-row s2">
            <div class="name">${e.tone === 'hidden' ? '★ ' : ''}${e.title}</div>
            <div class="status">[ ${STATUS[e.tone]} ]</div>
          </div>
          <div class="what s3">${WHAT_HAPPENED[e.id]}</div>
          ${facts.length === 0 ? '' : `<div class="facts s4">${facts.map((f) => `
            <dl${f.wide ? ' class="wide"' : ''}>
              ${f.label ? `<dt>${f.label}</dt>` : ''}<dd>${f.value}</dd>
            </dl>`).join('')}</div>`}
          <div class="say s5">${e.line}</div>
          <div class="keys s6">
            <span><b>R</b> 다시하기</span>
          <span><b>C</b> 도감</span>
            <span><b>ESC</b> 설정</span>
          </div>
        </div>
      </div>`
  }

  /**
   * `ENTER` 직후의 짧은 전환.
   *
   * ★ **게임을 붙잡지 않는다.** 시뮬은 이미 `playing` 으로 넘어가 돌고 있고,
   *   이건 그 위에 0.5초 떴다 사라지는 표시일 뿐이다. 전환을 위해 조작을
   *   막으면 3분짜리 게임에서 그 0.5초가 그대로 손해가 된다.
   *   `pointer-events:none` 이라 클릭도 통과한다.
   */
  const flash = (): void => {
    const f = document.createElement('div')
    f.className = 'flash'
    f.textContent = '열차 진입 중'
    mount.appendChild(f)
    window.setTimeout(() => f.remove(), 620)
  }

  let prevPhase: GameState['phase'] | '' = ''

  return {
    hideLoading() { loading.style.display = 'none' },
    setLoading(text: string) { loading.textContent = text },
    sync(s) {
      // 엔딩 화면이 읽는 값이 바뀌면 다시 그린다. 안 넣으면 첫 렌더 시점 값이 굳는다.
      const key = `${s.phase}:${s.endingId ?? ''}:${s.seed}:${s.boarded}:` +
        `${s.timeLeftMs}:${s.tally.coinsEarned},${s.tally.pushes}`
      if (key === lastKey) return
      lastKey = key
      if (prevPhase === 'title' && s.phase === 'playing') flash()
      prevPhase = s.phase
      /**
       * 게임이 끝났다는 것을 **배경으로** 말한다.
       *
       * 결과만 띄우면 뒤의 3D 가 선명해서 아직 플레이 중인 것처럼 보인다.
       * 캔버스에 blur·감채·감광을 걸면 배경은 분위기만 남고 정보 전달을 그만둔다.
       *
       * ★ 캔버스 **한 장에만** 건다. `backdrop-filter` 로 오버레이를 깔면 판 뒤를
       *   매 프레임 다시 흐려야 하고, WebGL 포스트프로세싱은 셰이더 패스가 는다.
       *   `filter` 는 이미 합성된 결과를 한 번 처리하는 것이라 가장 싸다.
       * ★ **타이틀에는 안 건다** — 시작 화면의 배경은 살아 있어야 한다.
       */
      /**
       * 상태별로 **다른 값**을 쓴다. 하나의 공통 blur 로 돌려쓰면 타이틀은
       * 세계를 지워 버리고 결과는 어디서 끝났는지 못 알아보게 된다.
       *   title  거의 선명 — 처음 보는 세계다
       *   play   손대지 않는다
       *   ended  약한 blur + dim — 공간감은 남기고 정보 전달만 끊는다
       */
      document.body.classList.toggle('at-title', s.phase === 'title')
      document.body.classList.toggle('run-ended', s.phase === 'ended')
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
