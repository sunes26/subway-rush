/**
 * 엔딩 도감용 무드 스크린샷 16장 — `public/endings/E-XX.png`.
 *
 * 초상화(`public/portraits/*.png`)와 같은 방식이다: **실제 씬 렌더를 그대로 쓴다.**
 * 판정·조건은 안 건드린다 — `window.__game.set()` 으로 위치·시각만 잡고 `freeCam` 으로
 * 구도를 잡은 뒤 찍는다. 매 컷마다 새로 로드해 상태 오염(추격·매복 활성 등)을 피한다.
 *
 * 이 스펙은 검증이 아니라 **자산 생성**이다 — `p1-shots.spec.ts` 와 같은 카테고리.
 */
import { test, type Page } from '@playwright/test'
import { DOOR_XS, FLOOR, QUEUE_MARKERS, Y_OFFSET_OPP, GATE_BODY } from '../../src/data/world'
import { TRAIN } from '../../src/data/tuning'
import { AMBUSH_TRIGGER_X } from '../../src/systems/ambush'

const DIR = 'public/endings'
const CLIP = { x: 140, y: 96, width: 1000, height: 560 } as const

const boot = async (page: Page): Promise<void> => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/?seed=11')
  await page.waitForFunction(() => !!window.__game, null, { timeout: 30_000 })
  await page.waitForFunction(
    () => (document.getElementById('load') as HTMLElement | null)?.style.display === 'none',
    null, { timeout: 90_000 })
  // 오버레이(HUD·프롬프트·대화)를 걷어 순수 환경 컷으로 찍는다
  await page.evaluate(() => {
    const ui = document.getElementById('ui')
    if (ui) ui.style.display = 'none'
  })
}

type Shot = Readonly<{
  id: string
  /** 플레이어 위치(월드) */
  pos: [number, number, number]
  /** 카메라 위치·시선(월드) */
  cam: [number, number, number]
  look: [number, number, number]
  elapsedMs?: number
  flags?: readonly string[]
  inventory?: readonly (string | null)[]
  /** freeCam 대신 실시간 시스템(추격·매복)이 카메라를 몰게 둔다 */
  live?: boolean
  waitMs?: number
}>

const DOOR_Q1 = DOOR_XS[16] as number // QUEUE_MARKERS[0].x(112)와 같은 문

const SHOTS: readonly Shot[] = [
  // E-01 아슬아슬 탑승 — 닫히기 시작한 문, 다급하게 몸을 들이민다
  {
    id: 'E-01',
    pos: [DOOR_Q1, 10.3, FLOOR.B2],
    cam: [DOOR_Q1 - 1.2, 6.5, FLOOR.B2 + 1.5],
    look: [DOOR_Q1, 10.3, FLOOR.B2 + 1.3],
    elapsedMs: TRAIN.closeStartMs + 500,
  },
  // E-02 여유로운 출근 — 문이 막 열린 한산한 승강장
  {
    id: 'E-02',
    pos: [DOOR_Q1 + 4, 9.6, FLOOR.B2],
    cam: [DOOR_Q1 - 1.2, 6.5, FLOOR.B2 + 1.5],
    look: [DOOR_Q1, 9.8, FLOOR.B2 + 1.2],
    elapsedMs: TRAIN.stopMs + 2_500,
  },
  // E-03 앉아서 간다 — 3-1 승차위치, 문이 열려 있다
  {
    id: 'E-03',
    pos: [QUEUE_MARKERS[0].x, QUEUE_MARKERS[0].y + 0.3, FLOOR.B2],
    cam: [QUEUE_MARKERS[0].x - 2.4, QUEUE_MARKERS[0].y - 3.2, FLOOR.B2 + 1.5],
    look: [QUEUE_MARKERS[0].x, QUEUE_MARKERS[0].y, FLOOR.B2 + 1.2],
    elapsedMs: TRAIN.stopMs + 1_800,
  },
  // E-04 문틈 낑김 — 닫히는 문 사이로 가방이 낀다
  {
    id: 'E-04',
    pos: [DOOR_Q1, 10.15, FLOOR.B2],
    cam: [DOOR_Q1 + 0.3, 8.2, FLOOR.B2 + 1.55],
    look: [DOOR_Q1, 10.1, FLOOR.B2 + 1.3],
    elapsedMs: TRAIN.closeStartMs + 300,
  },
  // E-05 지하철 마스터 — 눈높이에서 뻗어나가는 승강장 전경
  {
    id: 'E-05',
    pos: [140, 10, FLOOR.B2],
    cam: [100, 10, FLOOR.B2 + 2.2],
    look: [190, 10.3, FLOOR.B2 + 1.6],
    elapsedMs: TRAIN.stopMs + 2_000,
  },
  // E-06 다음 열차 — 열차가 떠난 뒤 텅 빈 승강장
  {
    id: 'E-06',
    pos: [140, 10.4, FLOOR.B2],
    cam: [136, 6, FLOOR.B2 + 1.5],
    look: [140, 10.2, FLOOR.B2 + 1.2],
    elapsedMs: TRAIN.departMs + 4_000,
  },
  // E-08 반대편 탑승 — 반대 방면 승강장, 문이 열려 있다
  {
    id: 'E-08',
    pos: [DOOR_Q1, 9.6 + Y_OFFSET_OPP, FLOOR.B2],
    cam: [DOOR_Q1 - 1.2, 6.5 + Y_OFFSET_OPP, FLOOR.B2 + 1.5],
    look: [DOOR_Q1, 9.8 + Y_OFFSET_OPP, FLOOR.B2 + 1.2],
    elapsedMs: TRAIN.stopMs + 2_500,
  },
  // E-09 부정승차 적발 — 개찰구, 램프가 지켜보는 통로
  {
    id: 'E-09',
    pos: [(GATE_BODY.xMin + GATE_BODY.xMax) / 2, 10, FLOOR.B1],
    cam: [GATE_BODY.xMin - 4, 10, FLOOR.B1 + 1.55],
    look: [(GATE_BODY.xMin + GATE_BODY.xMax) / 2, 10, FLOOR.B1 + 1.1],
    elapsedMs: 90_000,
  },
  // E-11 에스컬레이터 참사 — 하강 시작점에서 내려다보는 경사로.
  // ⚠ 브라우저로 직접 확인한 좌표다 — 추정치로는 옆벽·지붕 밖으로 카메라가 샜다
  {
    id: 'E-11',
    pos: [97, 2.2, FLOOR.B1],
    cam: [90, 2.2, FLOOR.B1 + 3],
    look: [110, 2.2, FLOOR.B1],
    elapsedMs: 90_000,
    inventory: ['I-09', null, null],
  },
  // E-12 오늘도 평화로운 역 — 열차를 놓친 뒤의 조용한 벤치
  {
    id: 'E-12',
    pos: [42, 14.8, FLOOR.B1],
    cam: [38, 11.5, FLOOR.B1 + 1.5],
    look: [42, 15, FLOOR.B1 + 1.0],
    elapsedMs: TRAIN.departMs + 6_000,
    waitMs: 2_600,
  },
  // E-13 해방 — 화장실 문 앞
  {
    id: 'E-13',
    pos: [44.2, 22.6, FLOOR.B1],
    cam: [40.5, 20, FLOOR.B1 + 1.5],
    look: [44.2, 24.0, FLOOR.B1 + 1.1],
    elapsedMs: TRAIN.departMs + 6_000,
    waitMs: 2_600,
  },
  // E-14 동전 부자 — 자판기 세 대가 늘어선 통로
  {
    id: 'E-14',
    pos: [21.63, 3.6, FLOOR.B1],
    cam: [17, 0.4, FLOOR.B1 + 1.5],
    look: [21.63, 3.9, FLOOR.B1 + 1.1],
    elapsedMs: 60_000,
  },
  // E-15 이걸 누가 먹어 — 할아버지 벤치, 대낮
  {
    id: 'E-15',
    pos: [40.5, 14.6, FLOOR.B1],
    cam: [37, 12.2, FLOOR.B1 + 1.4],
    look: [42, 15, FLOOR.B1 + 1.0],
    elapsedMs: 40_000,
  },
  // E-16 딱! — 단소를 든 할아버지의 추격. 두 번째 피격이 즉사라 오래 두지 않는다
  {
    id: 'E-16',
    pos: [36, 13.5, FLOOR.B1],
    cam: [33.5, 10.5, FLOOR.B1 + 1.4],
    look: [40, 14.6, FLOOR.B1 + 1.1],
    flags: ['GRANDPA_ANGRY'],
    waitMs: 350,
  },
  // E-17 지지직! — 개찰구 매복. 실시간 카메라로 찍는다
  {
    id: 'E-17',
    pos: [AMBUSH_TRIGGER_X + 1, 10, FLOOR.B1],
    cam: [0, 0, 0], look: [0, 0, 0], // 미사용 — live
    flags: ['EARBUDS_STOLEN'],
    live: true,
    waitMs: 2_000,
  },
  // E-18 쾅! — 횡단보도 한복판
  {
    id: 'E-18',
    pos: [-27, 27.5, FLOOR.L0],
    cam: [-33, 20, FLOOR.L0 + 1.5],
    look: [-27, 27.5, FLOOR.L0 + 1.0],
    elapsedMs: 90_000,
  },
]

test.describe('엔딩 도감 무드 스크린샷', () => {
  test.setTimeout(600_000)

  for (const shot of SHOTS) {
    test(`샷 — ${shot.id}`, async ({ page }) => {
      await boot(page)
      await page.evaluate((s) => {
        const g = window.__game!
        const st = g.state()
        g.set({
          phase: 'playing',
          elapsedMs: s.elapsedMs ?? st.elapsedMs,
          timeLeftMs: s.elapsedMs !== undefined ? 180_000 - s.elapsedMs : st.timeLeftMs,
          player: { ...st.player, pos: { x: s.pos[0], y: s.pos[1], z: s.pos[2] }, vel: { x: 0, y: 0 } },
          flags: (s.flags ?? []) as never,
          inventory: (s.inventory ?? st.inventory) as never,
        })
        if (!s.live) g.freeCam(s.cam, s.look)
      }, shot)
      await page.waitForTimeout(shot.waitMs ?? 700)
      await page.screenshot({ path: `${DIR}/${shot.id}.png`, clip: CLIP })
    })
  }
})
