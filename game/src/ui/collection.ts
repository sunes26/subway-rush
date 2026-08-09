/**
 * UI-12 · SCN-08 — 엔딩 도감 18칸.
 *
 * **엔딩이 이 게임의 세일즈 포인트인데 P1까지 카운터가 없었다.** 몇 개를 봤는지
 * 모르면 수집이 성립하지 않는다. 도감은 그 카운터다.
 *
 *
 * ■ 화면 구조 — **목록 + 상세** 두 칸
 *
 * 예전 판은 18칸을 한 판에 늘어놓고 칸마다 제목·대사·횟수·최고기록을 다 적었다.
 * 정보는 다 있었지만 **어느 것도 눈에 안 들어왔다** — 18개 × 4줄이 같은 크기로
 * 깔리면 그건 목록이 아니라 벽이다. 슬롯은 "무엇이 있고 무엇이 없나"만 말하고,
 * 자세한 것은 **고른 하나**에 대해서만 옆에서 말한다.
 *
 *   왼쪽  18칸 그리드 — 상태(잠금/해금/선택)가 한눈에
 *   오른쪽 상세      — 제목 · 설명 · 한마디 · 발견 횟수 · 최고 기록
 *
 *
 * ■ ★ 미해금 칸은 **아무것도 알려 주지 않는다**
 *
 * 예전엔 칸마다 행동 힌트를 달았다("자판기는 세 대다", "역에는 화장실도 있다").
 * 조건을 그대로 적는 것보다는 낫지만, 그것도 결국 **다음 판의 정답**이다.
 * 이 게임의 재미는 *실패 → 스스로 해석 → 다시 플레이 → 새 결과* 에 있고,
 * 도감이 그 과정을 대신하면 수집이 아니라 심부름이 된다.
 *
 * 남기는 것은 **번호와 자물쇠**뿐이다 — "아직 못 본 게 있다"는 사실로 충분하다.
 *
 *
 * ■ 정렬은 **번호순 고정**이다
 *
 * `ENDINGS` 배열은 우선순위 내림차순이라 그대로 그리면 E-05 가 맨 앞에 온다.
 * 도감은 판정표가 아니라 목록이므로 E-01 → E-18 로 고정한다. 순서가 판마다
 * 바뀌면 "몇 번 칸이 비었다"는 기억이 안 쌓인다. id 가 zero-padded 라
 * 문자열 정렬로 번호순이 나온다.
 *
 *
 * ■ 로직은 안 건드린다
 *
 * 판정·조건·ID·해금 구조는 그대로다. 이 파일은 `core/save.ts` 가 이미 쌓아 둔
 * `seen`·`bestMs` 를 읽어서 **그리기만** 한다.
 */

import { formatClock } from '../core/math'
import { ENDINGS, type EndingDef } from '../data/endings'
import { loadSave, seenCount, type EndingRecord, type SaveData } from '../core/save'
import type { EndingId } from '../state/types'
import { shortBadgeOf, badgeOf, WHAT_HAPPENED } from './ending-copy'

export type Collection = Readonly<{
  el: HTMLElement
  open(): void
  close(): void
  toggle(): void
  isOpen(): boolean
  /** 방향키·탭 이동. 열려 있을 때만 의미가 있다 */
  move(delta: number): void
}>

/** 번호순 고정 — 위 헤더 참고 */
const ORDER: readonly EndingDef[] = [...ENDINGS].sort((a, b) => a.id.localeCompare(b.id))

/** 한 줄에 몇 칸인가 — 방향키 상하 이동이 이 값을 쓴다. CSS 의 grid 열 수와 맞춘다 */
const COLS = 3

/** 방향키 → 이동량. 열 수는 CSS 의 `grid-template-columns` 와 같아야 한다 */
const STEP: Readonly<Record<string, number>> = {
  ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLS, ArrowDown: COLS,
}

/**
 * 최고 기록 — **미탑승 엔딩에서는 숫자를 안 쓴다.**
 *
 * `bestMs` 는 탑승 시점의 잔여시간이라 열차를 놓친 엔딩에서는 항상 0 이다.
 * 그걸 그대로 `0:00` 으로 찍으면 "0초 남기고 탔다"로 읽힌다 — 실제로는 못 탄
 * 판이다. 0 은 기록이 아니라 **해당 없음**이므로 그렇게 적는다.
 */
const bestText = (rec: EndingRecord): string =>
  rec.bestMs > 0 ? formatClock(rec.bestMs) : '—'

const bestLabel = (rec: EndingRecord): string =>
  rec.bestMs > 0 ? '최고 기록 (잔여)' : '최고 기록'

const slotHtml = (e: EndingDef, rec: EndingRecord | undefined, sel: boolean): string => {
  const cls = ['slot', rec ? 'got' : 'locked', e.tone, sel ? 'sel' : ''].filter(Boolean).join(' ')
  const attrs = `class="${cls}" data-id="${e.id}" role="option" aria-selected="${sel}"`
  if (!rec) {
    return `<li ${attrs}>
      <span class="code">${e.id}</span>
      <span class="lock" aria-hidden="true"></span>
      <span class="name">???</span>
    </li>`
  }
  return `<li ${attrs}>
    <span class="code">${e.id}</span>
    <span class="badge">${shortBadgeOf(e.tone)}</span>
    <span class="name">${e.title}</span>
    <span class="say">${e.line}</span>
  </li>`
}

/**
 * 상세 — 고른 칸 하나만 말한다.
 *
 * 잠긴 칸을 골라도 **빈 화면을 보여 주지 않는다.** 번호는 알려 주되 내용은
 * 안 알려 주는 것이 이 화면의 규칙이므로, 자리를 지키는 안내만 둔다.
 */
const detailHtml = (e: EndingDef, rec: EndingRecord | undefined): string => {
  if (!rec) {
    return `<div class="detail locked">
      <div class="d-code">${e.id}</div>
      <div class="d-name">???</div>
      <p class="d-what">아직 보지 못한 엔딩입니다.</p>
    </div>`
  }
  return `<div class="detail ${e.tone}">
    <div class="d-top">
      <span class="d-code">${e.id}</span>
      <span class="d-badge">${badgeOf(e.id, e.tone)}</span>
    </div>
    <div class="d-name">${e.title}</div>
    <p class="d-what">${WHAT_HAPPENED[e.id]}</p>
    <p class="d-say">${e.line}</p>
    <dl class="d-stats">
      <div><dt>발견 횟수</dt><dd>${rec.seen}<span>회</span></dd></div>
      <div><dt>${bestLabel(rec)}</dt><dd>${bestText(rec)}</dd></div>
    </dl>
  </div>`
}

const cardHtml = (save: SaveData, selId: EndingId): string => {
  const got = seenCount(save)
  const total = ORDER.length
  const pct = Math.round(got / total * 100)
  const sel = ORDER.find((e) => e.id === selId) ?? ORDER[0]!

  const slots = ORDER
    .map((e) => slotHtml(e, save.endings[e.id], e.id === selId))
    .join('')

  return `
    <div class="cx">
      <header class="cx-head">
        <div class="cx-titles">
          <div class="kicker">COLLECTION</div>
          <h1>엔딩 도감</h1>
        </div>
        <div class="cx-prog">
          <div class="pnum"><b>${got}</b><span>/ ${total} 발견</span></div>
          <div class="pbar"><i style="width:${pct}%"></i></div>
          <div class="pplays">플레이 ${save.plays}회</div>
        </div>
      </header>
      <div class="cx-body">
        <ul class="slots" role="listbox" aria-label="엔딩 목록">${slots}</ul>
        ${detailHtml(sel, save.endings[sel.id])}
      </div>
      <footer class="cx-foot">
        <span><b>↑↓←→</b> 이동</span>
        <span><b>C</b> 또는 <b>ESC</b> 닫기</span>
      </footer>
    </div>`
}

export const createCollection = (mount: HTMLElement): Collection => {
  const el = document.createElement('div')
  el.id = 'collection'
  mount.appendChild(el)

  let open = false
  /** 고른 칸. 닫았다 열어도 유지한다 — 보던 자리로 돌아온다 */
  let selId: EndingId = ORDER[0]!.id

  const render = (): void => { el.innerHTML = cardHtml(loadSave(), selId) }

  /**
   * 칸 클릭 — 위임으로 받는다. 매 렌더마다 18개에 리스너를 다는 대신
   * 컨테이너 하나만 듣는다(다시 그려도 안 끊긴다).
   */
  el.addEventListener('click', (ev) => {
    const li = (ev.target as HTMLElement | null)?.closest('.slot') as HTMLElement | null
    const id = li?.dataset['id'] as EndingId | undefined
    if (!id || id === selId) return
    selId = id
    render()
  })

  const move = (delta: number): void => {
    if (!open) return
    const i = ORDER.findIndex((e) => e.id === selId)
    const n = ORDER.length
    // 끝에서 멈춘다 — 감싸면 위로 누르다 맨 아래로 튀어 어디 있는지 잃는다
    const next = Math.max(0, Math.min(n - 1, (i < 0 ? 0 : i) + delta))
    if (next === i) return
    selId = ORDER[next]!.id
    render()
  }

  /**
   * 방향키 — **여기서 직접 듣는다.** `core/input.ts` 에 플래그를 더하고
   * `main.ts` 에서 분기하는 쪽도 가능하지만, 그러면 도감 하나 때문에 게임 입력
   * 경로가 늘어난다. 이 리스너는 도감이 열려 있을 때만 동작하고, 닫혀 있으면
   * 첫 줄에서 빠져나가므로 플레이 중 이동키와 겹치지 않는다.
   *
   * `preventDefault` 는 화살표로 페이지가 스크롤되는 것을 막는다 — 도감이
   * 세로로 길 때 선택은 안 움직이고 화면만 흐르면 고장으로 보인다.
   */
  const onKey = (ev: KeyboardEvent): void => {
    if (!open) return
    const d = STEP[ev.code]
    if (d === undefined) return
    ev.preventDefault()
    move(d)
  }
  window.addEventListener('keydown', onKey)

  return {
    el,
    isOpen: () => open,
    move,
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
