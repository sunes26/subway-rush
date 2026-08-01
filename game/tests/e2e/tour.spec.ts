/**
 * 검토용 순회 촬영 — 게임을 "직접 본다"의 도구.
 *
 * 테스트가 아니라 **계측기**다. 정해진 지점·시선에서 1인칭 스크린샷을 찍어
 * `tests/e2e/__shots__/tour/`에 남긴다. 맵을 고칠 때마다 돌려서 같은 앵글로 비교한다.
 *
 * 앵글은 "실제 지하철에서 사람이 실제로 보는 각도"로 골랐다 —
 * 위에서 내려다본 그림은 예뻐 보여도 플레이어가 볼 일이 없다.
 */

import { expect, test, type Page } from '@playwright/test'

type Shot = Readonly<{
  name: string
  pos: { x: number; y: number; z: number }
  /** 시선 요(rad). 0 = +x(동). 이동 기준과 같은 좌표계 */
  yaw: number
  pitch?: number
  note: string
}>

const B1 = -6
const B2 = -20

const SHOTS: readonly Shot[] = [
  { name: '01-z1-spawn', pos: { x: -58, y: 24, z: 0 }, yaw: 0, note: 'Z1 스폰 — 버스정류장에서 동쪽' },
  { name: '02-z1-street', pos: { x: -36, y: 28, z: 0 }, yaw: 0, note: 'Z1 인도 · 횡단보도 방향' },
  { name: '03-z1-entrance', pos: { x: -8, y: 28, z: 0 }, yaw: 0, note: '역 출입구 정면 — 외관' },
  { name: '04-stair-top', pos: { x: 1.0, y: 28, z: 0 }, yaw: 0, pitch: -0.42, note: '계단 상단에서 내려다봄' },
  { name: '05-stair-mid', pos: { x: 7.5, y: 28, z: -2.6 }, yaw: 0, pitch: -0.3, note: '계단 중간' },
  { name: '06-stair-bottom', pos: { x: 16, y: 28, z: B1 }, yaw: Math.PI, pitch: 0.28, note: '계단 하단에서 올려다봄' },
  { name: '07-z2-concourse', pos: { x: 20, y: 15, z: B1 }, yaw: 0, note: 'Z2 대합실 — 동쪽 개찰구 방향' },
  { name: '08-z2-columns', pos: { x: 30, y: 15, z: B1 }, yaw: 0.5, note: 'Z2 기둥열' },
  { name: '09-z2-shops', pos: { x: 27, y: 22, z: B1 }, yaw: 1.2, note: 'Z2 북측 편의점·카페' },
  // 화장실 파사드가 y=26.0 으로 앞으로 나왔다 — 예전 y24.5는 벽에 코가 닿는다
  { name: '09b-z2-wc', pos: { x: 44.5, y: 19.5, z: B1 }, yaw: Math.PI / 2, note: 'Z2 화장실 정면 — 남·여·다목적' },
  { name: '09c-z2-lost', pos: { x: 50, y: 20.5, z: B1 }, yaw: Math.PI / 2, note: 'Z2 유실물 보관소' },
  { name: '01b-z1-stop', pos: { x: -55, y: 24, z: 0 }, yaw: Math.PI, note: '정류장 — 표지판이 진행 반대편에 있는지' },
  { name: '10-z3-gates', pos: { x: 56.5, y: 16, z: B1 }, yaw: 0, note: 'Z3 개찰구 정면 — 게이트 9기 · 피치 2.0m' },
  { name: '11-z3-gate-close', pos: { x: 59.2, y: 14, z: B1 }, yaw: 0, note: 'Z3 개찰구 근접' },
  { name: '12-z4-corridor', pos: { x: 80, y: 7, z: B1 }, yaw: 0, note: 'Z4 운임구역 통로' },
  { name: '13-z4-descent', pos: { x: 94.5, y: 6.7, z: B1 }, yaw: 0, pitch: -0.35, note: 'Z4 하강 상단 — 계단·에스컬레이터' },
  { name: '14-z4-bottom', pos: { x: 121, y: 5, z: B2 }, yaw: Math.PI, pitch: 0.3, note: 'Z4 하단에서 올려다봄' },
  { name: '15-z5-platform', pos: { x: 128, y: 6, z: B2 }, yaw: 0, note: 'Z5 승강장 — 동쪽' },
  { name: '16-z5-psd', pos: { x: 130, y: 9, z: B2 }, yaw: Math.PI / 2, note: 'Z5 안전문 정면' },
  { name: '17-z5-wide', pos: { x: 150, y: 4, z: B2 }, yaw: 0.35, note: 'Z5 승강장 원경' },
]

/**
 * 플레이어를 특정 지점에 세우고 시선을 고정한다.
 *
 * z는 **주지 않고 게임이 정하게 한다.** 손으로 적은 z를 그대로 쓰면 실제 지면과 어긋난
 * 높이에서 찍히고, 그 그림을 보고 "지오메트리가 이상하다"는 잘못된 결론을 내린다
 * (계단 중간 앵글에서 실제로 그렇게 헛짚었다).
 * 살짝 띄워 놓고 낙하시켜 접지시킨 뒤, 실제로 어디에 섰는지 되읽는다.
 */
const place = async (page: Page, s: Shot): Promise<{ x: number; y: number; z: number }> => {
  await page.evaluate((shot) => {
    const g = window.__game!
    g.set({ phase: 'playing' })
    const st = g.state()
    g.set({
      player: {
        ...st.player,
        pos: { x: shot.pos.x, y: shot.pos.y, z: shot.pos.z + 0.6 },
        vel: { x: 0, y: 0 },
        vz: 0,
        grounded: false,
        moving: false,
        sprinting: false,
      },
    })
    g.look(shot.yaw, shot.pitch ?? 0)
  }, s as unknown as Shot)
  // 낙하 접지 + 존 가시성·천장 토글·빌보드 반영
  await page.waitForTimeout(340)
  return page.evaluate(() => window.__game!.state().player.pos)
}

test('맵 순회 촬영', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto('/')
  await page.waitForFunction(() => !!window.__game?.stationStats(), null, { timeout: 45_000 })

  // 역사 GLB가 실제로 올라왔는지 — 폴백 그레이박스를 찍고 "봤다"고 하면 안 된다
  const stats = await page.evaluate(() => window.__game!.stationStats())
  expect(stats!.merged, '역사 GLB 병합 메시').toBeGreaterThan(50)

  for (const s of SHOTS) {
    const at = await place(page, s)
    // 요청한 z와 실제 접지 z가 크게 다르면 그 앵글의 그림은 신뢰할 수 없다
    const drop = Math.abs(at.z - s.pos.z)
    console.log(`${s.name}  z요청=${s.pos.z.toFixed(2)} 실제=${at.z.toFixed(2)} Δ=${drop.toFixed(2)}  ${s.note}`)
    await page.screenshot({ path: `tests/e2e/__shots__/tour/${s.name}.png` })
  }

  // 시뮬이 멈춘 채 찍힌 그림은 증거가 못 된다
  const alive = await page.evaluate(() => window.__game!.state().elapsedMs)
  expect(alive, '시뮬레이션이 돌고 있다').toBeGreaterThan(0)
  expect(errors.join(' | '), '콘솔 에러 없음').toBe('')
})
