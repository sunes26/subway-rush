/**
 * HUD — LED 전광판 · 타이머 · 잔액 · 스태미너 · 피드백.
 *
 * DOM으로 그린다. 60fps 루프에 리액트 리컨실리에이션을 끼울 이유가 없다.
 * 갱신은 "값이 바뀐 노드만" 건드린다.
 */

import { formatClock } from '../core/math'
import { FARE, TIMER_STAGES } from '../data/tuning'
import { ledText } from '../systems/gates'
import { lightIsGreen, lightRemainSec } from '../systems/tick'
import { CROSSWALK, FLOOR, ZONE_NAMES } from '../data/world'
import type { GameState } from '../state/types'

const CSS = `
#hud{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:space-between;
  font-family:var(--sans);user-select:none}
#hud .bar{display:flex;align-items:center;gap:16px;padding:10px 18px;
  background:linear-gradient(180deg,rgba(6,6,8,.92),rgba(6,6,8,.55));
  border-bottom:1px solid rgba(255,255,255,.08);backdrop-filter:blur(6px)}
#hud .marquee{flex:1;overflow:hidden;white-space:nowrap;font-family:var(--mono);
  font-size:13px;letter-spacing:.06em;color:#FFB020;text-shadow:0 0 12px rgba(255,176,32,.45)}
#hud .marquee span{display:inline-block;padding-left:100%;animation:sc 22s linear infinite}
@keyframes sc{to{transform:translateX(-100%)}}
#hud .clock{font-family:var(--mono);font-size:34px;font-weight:700;letter-spacing:.04em;
  font-variant-numeric:tabular-nums;line-height:1;transition:color .25s}
#hud .clock small{font-size:11px;letter-spacing:.24em;display:block;opacity:.5;font-weight:400;margin-bottom:3px}
#hud .clock.warn{color:var(--warn)}
#hud .clock.hot{color:var(--hot)}
#hud .clock.crit{color:var(--crit);animation:beat .5s ease-in-out infinite}
@keyframes beat{0%,100%{transform:scale(1)}45%{transform:scale(1.07)}}

#hud .foot{display:flex;align-items:stretch;gap:1px;padding:0;
  background:rgba(255,255,255,.07);border-top:1px solid rgba(255,255,255,.08)}
#hud .cell{flex:1;background:rgba(6,6,8,.88);padding:9px 16px;display:flex;
  flex-direction:column;gap:5px;backdrop-filter:blur(6px)}
#hud .k{font-family:var(--mono);font-size:9px;letter-spacing:.24em;opacity:.45;text-transform:uppercase}
#hud .v{font-size:17px;font-weight:650;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
#hud .v.low{color:var(--crit);animation:jit .28s linear infinite}
@keyframes jit{0%,100%{transform:translateX(0)}25%{transform:translateX(-.7px)}75%{transform:translateX(.7px)}}
#hud .stam{height:7px;border-radius:4px;background:rgba(255,255,255,.12);overflow:hidden;margin-top:5px}
#hud .stam i{display:block;height:100%;background:linear-gradient(90deg,#00A84D,#7FE0A0);
  transition:width .09s linear}
#hud .stam.locked i{background:linear-gradient(90deg,#E5484D,#FF8A3D)}

/* 좌표 표시 — 상단 바 **아래** 왼쪽. 바 안에 넣으면 LED 전광판을 밀어낸다.
   F3 디버그 오버레이(#dbg)는 top:64px 를 쓰므로 그 위에 겹치지 않게 top:56px 로 둔다. */
#coord{position:absolute;top:56px;left:14px;font-family:var(--mono);font-size:11px;
  letter-spacing:.06em;color:rgba(230,235,232,.72);background:rgba(6,6,8,.55);
  padding:4px 9px;border-radius:5px;border:1px solid rgba(255,255,255,.09);
  pointer-events:none;font-variant-numeric:tabular-nums;white-space:pre}
#coord b{color:#7FE0A0;font-weight:600}

#fx{position:absolute;left:50%;top:33%;transform:translateX(-50%);display:flex;
  flex-direction:column;align-items:center;gap:7px;pointer-events:none}
#fx div{font-family:var(--mono);font-size:19px;font-weight:700;letter-spacing:.02em;
  padding:5px 13px;border-radius:5px;background:rgba(8,8,10,.82);
  animation:pop .34s cubic-bezier(.2,1.5,.4,1) both}
#fx .timePenalty{color:var(--crit);border:1px solid rgba(229,72,77,.4)}
#fx .balance{color:var(--gold);border:1px solid rgba(255,200,61,.35)}
#fx .toast{color:var(--line2);border:1px solid rgba(0,168,77,.35);font-size:15px}
@keyframes pop{from{opacity:0;transform:translateY(11px) scale(.9)}to{opacity:1;transform:none}}

#vig{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .4s;
  background:radial-gradient(ellipse at center,transparent 42%,rgba(140,10,14,.62) 100%)}
#shake{position:absolute;inset:0;pointer-events:none}

/* 1인칭 조준점 — 상호작용 대상이 화면 어디를 기준으로 판정되는지 알려준다 */
#cross{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
  width:16px;height:16px;display:none;pointer-events:none;opacity:.75}
#cross.on{display:block}
#cross i{position:absolute;background:rgba(245,245,240,.9);
  box-shadow:0 0 3px rgba(0,0,0,.6)}
#cross i:nth-child(1){left:7px;top:0;width:2px;height:5px}
#cross i:nth-child(2){left:7px;bottom:0;width:2px;height:5px}
#cross i:nth-child(3){top:7px;left:0;height:2px;width:5px}
#cross i:nth-child(4){top:7px;right:0;height:2px;width:5px}

/* 횡단보도 신호 — 적신호 차단벽은 **보이지 않는다.**
   신호등 폴은 횡단보도 남쪽 끝(y 22.6)에 하나뿐이라 북쪽으로 건너는 플레이어의
   시야 밖이다. 그래서 "간헐적으로 앞이 막힌다"가 원인 불명의 버그로 읽혔다.
   막는 주체와 남은 시간을 화면에 띄워 **기다리면 열린다**는 것을 알린다. */
#sig{position:absolute;left:50%;top:63%;transform:translateX(-50%);
  font-family:var(--mono);font-size:13px;letter-spacing:.1em;display:none;
  padding:7px 15px;border-radius:5px;background:rgba(8,8,10,.78);
  pointer-events:none;font-variant-numeric:tabular-nums;white-space:pre}
#sig.on{display:block;animation:pop .3s ease both}
#sig.stop{color:var(--crit);border:1px solid rgba(229,72,77,.45)}
#sig.go{color:var(--line2);border:1px solid rgba(0,168,77,.45)}

/* 포인터 락 안내 — 잠기기 전에는 시선이 안 움직인다는 걸 알려야 한다 */
#lockhint{position:absolute;left:50%;top:72%;transform:translateX(-50%);
  font-family:var(--mono);font-size:12px;letter-spacing:.18em;color:#F5F5F0;
  background:rgba(8,8,10,.72);padding:9px 16px;border-radius:5px;display:none;
  border:1px solid rgba(255,255,255,.16);pointer-events:none}
#lockhint.on{display:block;animation:pop .3s ease both}
`

/**
 * 신호 표시를 띄우는 범위.
 *
 * 차단벽은 횡단보도 서쪽 연석(x −31.3)에만 서므로 서쪽 접근로가 본체다.
 * 건너는 **도중**에도 남은 시간을 봐야 하니 횡단보도 끝(xMax)까지 이어 둔다.
 * 6.5 m 는 걷기 속도(5 m/s)로 1.3초 — 벽에 닿기 전에 읽을 시간이 나온다.
 */
const SIGNAL_BAND = {
  xMin: CROSSWALK.xMin - 6.5, xMax: CROSSWALK.xMax,
  yMin: CROSSWALK.yMin - 1.0, yMax: CROSSWALK.yMax + 1.0,
} as const

const nearCrossing = (x: number, y: number, z: number): boolean =>
  Math.abs(z - FLOOR.L0) < 1.2 &&
  x > SIGNAL_BAND.xMin && x < SIGNAL_BAND.xMax &&
  y > SIGNAL_BAND.yMin && y < SIGNAL_BAND.yMax

const stage = (ms: number): '' | 'warn' | 'hot' | 'crit' =>
  ms > TIMER_STAGES.calm ? '' : ms > TIMER_STAGES.warn ? 'warn' : ms > TIMER_STAGES.hot ? 'hot' : 'crit'

export type Hud = Readonly<{
  sync(s: GameState, pointerLocked: boolean): void
  setCrosshair(on: boolean): void
  el: HTMLElement
}>

export const createHud = (mount: HTMLElement): Hud => {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)

  const el = document.createElement('div')
  el.id = 'hud'
  el.innerHTML = `
    <div class="bar">
      <div class="marquee"><span id="hud-led"></span></div>
      <div class="clock" id="hud-clock"><small>열차 도착</small><b id="hud-time">3:00</b></div>
    </div>
    <div id="coord">—</div>
    <div id="fx"></div>
    <div id="vig"></div>
    <div id="cross"><i></i><i></i><i></i><i></i></div>
    <div id="sig"></div>
    <div id="lockhint">화면을 클릭하면 시점이 잠깁니다 · ESC 해제</div>
    <div class="foot">
      <div class="cell"><div class="k">Zone</div><div class="v" id="hud-zone">—</div></div>
      <div class="cell"><div class="k">교통카드 잔액</div><div class="v" id="hud-bal">—</div></div>
      <div class="cell"><div class="k">스태미너 · Shift</div>
        <div class="stam" id="hud-stam"><i id="hud-stam-i" style="width:100%"></i></div></div>
    </div>`
  mount.appendChild(el)

  const $ = <T extends HTMLElement>(id: string): T => el.querySelector<T>(`#${id}`) as T
  const led = $('hud-led')
  const clock = $('hud-clock')
  const time = $('hud-time')
  const zoneEl = $('hud-zone')
  const balEl = $('hud-bal')
  const stamBox = $('hud-stam')
  const stamFill = $('hud-stam-i')
  const coordEl = $('coord')
  const fxBox = $('fx')
  const vig = $('vig')
  const cross = $('cross')
  const sig = $('sig')
  const lockHint = $('lockhint')
  let firstPerson = true

  let lastLed = ''
  let lastTime = ''
  let lastStage = 'x'
  let lastZone = ''
  let lastBal = -1
  let lastLow = false
  let lastLocked = false
  let lastCoord = ''
  let lastSig = ''
  const shown = new Map<number, HTMLElement>()

  return {
    el,
    setCrosshair(on) { firstPerson = on; cross.className = on ? 'on' : '' },
    sync(s, pointerLocked) {
      lockHint.className =
        firstPerson && !pointerLocked && (s.phase === 'playing' || s.phase === 'boarding') ? 'on' : ''
      cross.className = firstPerson && pointerLocked ? 'on' : ''
      const ledMsg = ledText(s)
      if (ledMsg !== lastLed) { led.textContent = ledMsg; lastLed = ledMsg }

      // 자유 탐색이면 시계가 안 줄어든다. 표시가 없으면 **버그로 오해한다.**
      const t = s.freeplay ? '∞' : formatClock(s.timeLeftMs)
      if (t !== lastTime) { time.textContent = t; lastTime = t }
      const st = s.freeplay ? '' : stage(s.timeLeftMs)
      if (st !== lastStage) { clock.className = `clock ${st}`; lastStage = st }

      // 좌표는 매 프레임 바뀌므로 **소수 한 자리로 끊어** 문자열이 같으면 DOM 을 안 건드린다.
      // 안 그러면 60 fps 로 textContent 를 쓰게 된다.
      const p = s.player.pos
      const co = `<b>x</b> ${p.x.toFixed(1)}  <b>y</b> ${p.y.toFixed(1)}  <b>z</b> ${p.z.toFixed(1)}`
      if (co !== lastCoord) { coordEl.innerHTML = co; lastCoord = co }

      // 횡단보도 신호 — 보이지 않는 차단벽의 정체를 밝힌다. 위 `#sig` 주석 참조.
      // 남은 시간은 올림해서 "0초"가 화면에 뜨는 구간을 없앤다.
      const green = lightIsGreen(s)
      const sigMsg = nearCrossing(p.x, p.y, p.z) && s.phase === 'playing'
        ? `${green ? '보행 신호' : '정지 · 적신호'}  ${Math.ceil(lightRemainSec(s))}초`
        : ''
      if (sigMsg !== lastSig) {
        sig.textContent = sigMsg
        sig.className = sigMsg ? `on ${green ? 'go' : 'stop'}` : ''
        lastSig = sigMsg
      }

      const zn = `${s.zone} · ${ZONE_NAMES[s.zone]}`
      if (zn !== lastZone) { zoneEl.textContent = zn; lastZone = zn }

      if (s.cardBalance !== lastBal) {
        balEl.textContent = `${s.cardBalance.toLocaleString('ko-KR')}원`
        lastBal = s.cardBalance
      }
      // GDD §7.2 — 잔액이 요금 미만이면 적색 + 미세 진동. 개찰구 도착 **전에** 알린다
      const low = s.cardBalance < FARE && !s.gates.passed
      if (low !== lastLow) { balEl.className = low ? 'v low' : 'v'; lastLow = low }

      stamFill.style.width = `${s.player.stamina}%`
      if (s.player.sprintLocked !== lastLocked) {
        stamBox.className = s.player.sprintLocked ? 'stam locked' : 'stam'
        lastLocked = s.player.sprintLocked
      }

      vig.style.opacity = s.timeLeftMs <= TIMER_STAGES.hot && s.phase === 'playing' ? '1' : '0'

      // 피드백 — 새 항목만 추가, 만료된 것만 제거
      const live = new Set(s.fx.map((f) => f.id))
      for (const [id, node] of shown) {
        if (!live.has(id)) { node.remove(); shown.delete(id) }
      }
      for (const f of s.fx) {
        if (shown.has(f.id) || f.kind === 'shake' || !f.text) continue
        const d = document.createElement('div')
        d.className = f.kind
        d.textContent = f.text
        fxBox.appendChild(d)
        shown.set(f.id, d)
      }
    },
  }
}
