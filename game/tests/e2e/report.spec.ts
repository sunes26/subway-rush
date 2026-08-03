/**
 * 지적 사항 검증 촬영 — **디렉터가 짚은 좌표를 그대로** 찍는다.
 *
 * `tour.spec` 은 맵 전체를 같은 앵글로 비교하는 물건이고, 이쪽은 다르다.
 * 보고된 좌표·시선을 1:1 로 재현해 "그 자리에서 그게 사라졌는가"만 본다.
 * 앵글을 예쁘게 고르면 안 된다 — 지적한 사람이 서 있던 자리가 유일한 기준이다.
 *
 * 항목 번호는 2026-08-03 지적 목록과 같다.
 */

import { expect, test, type Page } from '@playwright/test'

type Shot = Readonly<{
  name: string
  pos: { x: number; y: number; z: number }
  /** 시선 요(rad). 0 = +x(동) */
  yaw: number
  pitch?: number
  note: string
}>

const B1 = -6

const SHOTS: readonly Shot[] = [
  // 1 — 횡단보도. 적신호 벽의 정체를 HUD 가 밝히는지
  { name: 'i01-crosswalk', pos: { x: -32.5, y: 27.6, z: 0 }, yaw: 0, note: '1 횡단보도 · 신호 표시' },
  // 2 — 역 입구 "박스". 계단통 안 눈높이 난간 보를 철거한 자리
  { name: 'i02-entrance', pos: { x: 0.4, y: 27.5, z: 0 }, yaw: 0, note: '2 역 입구 · 박스 철거 확인' },
  { name: 'i02b-entrance-s', pos: { x: 0.4, y: 27.5, z: 0 }, yaw: -Math.PI / 2, note: '2 같은 자리 남쪽 — 보가 있던 방향' },
  // 3·4 — 계단에서 시점 전환 시 깜빡임 · 떠 있던 원기둥
  { name: 'i03-stair-down', pos: { x: 1.0, y: 28, z: 0 }, yaw: 0, pitch: -0.42, note: '3 계단 내려다봄 · 깜빡임' },
  { name: 'i04-stair-up', pos: { x: 7.5, y: 28, z: -2.6 }, yaw: Math.PI, pitch: 0.35, note: '4 계단 올려다봄 · 원기둥' },
  // 5 — 전광판 앞
  { name: 'i05-pids', pos: { x: 17.3, y: 26.5, z: B1 }, yaw: 0, note: '5 전광판 앞 · 깜빡임' },
  // 6 — 지하 1층 천장. 전등과 번짐 방향이 같은지
  { name: 'i06-ceiling', pos: { x: 20, y: 15, z: B1 }, yaw: 0, pitch: 0.62, note: '6 B1 천장 · 글로우 축' },
  // 7 — 초록 부유물 네 곳
  { name: 'i07a', pos: { x: 11.0, y: 15.8, z: B1 }, yaw: 0, pitch: 0.2, note: '7 유령 기둥 띠 ①' },
  { name: 'i07b', pos: { x: 23.7, y: 16.0, z: B1 }, yaw: 0, pitch: 0.2, note: '7 유령 기둥 띠 ②' },
  { name: 'i07c', pos: { x: 26.5, y: 9.8, z: B1 }, yaw: 0, pitch: 0.2, note: '7 유령 기둥 띠 ③' },
  { name: 'i07d', pos: { x: 34.5, y: 16.1, z: B1 }, yaw: 0, pitch: 0.2, note: '7 유령 기둥 띠 ④' },
  // 8 — 쓰레기통 ∩ 소화전. 한 발 물러서야 둘이 같이 들어온다
  { name: 'i08-bin-ext', pos: { x: 47.5, y: 12.5, z: B1 }, yaw: -0.6, note: '8 쓰레기통·소화전 분리 + 20% 확대' },
  // 9 — 쓰레기통 두 개를 지운 자리
  { name: 'i09-removed', pos: { x: 57.2, y: 18.3, z: B1 }, yaw: 0, note: '9 쓰레기통 제거 확인' },
  // 10·11·12 — 개찰구. 정면 + 사선 두 장.
  // 사선을 반드시 남긴다: ○/✕ 가 카메라를 따라 도는 회귀는 정면에서 안 잡힌다.
  { name: 'i10-gate-front', pos: { x: 58.3, y: 26.5, z: B1 }, yaw: 0, note: '10 개찰구 앞 좌우 이동 · 정면' },
  { name: 'i11-gate-top', pos: { x: 57.0, y: 20.0, z: B1 }, yaw: 0.35, pitch: 0.25, note: '11 개찰구 상단 · 검은 상자 철거' },
  { name: 'i12-gate-oblique', pos: { x: 56.5, y: 8.5, z: B1 }, yaw: 0.5, note: '12 개찰구 사선 · ○/✕ 고정' },
  // 2026-08-03 2차 지적 — 매달림 사인 높이 · 하강부 소핏 · 승강장 앞 난간동자
  { name: 'i13-hangsign', pos: { x: 68.0, y: 8.3, z: B1 }, yaw: 0, pitch: 0.18, note: '5-1 사인이 눈앞을 덮지 않는가' },
  { name: 'i14-descent-in', pos: { x: 95.1, y: 5.9, z: B1 }, yaw: 0, pitch: -0.35, note: '5-2 하강 진입 · 소핏 리브와 조명' },
  { name: 'i15-descent-mid', pos: { x: 110.0, y: 6.0, z: -13.8 }, yaw: 0, pitch: -0.25, note: '5-2 하강 중간 · 동자가 계단을 딛는가' },
  { name: 'i16-pf-stairfoot', pos: { x: 105.5, y: 10.0, z: -20 }, yaw: 0, pitch: 0.05, note: '5-3 승강장에 막대가 없는가' },
  { name: 'i17-z1-stair', pos: { x: 16.0, y: 28.0, z: B1 }, yaw: Math.PI, pitch: 0.30, note: '출입 계단통 · 동자와 소핏 마감' },
  // 2026-08-03 3차 지적 — 화장실 사인 방향 · 유실물 깜빡임 · 승강장 의자 앞
  { name: 'i18-wc-sign', pos: { x: 35.0, y: 15.0, z: B1 }, yaw: 0, pitch: 0.30, note: '화살표가 북(화장실)을 가리키는가 · 반대면 글자가 안 비치는가' },
  { name: 'i19-lost', pos: { x: 49.0, y: 21.5, z: B1 }, yaw: 1.2, note: '유실물 창구 · 프레임이 유리를 안 삼키는가' },
  { name: 'i20-pf-bench', pos: { x: 126.0, y: 3.0, z: -20 }, yaw: -Math.PI / 2, pitch: -0.15, note: '우선석 앞에 하강부 마감이 없는가' },
  // 2026-08-03 4차 지적 — 계단 광고 철거 · 중앙 난간 · 승강장 천장 관통
  { name: 'i21-stair-top', pos: { x: 95.1, y: 6.0, z: B1 }, yaw: 0, pitch: -0.35, note: '계단 구간에 광고가 없는가' },
  { name: 'i22-stair-mid', pos: { x: 108.0, y: 6.0, z: -13.0 }, yaw: 0, pitch: -0.20, note: '천장 티바가 계단 앞에 깔리지 않는가' },
  { name: 'i23-stair-up', pos: { x: 120.9, y: 6.2, z: -20 }, yaw: Math.PI, pitch: 0.30, note: '계단 한복판에 중앙 난간 격자가 없는가' },
  { name: 'i24-stair-under', pos: { x: 108.0, y: 11.5, z: -20 }, yaw: -0.9, pitch: 0.10, note: '계단 밑면에 박힌 봉이 없는가' },
]

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
  // 낙하 접지 + 존 가시성·천장 토글 반영. tour.spec 이 0.3초에서 헛짚었던 값이라 넉넉히 준다.
  await page.waitForTimeout(700)
  return page.evaluate(() => window.__game!.state().player.pos)
}

// tour.spec 과 같은 이유로 넉넉히 준다 — 촬영은 계측기지 성능 테스트가 아니다.
test.setTimeout(240_000)

test('지적 사항 검증 촬영', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))

  // 시간제한이 있으면 촬영 도중 게임이 끝나 화면이 결과창으로 바뀐다
  await page.goto('/?freeplay&seed=1')
  await page.waitForFunction(() => !!window.__game?.stationStats(), null, { timeout: 90_000 })

  // 폴백 그레이박스를 찍고 "봤다"고 하면 안 된다
  const stats = await page.evaluate(() => window.__game!.stationStats())
  expect(stats!.merged, '역사 GLB 병합 메시').toBeGreaterThan(50)

  for (const s of SHOTS) {
    const at = await place(page, s)
    const drop = Math.abs(at.z - s.pos.z)
    console.log(`${s.name}  z요청=${s.pos.z.toFixed(2)} 실제=${at.z.toFixed(2)} Δ=${drop.toFixed(2)}  ${s.note}`)
    await page.screenshot({ path: `tests/e2e/__shots__/report/${s.name}.png` })
  }

  expect(errors.join(' | '), '콘솔 에러 없음').toBe('')
})
