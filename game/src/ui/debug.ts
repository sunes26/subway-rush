/** F3 디버그 오버레이 — fps · 드로우콜 · 좌표 · 존 · 시드 · 게이트 정답. */

import type { WebGLRenderer } from 'three'
import { GATES } from '../data/world'
import type { GameState } from '../state/types'

const CSS = `
#dbg{position:absolute;top:64px;left:14px;display:none;font-family:var(--mono);font-size:11px;
  line-height:1.65;color:#9FE8B4;background:rgba(4,6,5,.82);padding:10px 13px;border-radius:6px;
  border:1px solid rgba(159,232,180,.2);white-space:pre;pointer-events:none;letter-spacing:.02em}
#dbg.on{display:block}
#dbg b{color:#FFC83D;font-weight:600}
`

export type Debug = Readonly<{
  toggle(): void
  frame(dtMs: number): void
  sync(s: GameState): void
  visible(): boolean
  /** 최근 60프레임 최저 fps */
  minFps(): number
}>

export const createDebug = (mount: HTMLElement, renderer: WebGLRenderer): Debug => {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)
  const el = document.createElement('div')
  el.id = 'dbg'
  mount.appendChild(el)

  let on = false
  const history: number[] = []
  let acc = 0
  let fps = 60

  return {
    visible: () => on,
    toggle() { on = !on; el.className = on ? 'on' : '' },
    frame(dtMs) {
      if (dtMs > 0) {
        history.push(1000 / dtMs)
        if (history.length > 120) history.shift()
      }
      acc += dtMs
      if (acc > 250 && history.length) {
        acc = 0
        fps = history.slice(-15).reduce((a, b) => a + b, 0) / Math.min(15, history.length)
      }
    },
    minFps: () => (history.length ? Math.min(...history.slice(-60)) : 60),
    sync(s) {
      if (!on) return
      const info = renderer.info
      const p = s.player
      const working = GATES.map((g) => (s.gates.workingIds.includes(g.id) ? g.label : '·')).join(' ')
      el.innerHTML =
        `<b>FPS</b> ${fps.toFixed(0)}  min ${(history.length ? Math.min(...history.slice(-60)) : 60).toFixed(0)}\n` +
        `<b>draw</b> ${info.render.calls}  <b>tri</b> ${(info.render.triangles / 1000).toFixed(0)}k  ` +
        `<b>tex</b> ${info.memory.textures}\n` +
        `<b>phase</b> ${s.phase}  <b>zone</b> ${s.zone}\n` +
        `<b>pos</b> ${p.pos.x.toFixed(1)}, ${p.pos.y.toFixed(1)}, ${p.pos.z.toFixed(1)}  ` +
        `<b>ramp</b> ${p.rampId ?? '—'}\n` +
        `<b>vel</b> ${Math.hypot(p.vel.x, p.vel.y).toFixed(2)} m/s  <b>stam</b> ${p.stamina.toFixed(0)}\n` +
        `<b>seed</b> ${s.seed}  <b>bal</b> ${s.cardBalance}\n` +
        `<b>gates</b> ok=[${working}]  st=${s.gates.state}  cd=${(s.gates.cooldownMs / 1000).toFixed(1)}\n` +
        `<b>train</b> ${s.train.state}  x=${s.train.x.toFixed(0)}  door=${s.train.doorProgress.toFixed(2)}\n` +
        `<b>t</b> ${(s.timeLeftMs / 1000).toFixed(1)}s  elapsed ${(s.elapsedMs / 1000).toFixed(1)}s`
    },
  }
}
