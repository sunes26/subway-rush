/**
 * 타이틀 · 로딩 · 엔딩 화면.
 *
 * ★ **두 화면 다 실물 여객 안내 설비다.** 게임 메뉴가 아니다.
 *   · 타이틀 — 천장에 매달린 **행선안내 전광판** 한 장. 화면의 UI 오브젝트는 그것뿐이다.
 *   · 엔딩   — 같은 설비의 **결과 표시**. 판정 램프 색만 톤별로 갈린다.
 *   게임 중 HUD 상단 바가 이미 앰버 LED 언어(`css/hud.css`)라 세 화면이 한 계통이 된다.
 *
 * 예전 판이 "어느 게임에 붙여도 되는 껍데기"였던 원인은 전부 걷어냈다 —
 * 가운데 정렬 반투명 카드 · 배경 블러 · 방사형 비네팅 · 깜빡이는 앰버 CTA ·
 * 균등 간격 키캡 칩. 남은 깜빡임은 **엔딩의 NEW 배지 하나**뿐이고, 그건 실물
 * 전광판이 원래 깜빡이므로 장식이 아니라 고증이다.
 */

import { formatClock } from '../core/math'
import { pickHint, pickLine, resolveEnding } from '../data/endings'
import { loadSave } from '../core/save'
import type { GameState } from '../state/types'
// 스타일은 `css/screens.css` 가 단일 원천이다 — UI 킷(/uikit.html)이 같은 파일을 읽는다.
import CSS from './css/screens.css?inline'

/** 엔딩 화면이 판정 밖에서 받아야 하는 값 — 지금은 "처음 본 엔딩인가" 하나다. */
export type EndingMeta = Readonly<{ isNew: boolean }>

export type Screens = Readonly<{
  sync(s: GameState): void
  hideLoading(): void
  setLoading(text: string): void
  /**
   * 엔딩 부가 정보. **`main.ts` 가 기록 전에** 넣어 준다 —
   * 화면이 직접 세이브를 읽으면 이미 기록된 뒤라 항상 "이미 본 엔딩"이 된다.
   */
  setEndingMeta(meta: EndingMeta): void
}>

/** 5칸 막대. 채워진 칸이 많을수록 값이 크다 */
const bars = (ratio: number, on = '■', off = '□'): string => {
  const n = Math.max(0, Math.min(5, Math.round(ratio * 5)))
  return on.repeat(n) + off.repeat(5 - n)
}

/**
 * 양심은 **숫자를 안 쓴다** (GDD §7.2). 대신 부호와 점 개수로 낸다 —
 * 부호가 없으면 `●●●` 이 좋은 건지 나쁜 건지 화면만 봐서는 알 수 없다.
 */
const conscience = (c: number): string => {
  const n = Math.min(5, Math.abs(c))
  if (n === 0) return '·'
  return `${c > 0 ? '+' : '−'} ${'●'.repeat(n)}${'○'.repeat(5 - n)}`
}

const TONE_WORD = { success: '성공', fail: '실패', hidden: '특별' } as const

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
  let meta: EndingMeta = { isNew: false }

  /**
   * 타이틀 — 매달린 안내판 한 장.
   *
   * 정보 배치는 실물을 따른다: 왼쪽이 노선 로고, 오른쪽이 이번/다음 열차,
   * 맨 아래가 **흐르는 안내 문구**다. 조작법·플레이 횟수·시드는 전부 그 문구 줄이
   * 받는다 — 카드를 만들지 않으면서 정보를 다 담을 수 있는 자리가 거기뿐이고,
   * 실물이 원래 그렇게 쓴다.
   */
  const title = (s: GameState): string => {
    const save = loadSave()
    // 첫 판에만 조작을 편다. 열두 번째 플레이에 튜토리얼을 다시 읽힐 이유가 없다.
    const notice = save.plays === 0
      ? '이동 W A S D · 달리기 SHIFT · 점프 SPACE · 상호작용 E · 관찰 Q · 아이템 1–0 · 시점 V · 설정 ESC'
      : `플레이 ${save.plays}회 · SEED ${s.seed} · 시점 V · 관찰 Q · 설정 ESC`

    return `
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
              <dl><dt>다음 열차</dt><dd>4분 30초</dd></dl>
            </div>
          </div>
          <div class="cta">▶ PRESS ENTER ◀</div>
        </div>
        <div class="ticker"><span>${notice}</span></div>
      </div>`
  }

  const ending = (s: GameState): string => {
    const e = resolveEnding(s)
    el.className = `on ${e.tone}`

    // 흐르는 안내 — 성공·히든은 대사, 실패는 힌트. 뒤에 "왜 이 엔딩인가"를 붙인다.
    // `reason` 은 데이터에 있는데 예전 화면이 읽지 않아 죽어 있던 값이다.
    const head = e.tone === 'fail' ? (e.hint ?? pickHint(s.seed)) : pickLine(e, s.seed)
    const why = e.reason?.(s)
    const notice = why ? `${head} ▶ ${why}` : head

    // 이번 판 — 성적이 아니다. 혼잡도는 판이 얼마나 붐볐나, 체력은 얼마나 몰아붙였나.
    const crowd = s.elapsedMs > 0 ? s.tally.crowdMs / s.elapsedMs : 0
    const stam = s.tally.staminaMin / 100

    return `
      <div class="board result">
        <div class="brackets"><i></i><i></i></div>
        <div class="face">
          <div class="head">
            <span><span class="line2">2</span>신도림 방면</span>
            <span>${e.id}</span>
          </div>
          <div class="body">
            <div class="name">${e.tone === 'hidden' ? '★ ' : ''}${e.title}</div>
            <div class="verdict">
              <b>${TONE_WORD[e.tone]}</b>
              <small>${s.boarded ? '탑승 완료' : '열차 출발'}</small>
            </div>
            <div class="metrics">
              <div>
                <h4>이번 판</h4>
                <dl><dt>혼잡도</dt><dd>${bars(crowd, '●', '○')}</dd></dl>
                <dl><dt>체력</dt><dd>${bars(stam)}</dd></dl>
              </div>
              <div>
                <h4>내 성적</h4>
                <dl><dt>잔여</dt><dd>${formatClock(Math.max(0, s.timeLeftMs))}</dd></dl>
                <dl><dt>양심</dt><dd>${conscience(s.scores.conscience)}</dd></dl>
                <dl><dt>스타일</dt><dd>${bars(Math.min(1, s.scores.style / 8))}</dd></dl>
                <dl><dt>발견</dt><dd>${s.scores.knowledge} / 12</dd></dl>
              </div>
            </div>
          </div>
        </div>
        <div class="ticker">
          <span>${notice}</span>
          ${meta.isNew ? '<b class="new">NEW</b>' : ''}
        </div>
      </div>
      <div class="keys">R 다시 · ESC 설정</div>`
  }

  return {
    hideLoading() { loading.style.display = 'none' },
    setLoading(text: string) { loading.textContent = text },
    setEndingMeta(m) { meta = m; lastKey = '' },
    sync(s) {
      // 엔딩 화면에 채점 결과를 찍으므로 메모 키에 그 값도 넣는다.
      // 안 넣으면 첫 렌더 시점의 점수가 굳어 버린다 (phase:endingId:seed 만으로는 못 잡는다)
      const key = `${s.phase}:${s.endingId ?? ''}:${s.seed}:${meta.isNew}:` +
        `${s.scores.conscience},${s.scores.style},${s.scores.knowledge},` +
        `${s.tally.crowdMs},${s.tally.staminaMin},${s.boarded}`
      if (key === lastKey) return
      lastKey = key
      if (s.phase === 'title') {
        el.className = 'on'
        el.innerHTML = title(s)
      } else if (s.phase === 'ended') {
        el.innerHTML = ending(s)
      } else {
        el.className = ''
        el.innerHTML = ''
      }
    },
  }
}
