/**
 * UI-06 미니맵 — I-13 노선도로 해금 (`docs/P2-SPEC.md` §8.1).
 *
 * P1까지 이건 **잠긴 껍데기**였다(Figma 적용 때 컨테이너와 존 배너만 넣었다).
 * 그 상태는 의도된 것이었다 — P2 아이템의 가치를 미리 광고한다.
 *
 * ★ **적을 안 찍는다.** 역무원·아주머니·좀비폰족의 위치는 표시하지 않는다.
 *   미니맵이 레이더가 되면 고개를 돌려 볼 이유가 사라지고, 이 게임의 관찰이 죽는다.
 *   찍는 것은 **고정된 것**뿐이다: 존 평면 · 목표 · 열차 문 · 대기줄.
 *
 * Canvas 2D 로 그린다. Three 씬에 얹으면 드로우 콜 예산(<210)을 건드리는데,
 * 미니맵은 초당 몇 번만 다시 그려도 되는 물건이라 그 값을 낼 이유가 없다.
 */

import { DOOR_XS, FLOOR, PLATFORM, QUEUE_MARKERS } from '../data/world'
import type { GameState } from '../state/types'

/** 원형 미니맵 지름(px) — `hud.css` 의 `#mini-r` 과 같은 값 */
const SIZE = 200
/** 화면 1px 당 월드 m. 확대(노선도 펼침)하면 더 넓게 본다 */
const SCALE_NEAR = 3.2
const SCALE_WIDE = 7.0

type Pt = { x: number; y: number }

/** 월드(x 동 · y 북) → 캔버스(px). 플레이어 중심 · **북쪽이 위** */
const project = (p: Pt, center: Pt, mPerPx: number): Pt => ({
  x: SIZE / 2 + (p.x - center.x) / mPerPx,
  y: SIZE / 2 - (p.y - center.y) / mPerPx,
})

export type Minimap = Readonly<{
  /** 매 프레임 호출해도 되지만 내부에서 스로틀한다 */
  sync(s: GameState): void
  /** 해금 상태 (E2E) */
  unlocked(): boolean
}>

/** 존 평면 — 그리는 것은 **바닥 슬랩의 겉모양**뿐이다. 벽은 안 그린다(원 안에서 뭉갠다) */
const ZONE_RECTS: readonly (readonly [number, number, number, number, number])[] = [
  [-64, 22, 2, 34, FLOOR.L0],
  [0, 0, 56, 30, FLOOR.B1],
  [56, 0, 72, 32, FLOOR.B1],
  [72, 2, 95.8, 12, FLOOR.B1],
  [PLATFORM.xMin, PLATFORM.yMin, PLATFORM.xMax, 12.3, FLOOR.B2],
]

/** 존 배너(`#mini-z`)는 HUD 가 이미 갱신한다 — 여기서 또 쓰면 두 곳이 다투게 된다 */
export const createMinimap = (mount: HTMLElement): Minimap => {
  const canvas = document.createElement('canvas')
  canvas.id = 'mini-c'
  canvas.width = SIZE
  canvas.height = SIZE
  ;(mount.querySelector('#mini-r') ?? mount).appendChild(canvas)
  const ctx = canvas.getContext('2d')

  let last = 0
  let on = false

  const draw = (s: GameState): void => {
    if (!ctx) return
    const wide = s.flags.includes('MAP_OPEN')
    const mPerPx = (wide ? SCALE_WIDE : SCALE_NEAR) / 10
    const c = { x: s.player.pos.x, y: s.player.pos.y }
    ctx.clearRect(0, 0, SIZE, SIZE)

    // 원형 클립 — 컨테이너가 원이라 밖으로 새면 사각형이 삐져나온다
    ctx.save()
    ctx.beginPath()
    ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 1, 0, Math.PI * 2)
    ctx.clip()

    // 같은 층만 진하게 — 다른 층은 흐리게 남긴다(어디로 내려가는지가 보여야 한다)
    for (const [x0, y0, x1, y1, z] of ZONE_RECTS) {
      const same = Math.abs(z - s.player.pos.z) < 3.0
      ctx.fillStyle = same ? 'rgba(122,162,255,.16)' : 'rgba(140,150,170,.06)'
      ctx.strokeStyle = same ? 'rgba(122,162,255,.42)' : 'rgba(140,150,170,.16)'
      ctx.lineWidth = 1
      const a = project({ x: x0, y: y1 }, c, mPerPx)
      const b = project({ x: x1, y: y0 }, c, mPerPx)
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y)
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y)
    }

    // 열차 문 8개 · 대기줄 3개 — **노선도가 실제로 주는 정보**가 이것이다
    ctx.fillStyle = 'rgba(255,200,61,.85)'
    for (const x of DOOR_XS) {
      const p = project({ x, y: 12.15 }, c, mPerPx)
      ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3)
    }
    ctx.fillStyle = 'rgba(127,224,160,.9)'
    QUEUE_MARKERS.forEach((q, i) => {
      const p = project({ x: q.x, y: q.y }, c, mPerPx)
      ctx.beginPath()
      ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2)
      ctx.fill()
      // 줄 길이는 시드마다 다르다 — 숫자로 적어야 노선도가 정답을 주지 않는다(R3)
      ctx.font = '9px ui-monospace, monospace'
      ctx.fillText(String(s.queues[i] ?? ''), p.x + 5, p.y + 3)
      ctx.fillStyle = 'rgba(127,224,160,.9)'
    })

    ctx.restore()

    // 플레이어 — 삼각형 하나. 항상 화면 중앙이고 방향만 돈다
    ctx.save()
    ctx.translate(SIZE / 2, SIZE / 2)
    ctx.rotate(-s.player.facing + Math.PI / 2)
    ctx.fillStyle = '#FFC83D'
    ctx.beginPath()
    ctx.moveTo(0, -7)
    ctx.lineTo(5, 6)
    ctx.lineTo(-5, 6)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  return {
    unlocked: () => on,
    sync(s) {
      const has = s.inventory.includes('I-13')
      if (has !== on) {
        on = has
        mount.classList.toggle('locked', !on)
        mount.classList.toggle('on', on)
      }
      if (!on) { canvas.style.display = 'none'; return }
      canvas.style.display = 'block'
      /**
       * 스로틀 — 미니맵은 초당 12회면 충분하다.
       * 60Hz 로 다시 그리면 Canvas 2D 가 프레임 예산을 야금야금 먹고,
       * 그건 `feel.spec`(3초에 몇 m 갔나)에서 곧바로 드러난다.
       */
      if (s.elapsedMs - last < 80) return
      last = s.elapsedMs
      draw(s)
    },
  }
}
