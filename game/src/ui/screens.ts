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
import { ENDINGS, endingOf, type EndingDef } from '../data/endings'
import { QUEUE_MARKERS } from '../data/world'
import type { GameState } from '../state/types'
import { badgeOf, TONE_MARK, WHAT_HAPPENED } from './ending-copy'
// 스타일은 `css/screens.css` 가 단일 원천이다 — UI 킷(/uikit.html)이 같은 파일을 읽는다.
import CSS from './css/screens.css?inline'

/**
 * 결과 화면의 버튼이 부를 것들.
 *
 * ★ **화면이 게임을 몰라도 되게 한다.** `screens.ts` 가 `restart()` 를 직접
 *   구현하면 UI 파일이 시뮬 상태를 만지게 된다 — 지금 이 파일은 `GameState` 를
 *   읽기만 한다. 셋 다 `main.ts` 에 이미 있는 함수라 새로 만든 경로가 없다.
 */
export type ScreenActions = Readonly<{
  restart(): void
  collection(): void
  title(): void
}>

export type Screens = Readonly<{
  sync(s: GameState): void
  hideLoading(): void
  setLoading(text: string): void
  /**
   * 엔딩 컷이 도는 동안 결과판을 **미뤄 둔다**(`render/outro.ts`).
   *
   * 시뮬은 이미 `ended` 다 — 컷은 그 위에 얹히는 5초짜리 연출이라 상태를 안 건드린다.
   * 그래서 "아직 보여주지 마라"를 상태가 아니라 여기로 말한다. 새 `Phase` 를 만들면
   * 리듀서·HUD·헤드리스 테스트가 전부 그 값을 알아야 하고, 그건 연출 하나 때문에
   * 시뮬 전체를 건드리는 일이다.
   */
  setHold(on: boolean): void
}>

/**
 * 다음 열차까지. **타이틀과 엔딩이 같은 값을 쓴다** — 한쪽만 고치면 같은 역의
 * 두 안내판이 서로 다른 말을 하게 된다. 시뮬에 없는 값이라 표시 상수로만 둔다
 * (열차 스케줄은 `systems/train.ts` 가 이번 편성 하나만 다룬다).
 */
const NEXT_TRAIN = '20분 26초'

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
 *
 * ── 탑승 계열에 **잔액**이 붙는다 (디렉터 지시) ──
 *
 *   열차를 탄 판에는 남은 시간과 함께 카드 잔액을 적는다. 위 규칙을 깨는 게 아니다:
 *   잔액은 **다음 판의 정답이 아니다.** 얼마를 남기면 뭐가 열린다는 규칙이 없고
 *   (성공 등급은 잔액을 안 본다), 플레이 중 HUD 에 내내 떠 있던 값이라 새 정보도
 *   아니다. 판이 끝난 자리에서 "오늘 하루가 이렇게 남았다"를 말하는 기록일 뿐이다.
 *
 *   ★ **탄 판에만** 붙인다. 못 탄 판·즉사 판에 잔액을 적으면 그건 위로가 되고,
 *     이 화면은 플레이어를 위로하지 않는다(`tests/unit/ending-tone.test.ts`).
 */
const factsFor = (e: EndingDef, s: GameState): readonly Fact[] => {
  const left: Fact = { label: '남은 시간', value: formatClock(Math.max(0, s.timeLeftMs)) }
  const next: Fact = { label: '다음 열차', value: NEXT_TRAIN }
  const bal: Fact = { label: '잔액', value: won(s.cardBalance) }

  switch (e.id) {
    // ── 탄 판 — 시간과 잔액, 이 판이 남긴 두 가지 ──
    case 'E-01': case 'E-02': case 'E-04':
      return [left, bal]
    case 'E-03':
      // 승차위치는 조건이 아니라 **내가 선 자리**다 — 바닥에 적혀 있고 직접 밟았다
      return atFirstQueue(s) ? [{ label: '승차위치', value: '3-1' }, left, bal] : [left, bal]

    /**
     * 반대편에 탄 판도 **같은 기록을 받는다.**
     *
     * 예전엔 아무것도 안 보여 줬다. 원인이 명백한 실패라 수치가 곧 정답이 된다는
     * 이유였는데, 남은 시간과 잔액은 방향과 아무 상관이 없다 — 다음 판에 알려 주는
     * 게 없다. 오히려 **여기에만 기록이 없으면** 탄 판 중 이것만 없던 일이 된다.
     * 잘못 탄 것도 오늘 아침에 실제로 있었던 일이다.
     */
    case 'E-08':
      return [left, bal]

    // ── 열차를 놓친 것들 — 다음 열차는 승강장에 서면 어차피 보인다 ──
    case 'E-06':
      return [next]

    // ── 동전은 주우면서 이미 셌다. 여기선 번 돈이 곧 이 엔딩이라 잔액보다 앞에 온다 ──
    case 'E-14':
      return [{ label: '획득 동전', value: won(s.tally.coinsEarned) }, left]

    /**
     * 나머지는 **아무것도 안 보여 준다.**
     * 부정승차·오답 선물·단소처럼 원인이 명백한 실패에 수치를 얹으면
     * 그 수치가 곧 다음 판의 정답이 된다. 히든 계열은 더더욱 — "내가 뭘 해서
     * 이게 나온 거지" 를 남겨 두는 것이 이 엔딩들의 값이다.
     */
    default:
      return []
  }
}

/**
 * 화면에 띄울 엔딩. 규칙(발행된 id 가 재계산을 이긴다)은 `data/endings.ts endingOf` 에
 * 한 벌만 둔다 — BGM(`main.ts`)이 같은 함수로 곡을 고르므로, 규칙이 갈라지면
 * 결과판과 음악이 서로 다른 엔딩을 말하게 된다.
 */
const shown = (s: GameState): EndingDef => endingOf(s)

export const createScreens = (mount: HTMLElement, actions: ScreenActions): Screens => {
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

  /**
   * 결과 버튼 — **위임으로 받는다.** 판은 매번 다시 그려지므로 버튼마다 리스너를
   * 달면 렌더할 때마다 끊긴다. 컨테이너 하나만 듣는다.
   */
  el.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement | null)?.closest('[data-act]') as HTMLElement | null
    const act = b?.dataset['act']
    if (act === 'restart') actions.restart()
    else if (act === 'collection') actions.collection()
    else if (act === 'title') actions.title()
  })

  /**
   * `T` — 타이틀로. R·C·ESC 는 `core/input.ts` 가 이미 읽고 `main.ts` 가 분기하지만,
   * 타이틀 복귀는 여태 설정 화면 안에만 있었다. 게임 입력 표를 늘리는 대신
   * **결과 화면이 떠 있을 때만** 듣는 리스너를 여기 둔다 — 그 조건은 `el` 의
   * 클래스로 알 수 있으므로 상태를 따로 들고 있을 필요가 없다.
   */
  window.addEventListener('keydown', (ev) => {
    if (ev.code !== 'KeyT') return
    if (!/\b(success|fail|hidden)\b/.test(el.className)) return
    ev.preventDefault()
    actions.title()
  })

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
   * 엔딩 — **배지가 먼저다.**
   *
   *   1단  결과 배지        ← 판이 어떻게 끝났는지. 화면에서 가장 큰 글자
   *   2단  코드 + 제목       ← 무엇이 나왔는지
   *   3단  설명 한 줄        ← 무슨 일이 있었는지 (사실)
   *   4단  한마디 한 줄      ← 속마음
   *   5단  값 (있을 때만)
   *   6단  버튼 3개
   *
   * ■ 왜 배지를 위로 올렸나
   *
   * 예전 판은 제목이 크고 배지가 그 오른쪽에 작은 대괄호로 붙어 있었다. 그런데
   * **처음 보는 사람이 먼저 알아야 하는 것은 제목이 아니라 결과다** — 「다음 열차」
   * 라는 제목만으로는 탄 건지 놓친 건지 모른다. 배지를 맨 위로 올려 크게 두면
   * 그 한 글자 덩어리로 판이 끝난 방식이 즉시 읽힌다.
   *
   * ■ 색만으로 말하지 않는다
   *
   * 배지는 글자다(`SUCCESS`·`GAME OVER`·`SPECIAL`). 색은 거들 뿐이라 색각 이상이나
   * 저대비 환경에서도 셋이 안 뭉갠다. 여기에 톤별 마크(○ ✕ ★)를 하나 더 얹어
   * **모양으로도** 갈라 둔다.
   *
   * ■ 값은 남기되 아래로 내렸다
   *
   * 잔여 시간·잔액은 탄 판에서만 의미가 있고, 결과를 읽는 데 필요한 정보는
   * 아니다. 지우지 않고 마지막 줄로 내려 위계를 낮춘다.
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
          <div class="verdict s2">
            <span class="mark" aria-hidden="true">${TONE_MARK[e.tone]}</span>
            <span class="word">${badgeOf(e.id, e.tone)}</span>
          </div>
          <div class="name s3">${e.title}</div>
          <div class="what s4">${WHAT_HAPPENED[e.id]}</div>
          <div class="say s5">${e.line}</div>
          ${facts.length === 0 ? '' : `<div class="facts s6">${facts.map((f) => `
            <dl${f.wide ? ' class="wide"' : ''}>
              ${f.label ? `<dt>${f.label}</dt>` : ''}<dd>${f.value}</dd>
            </dl>`).join('')}</div>`}
          <div class="acts s7">
            <button type="button" data-act="restart" class="primary"><b>R</b> 다시 하기</button>
            <button type="button" data-act="collection"><b>C</b> 도감 보기</button>
            <button type="button" data-act="title"><b>T</b> 타이틀로</button>
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
  /** 엔딩 컷이 도는 동안 참 — 결과판도 배경 blur 도 그동안은 안 나온다 */
  let hold = false

  return {
    hideLoading() { loading.style.display = 'none' },
    setLoading(text: string) { loading.textContent = text },
    setHold(on) {
      if (hold === on) return
      hold = on
      // 키를 비워 다음 `sync` 가 반드시 다시 그리게 한다 — 상태는 그대로이므로 키만으론 안 바뀐다
      lastKey = ''
    },
    sync(s) {
      // 엔딩 화면이 읽는 값이 바뀌면 다시 그린다. 안 넣으면 첫 렌더 시점 값이 굳는다.
      const key = `${s.phase}:${s.endingId ?? ''}:${s.seed}:${s.boarded}:` +
        // 잔액도 결과판이 읽는 값이다 — 빠뜨리면 첫 렌더 시점 값이 굳는다
        `${s.timeLeftMs}:${s.tally.coinsEarned},${s.tally.pushes},${s.cardBalance}`
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
      /**
       * ★ 컷이 도는 동안(`hold`)에는 **끝난 티를 아예 내지 않는다.**
       *   blur 를 걸면 창밖 일출이 뿌옇게 뭉개지고, 그 순간 컷은 배경이 된다.
       *   컷이 끝나야 세계가 정보 전달을 그만두고 결과판으로 넘어간다.
       */
      const done = s.phase === 'ended' && !hold
      document.body.classList.toggle('at-title', s.phase === 'title')
      document.body.classList.toggle('run-ended', done)
      if (s.phase === 'title') {
        el.className = 'on'
        el.innerHTML = title()
      } else if (done) {
        el.innerHTML = ending(s)
      } else {
        el.className = ''
        el.innerHTML = ''
      }
    },
  }
}
