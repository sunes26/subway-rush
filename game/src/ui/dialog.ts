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
import { grandpaBranches } from '../systems/interact'
import type { GameState } from '../state/types'

const CSS = `
/* 프롬프트 — 크로스헤어 **아래**. 위에 두면 조준점을 가린다 */
#iprompt{position:absolute;left:50%;top:calc(50% + 34px);transform:translateX(-50%);
  font-family:var(--sans);font-size:13px;letter-spacing:.02em;color:#F5F5F0;display:none;
  align-items:center;gap:8px;padding:6px 12px;border-radius:6px;
  background:rgba(8,8,10,.62);border:1px solid rgba(255,200,61,.34);
  pointer-events:none;white-space:nowrap;backdrop-filter:blur(4px)}
#iprompt.on{display:flex}
#iprompt kbd{font-family:var(--mono);font-size:11px;font-weight:700;color:#0b0b0a;
  background:var(--gold);border-radius:3px;padding:2px 6px;line-height:1}
#iprompt.near{opacity:.72;border-color:rgba(255,200,61,.18)}

/* 진행링 — 습득 0.8s · 대화 15s 를 같은 표면에서 보여준다.
   conic-gradient 한 줄로 끝난다. 캔버스를 또 쓸 이유가 없다 */
#iring{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
  width:52px;height:52px;border-radius:50%;display:none;pointer-events:none;
  background:conic-gradient(var(--gold) 0turn, rgba(255,255,255,.14) 0turn);
  mask:radial-gradient(circle, transparent 19px, #000 20px);
  -webkit-mask:radial-gradient(circle, transparent 19px, #000 20px)}
#iring.on{display:block}
#iring b{position:absolute;left:50%;top:calc(100% + 6px);transform:translateX(-50%);
  font-family:var(--mono);font-size:11px;color:var(--gold);white-space:nowrap;
  -webkit-mask:none;mask:none}

/* 사유 — GDD §5.1 "아웃라인 1회 깜빡임 + 사유 텍스트" 중 텍스트 쪽 */
#ireason{position:absolute;left:50%;top:calc(50% + 66px);transform:translateX(-50%);
  font-family:var(--sans);font-size:14px;font-weight:600;color:#FFD98A;display:none;
  padding:6px 13px;border-radius:6px;background:rgba(8,8,10,.78);
  border:1px solid rgba(255,200,61,.3);pointer-events:none;white-space:nowrap}
#ireason.on{display:block;animation:rpop .26s cubic-bezier(.2,1.5,.4,1) both}
@keyframes rpop{from{opacity:0;transform:translateX(-50%) translateY(6px)}
  to{opacity:1;transform:translateX(-50%)}}

/* 대화 선택 — 3분기. 회색 항목도 **왜** 회색인지 한 줄로 말한다 */
#dlg{position:absolute;left:50%;bottom:120px;transform:translateX(-50%);width:min(520px,88vw);
  display:none;flex-direction:column;gap:6px;font-family:var(--sans);
  background:rgba(8,8,10,.9);border:1px solid rgba(255,255,255,.14);border-radius:9px;
  padding:14px 16px;backdrop-filter:blur(8px)}
#dlg.on{display:flex;animation:rpop .22s ease both}
#dlg .who{font-family:var(--mono);font-size:11px;letter-spacing:.2em;opacity:.5;
  text-transform:uppercase;margin-bottom:3px}
#dlg .op{display:flex;align-items:baseline;gap:10px;padding:7px 9px;border-radius:6px;
  background:rgba(255,255,255,.05);font-size:14px}
#dlg .op kbd{font-family:var(--mono);font-size:11px;font-weight:700;color:#0b0b0a;
  background:#F5F5F0;border-radius:3px;padding:2px 6px}
#dlg .op .note{margin-left:auto;font-family:var(--mono);font-size:11px;opacity:.62}
#dlg .op.off{opacity:.38}
#dlg .op.off kbd{background:rgba(245,245,240,.35)}
#dlg .esc{font-family:var(--mono);font-size:10px;letter-spacing:.16em;opacity:.4;
  margin-top:4px;text-align:right}

/* QTE — 리듬창을 **눈으로 볼 수 있어야** 실력이 성립한다.
   창이 안 보이면 판정은 그냥 운으로 읽힌다 */
#qte{position:absolute;left:50%;bottom:150px;transform:translateX(-50%);width:min(430px,86vw);
  display:none;flex-direction:column;gap:9px;font-family:var(--sans);
  background:rgba(8,8,10,.9);border:1px solid rgba(255,200,61,.3);border-radius:9px;
  padding:13px 16px;backdrop-filter:blur(8px)}
#qte.on{display:flex;animation:rpop .22s ease both}
#qte .cap{font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--gold)}
#qte .track{position:relative;height:11px;border-radius:6px;background:rgba(255,255,255,.1);
  overflow:hidden}
/* 판정창 — 트랙 중앙 고정. 마커가 여기 들어왔을 때 임계를 넘겨야 한다 */
#qte .win{position:absolute;top:0;bottom:0;left:50%;transform:translateX(-50%);
  background:rgba(0,168,77,.42);border-left:1px solid rgba(0,168,77,.8);
  border-right:1px solid rgba(0,168,77,.8)}
#qte .mark{position:absolute;top:-3px;width:3px;height:17px;border-radius:2px;
  background:var(--gold);box-shadow:0 0 8px rgba(255,200,61,.8)}
#qte .fill{position:absolute;left:0;top:0;bottom:0;background:rgba(255,200,61,.28)}
#qte .row{display:flex;align-items:center;gap:12px;font-size:12px}
#qte .dots{display:flex;gap:5px}
#qte .dots i{width:9px;height:9px;border-radius:50%;background:rgba(255,255,255,.16)}
#qte .dots i.hit{background:var(--line2);box-shadow:0 0 7px rgba(0,168,77,.7)}
#qte .miss{margin-left:auto;font-family:var(--mono);font-size:11px;color:var(--crit);opacity:.85}
#qte .dir{font-family:var(--mono);font-size:16px;color:var(--gold);letter-spacing:.1em}
`

export type Dialog = Readonly<{ sync(s: GameState): void; el: HTMLElement }>

/** 진행 중 상호작용의 표시 문안 */
const busyLabel = (s: GameState): string => {
  switch (s.act.busyKind) {
    case 'pickup': return '줍는 중'
    case 'buy': return '사는 중'
    case 'give': return '드리는 중'
    case 'story': return '이야기 듣는 중'
    case 'aside': return '"저기요…"'
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
    <div id="dlg"><div class="who" id="dlg-who">할아버지</div><div id="dlg-ops"></div>
      <div class="esc">ESC 그냥 지나간다</div></div>
    <div id="qte">
      <div class="cap">자판기 밑을 긁는다 — 마우스를 좌우로</div>
      <div class="track"><div class="fill" id="qte-fill"></div>
        <div class="win" id="qte-win"></div><div class="mark" id="qte-mark"></div></div>
      <div class="row"><span class="dir" id="qte-dir">↔</span>
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
  qWin.style.width = `${(QTE.windowMs / QTE.beatMs) * 100}%`

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
          dlgOps.innerHTML = grandpaBranches(s)
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
        // 마커는 박자가 남았을 때 오른쪽에서 출발해 중앙(판정창)을 지나간다
        const pos = 1 - Math.max(-1, Math.min(1, s.qte.beatMs / QTE.beatMs)) * 0.5 - 0.5
        qMark.style.left = `${(Math.max(0, Math.min(1, pos)) * 100).toFixed(1)}%`
        qFill.style.width = `${Math.min(100, (s.qte.travel / QTE.strokeTravel) * 100).toFixed(1)}%`
        qDir.textContent = s.qte.dir === 0 ? '↔' : s.qte.dir > 0 ? '→' : '←'
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
