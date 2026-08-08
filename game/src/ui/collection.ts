/**
 * UI-12 · SCN-08 — 엔딩 도감 16칸 (`docs/P2-SPEC.md` §6.2).
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

/**
 * 미해금 힌트 — GDD §9.4 의 `"???" — 급할수록 돌아가라던 말, 진짜였을까` 형식.
 * 전부 **행동**을 가리키고 **조건**은 안 가리킨다.
 */
/**
 * 미해금 칸은 **아무것도 알려 주지 않는다.**
 *
 * 예전엔 칸마다 행동 힌트를 달았다("자판기는 세 대다", "역에는 화장실도 있다").
 * 조건을 그대로 적는 것보다는 낫지만, 그것도 결국 **다음 판의 정답**이다.
 * 이 게임의 재미는 *실패 → 스스로 해석 → 다시 플레이 → 새 결과* 에 있고,
 * 도감이 그 과정을 대신하면 수집이 아니라 심부름이 된다.
 *
 * 남기는 것은 번호뿐이다 — "아직 못 본 게 있다"는 사실만으로 충분하다.
 */

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
        </li>`
      }
      const best = rec.bestMs > 0 ? `최고 잔여 ${formatClock(rec.bestMs)}` : '열차는 놓쳤다'
      return `<li class="cell got ${e.tone}">
        <b>${TONE_MARK[e.tone]} ${e.title}</b>
        <i>${e.id}</i>
        <em>“${e.lines[0]}”</em>
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
