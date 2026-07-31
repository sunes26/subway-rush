/** 타이틀 · 로딩 · 엔딩 화면. */

import { formatClock } from '../core/math'
import { pickHint, resolveEnding } from '../data/endings'
import type { GameState } from '../state/types'

const CSS = `
#screen{position:absolute;inset:0;display:none;place-items:center;text-align:center;
  background:radial-gradient(ellipse at 50% 40%,rgba(12,12,16,.86),rgba(4,4,6,.97));
  backdrop-filter:blur(3px);pointer-events:auto;animation:fade .6s ease both}
#screen.on{display:grid}
@keyframes fade{from{opacity:0}to{opacity:1}}
#screen .card{max-width:640px;padding:0 32px}
#screen .kicker{font-family:var(--mono);font-size:10px;letter-spacing:.42em;
  text-transform:uppercase;color:#FFB020;margin-bottom:18px}
#screen h1{font-size:clamp(34px,7vw,64px);line-height:1;margin:0 0 6px;
  font-weight:800;letter-spacing:-.045em}
#screen .sub{font-size:14px;opacity:.6;margin-bottom:30px;letter-spacing:.01em}
#screen .line{font-size:22px;font-weight:600;margin:22px 0 10px;letter-spacing:-.01em}
#screen .hint{font-size:13px;opacity:.66;line-height:1.7;border-top:1px solid rgba(255,255,255,.13);
  padding-top:16px;margin-top:22px}
#screen .stats{display:flex;gap:26px;justify-content:center;margin:22px 0 4px;
  font-family:var(--mono);font-size:12px;opacity:.62;letter-spacing:.06em}
#screen .keys{margin-top:30px;display:flex;gap:9px;justify-content:center;flex-wrap:wrap}
#screen kbd{font-family:var(--mono);font-size:11px;padding:5px 9px;border-radius:5px;
  border:1px solid rgba(255,255,255,.24);background:rgba(255,255,255,.06);letter-spacing:.06em}
#screen .cta{margin-top:26px;font-family:var(--mono);font-size:13px;letter-spacing:.2em;
  color:#FFC83D;animation:blink 1.3s steps(2,start) infinite}
@keyframes blink{50%{opacity:.28}}
#screen.win h1{color:#7FE0A0}
#screen.lose h1{color:#F5F5F0}
#load{position:absolute;inset:0;display:grid;place-items:center;background:#07070A;
  font-family:var(--mono);font-size:11px;letter-spacing:.3em;color:#77766F}
`

export type Screens = Readonly<{
  sync(s: GameState): void
  hideLoading(): void
  setLoading(text: string): void
}>

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

  const title = (s: GameState): string => `
    <div class="card">
      <div class="kicker">2호선 · 홍대입구 · 신도림 방면</div>
      <h1>지하철 러쉬</h1>
      <div class="sub">버스에서 내린 순간부터 문이 닫히기까지 — 180초.</div>
      <div class="keys">
        <kbd>W A S D</kbd><kbd>SHIFT 스프린트</kbd><kbd>SPACE 점프</kbd><kbd>마우스 시점</kbd><kbd>V 시점 전환</kbd>
      </div>
      <div class="hint">개찰구는 여섯 개고, 살아있는 건 그중 하나다.<br>
        표지판이 <b style="color:#00A84D">▲</b> 면 열려 있고 <b style="color:#E5484D">✕</b> 면 고장이다.
        한 화면에 다 안 들어오니 <b>고개를 돌려 봐야 한다.</b><br>
        안 보고 태그하면 8초가 날아간다.</div>
      <div class="stats"><span>SEED ${s.seed}</span></div>
      <div class="cta">ENTER 를 눌러 시작</div>
    </div>`

  const ending = (s: GameState): string => {
    const e = resolveEnding(s)
    const win = e.tone === 'success'
    el.className = `on ${win ? 'win' : 'lose'}`
    const hint = win ? '' : `<div class="hint">${pickHint(s.seed)}</div>`
    return `
      <div class="card">
        <div class="kicker">${e.id}</div>
        <h1>${e.title}</h1>
        <div class="line">“${e.line}”</div>
        ${hint}
        <div class="stats">
          <span>잔여 ${formatClock(Math.max(0, s.timeLeftMs))}</span>
          <span>게이트 시도 ${s.gates.attempts}회</span>
          <span>잔액 ${s.cardBalance.toLocaleString('ko-KR')}원</span>
          <span>SEED ${s.seed}</span>
        </div>
        <div class="cta">R 을 눌러 다시</div>
      </div>`
  }

  return {
    hideLoading() { loading.style.display = 'none' },
    setLoading(text: string) { loading.textContent = text },
    sync(s) {
      const key = `${s.phase}:${s.endingId ?? ''}:${s.seed}`
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
