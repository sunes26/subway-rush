/**
 * 상호작용 오버레이 — 프롬프트 · 진행링 · 사유 · 대화 선택 · QTE 게이지.
 *
 * HUD(`ui/hud.ts`)와 분리한 이유: HUD는 **상시** 표시되는 계기판이고 이쪽은 **순간** 표시되는
 * 상호작용 표면이다. 한 파일에 넣으면 60fps 갱신 대상과 이벤트성 갱신 대상이 섞여
 * "값이 바뀐 노드만 건드린다"는 규칙을 지키기 어려워진다.
 *
 * 판정은 하나도 여기 없다. 전부 `systems/interact.ts`·`systems/qte.ts` 가 정하고
 * 이 파일은 `state.act` / `state.qte` 를 **그리기만** 한다.
 */

import { byId } from '../data/interactables'
import { itemDef } from '../data/items'
import { QTE } from '../data/tuning'
import { branchesFor } from '../systems/interact'
import type { GameState } from '../state/types'
// 스타일은 `css/dialog.css` 가 단일 원천이다 — UI 킷(/uikit.html)이 같은 파일을 읽는다.
// `?inline` 은 파일 내용을 문자열로 준다: 주입 방식(<style> 삽입)은 예전과 같다.
import CSS from './css/dialog.css?inline'

export type Dialog = Readonly<{ sync(s: GameState): void; el: HTMLElement }>

/** 진행 중 상호작용의 표시 문안 */
const busyLabel = (s: GameState): string => {
  switch (s.act.busyKind) {
    case 'pickup': return '줍는 중'
    case 'buy': return '사는 중'
    case 'give': return '드리는 중'
    case 'story': return '이야기 듣는 중'
    case 'aside': return '"저기요…"'
    case 'inspect': return '살펴보는 중'
    default: return ''
  }
}

/** 조준 대상의 라벨 — 드랍은 테이블에 없으므로 아이템 이름으로 만든다 */
const targetLabel = (s: GameState): string => {
  const id = s.act.targetId
  if (!id) return ''
  const it = byId(id)
  if (it) return it.label
  const d = s.drops.find((x) => x.id === id)
  return d ? itemDef(d.item).name : ''
}

export const createDialog = (mount: HTMLElement): Dialog => {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)

  const el = document.createElement('div')
  el.id = 'iact'
  el.innerHTML = `
    <div id="iprompt"><kbd>E</kbd><span id="iprompt-t"></span></div>
    <div id="iring"><b id="iring-t"></b></div>
    <div id="ireason"></div>
    <div id="dlg"><div class="who" id="dlg-who"></div><div id="dlg-ops">
      <div class="esc">ESC 그냥 지나간다</div></div>
    <div id="qte">
      <div class="cap">자판기 밑을 긁는다 — 가운데에서 <b>클릭</b></div>
      <div class="track"><div class="fill" id="qte-fill"></div>
        <div class="win" id="qte-win"></div><div class="mark" id="qte-mark"></div></div>
      <div class="row"><span class="dir" id="qte-dir">→</span>
        <div class="dots"><i id="qte-d0"></i><i id="qte-d1"></i><i id="qte-d2"></i></div>
        <span class="miss" id="qte-miss"></span></div>
    </div>`
  mount.appendChild(el)

  const $ = <T extends HTMLElement>(id: string): T => el.querySelector<T>(`#${id}`) as T
  const prompt = $('iprompt')
  const promptT = $('iprompt-t')
  const ring = $('iring')
  const ringT = $('iring-t')
  const reason = $('ireason')
  const dlg = $('dlg')
  const dlgWho = $('dlg-who')
  const dlgOps = $('dlg-ops')
  const qte = $('qte')
  const qFill = $('qte-fill')
  const qWin = $('qte-win')
  const qMark = $('qte-mark')
  const qDir = $('qte-dir')
  const qMiss = $('qte-miss')
  const dots = [$('qte-d0'), $('qte-d1'), $('qte-d2')]

  let lastPrompt = ''
  let lastPromptCls = ''
  let lastReason = ''
  let lastDlg = ''
  let lastQte = false

  // 판정창 폭은 고정이다 — 한 번만 계산한다
  // 성공 구간 폭은 상수다 — 난이도가 올라도 **구간은 안 좁힌다**(빨라질 뿐)
  qWin.style.width = `${QTE.zoneHalf * 2 * 100}%`

  return {
    el,
    sync(s) {
      const busy = s.act.busyId !== null && s.act.busyKind !== null
      const playing = s.phase === 'playing'

      // ── 프롬프트: 대상이 있고 아무것도 진행 중이 아닐 때만
      const showPrompt = playing && !busy && !s.qte.active && !s.act.dialogId && !!s.act.targetId
      const text = showPrompt ? targetLabel(s) : ''
      const cls = showPrompt ? (s.act.aimed ? 'on' : 'on near') : ''
      if (text !== lastPrompt) { promptT.textContent = text; lastPrompt = text }
      if (cls !== lastPromptCls) { prompt.className = cls; lastPromptCls = cls }

      // ── 진행링: 남은 비율을 conic-gradient 한 값으로
      if (busy && s.act.busyTotalMs > 0) {
        const done = 1 - s.act.busyLeftMs / s.act.busyTotalMs
        ring.style.background =
          `conic-gradient(var(--gold) ${done.toFixed(3)}turn, rgba(255,255,255,.14) ${done.toFixed(3)}turn)`
        // 15초 대화는 남은 초를 같이 보여준다 — 안 보여주면 그냥 멈춘 것처럼 느껴진다
        ringT.textContent = s.act.busyTotalMs >= 3000
          ? `${busyLabel(s)}  ${Math.ceil(s.act.busyLeftMs / 1000)}s`
          : busyLabel(s)
        if (ring.className !== 'on') ring.className = 'on'
      } else if (ring.className !== '') {
        ring.className = ''
      }

      // ── 사유
      const rz = s.act.denyMs > 0 ? s.act.denyText : ''
      if (rz !== lastReason) {
        reason.textContent = rz
        reason.className = rz ? 'on' : ''
        lastReason = rz
      }

      // ── 대화 선택. 분기 데이터는 시스템과 **같은 함수**에서 온다
      const dlgKey = s.act.dialogId ? `${s.act.dialogId}:${s.inventory.join(',')}` : ''
      if (dlgKey !== lastDlg) {
        if (dlgKey) {
          /**
           * 상대 이름을 대화 상대의 `label` 에서 읽는다 — 예전엔 `할아버지`가 마크업에
           * 박혀 있어 편의점 매대(`GIFT_STALL_ID`)가 두 번째 `talk` 대상이 되자
           * 매대에서 연 선택창에도 "할아버지"가 떴다. `byId` 가 `systems/interact.ts`
           * 의 상호작용 테이블과 같은 원천이므로 여기서 갈릴 일이 없다.
           */
          dlgWho.textContent = byId(s.act.dialogId!)?.label ?? ''
          dlgOps.innerHTML = branchesFor(s, s.act.dialogId!)
            .map((b) => `<div class="op${b.enabled ? '' : ' off'}"><kbd>${b.key}</kbd>` +
              `<span>${b.label}</span><span class="note">${b.note}</span></div>`)
            .join('')
        }
        dlg.className = dlgKey ? 'on' : ''
        lastDlg = dlgKey
      }

      // ── QTE
      if (s.qte.active !== lastQte) { qte.className = s.qte.active ? 'on' : ''; lastQte = s.qte.active }
      if (s.qte.active) {
        // 마커 위치는 시뮬이 들고 있다 — 렌더는 그대로 옮겨 그리기만 한다
        qMark.style.left = `${(s.qte.pos * 100).toFixed(1)}%`
        /**
         * 채움은 **남은 제한시간**이다. 예전엔 스트로크 누적량이었는데 그건 점(dots)이
         * 이미 보여 준다 — 화면에 같은 정보를 두 번 그릴 이유가 없다.
         */
        const left = Math.max(0, 1 - s.qte.elapsedMs / QTE.timeoutMs)
        qFill.style.width = `${(left * 100).toFixed(1)}%`
        qDir.textContent = s.qte.dirSign > 0 ? '→' : '←'
        for (let i = 0; i < dots.length; i++) {
          const on = i < s.qte.strokes
          const d = dots[i]
          if (d && (d.className === 'hit') !== on) d.className = on ? 'hit' : ''
        }
        qMiss.textContent = s.qte.misses > 0 ? `실패 ${s.qte.misses}/${QTE.maxMisses}` : ''
      }
    },
  }
}
