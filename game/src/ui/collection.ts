/**
 * UI-12 · SCN-08 — 엔딩 도감 14칸 (`docs/P2-SPEC.md` §6.2).
 *
 * **엔딩이 이 게임의 세일즈 포인트인데 P1까지 카운터가 없었다.** 몇 개를 봤는지 모르면
 * 수집이 성립하지 않는다. 도감은 그 카운터다.
 *
 * ★ 미해금 칸에 **조건식을 적지 않는다.** 조건을 그대로 적으면 도감이 체크리스트가 되고,
 *   그건 수집이 아니라 심부름이다. 대신 *"다음에 뭘 해보면 되는지"* 만 한 줄 준다.
 */

import { ENDINGS } from '../data/endings'
import { formatClock } from '../core/math'
import { loadSave, seenCount, type SaveData } from '../core/save'
import type { EndingId } from '../state/types'

/**
 * 미해금 힌트 — GDD §9.4 의 `"???" — 급할수록 돌아가라던 말, 진짜였을까` 형식.
 * 전부 **행동**을 가리키고 **조건**은 안 가리킨다.
 */
const TEASER: Readonly<Record<EndingId, string>> = {
  'E-01': '일단 타 보는 것부터',
  'E-02': '서두르면 시간이 남는다',
  'E-03': '가장 앞줄에서 타면 뭐가 다를까',
  'E-04': '문이 닫히는 그 순간에',
  'E-05': '역을 다 아는 사람은 무엇이 다를까',
  'E-06': '못 타도 세상은 안 무너진다',
  'E-07': '늦은 데다 마음까지 급하면',
  'E-08': '환승 통로 너머에도 승강장이 있다',
  'E-09': '열린 문이 곧 공짜 문은 아니다',
  'E-10': '빠른 길에는 값이 붙는다',
  'E-11': '우산으로 사람을 밀면',
  'E-12': '급할수록 돌아가라던 말, 진짜였을까',
  'E-13': '역에는 화장실도 있다',
  'E-14': '자판기는 세 대다',
  'E-15': '할아버지께 아무거나 드리면 안 된다',
  'E-16': '단소는 몇 대까지 들고 다닐 수 있을까',
}

const TONE_MARK = { success: '○', fail: '✕', hidden: '★' } as const

export type Collection = Readonly<{
  el: HTMLElement
  open(): void
  close(): void
  toggle(): void
  isOpen(): boolean
}>

const cardHtml = (save: SaveData): string => {
  const rows = ENDINGS
    // 표시 순서는 우선순위가 아니라 **번호순**이다 — 도감은 판정표가 아니라 목록이다
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((e) => {
      const rec = save.endings[e.id]
      if (!rec) {
        return `<li class="cell locked">
          <b>???</b>
          <i>${e.id}</i>
          <em>${TEASER[e.id]}</em>
        </li>`
      }
      const best = rec.bestMs > 0 ? `최고 잔여 ${formatClock(rec.bestMs)}` : '열차는 놓쳤다'
      return `<li class="cell got ${e.tone}">
        <b>${TONE_MARK[e.tone]} ${e.title}</b>
        <i>${e.id}</i>
        <em>“${e.line}”</em>
        <u>${rec.seen}회 · ${best}</u>
      </li>`
    })
    .join('')

  return `
    <div class="card wide">
      <div class="kicker">COLLECTION</div>
      <h1>엔딩 도감</h1>
      <div class="sub">${seenCount(save)} / ${ENDINGS.length} · 플레이 ${save.plays}회</div>
      <ul class="grid">${rows}</ul>
      <div class="cta">C 또는 ESC 로 닫기</div>
    </div>`
}

export const createCollection = (mount: HTMLElement): Collection => {
  const el = document.createElement('div')
  el.id = 'collection'
  mount.appendChild(el)

  let open = false

  const render = (): void => { el.innerHTML = cardHtml(loadSave()) }

  return {
    el,
    isOpen: () => open,
    open() {
      // 열 때마다 다시 읽는다 — 방금 끝난 판이 기록됐을 수 있다
      render()
      open = true
      el.className = 'on'
    },
    close() { open = false; el.className = '' },
    toggle() { if (open) this.close(); else this.open() },
  }
}
