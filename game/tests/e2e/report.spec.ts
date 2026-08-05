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
  // 2026-08-04 지상 가로 — 신호등 · 도로 양쪽 건물
  { name: 'i25-cross-signal', pos: { x: -35.8, y: 26.8, z: 0 }, yaw: 0, pitch: 0.05, note: '횡단보도 양단에 보행등이 서 있는가' },
  { name: 'i26-cross-south', pos: { x: -27.0, y: 27.5, z: 0 }, yaw: -Math.PI / 2, pitch: 0.15, note: '남단 보행등 · 차량등 · 남측 건물' },
  { name: 'i27-street-e', pos: { x: -60.0, y: 27.5, z: 0 }, yaw: 0, pitch: 0.14, note: '가로 원경 — 양쪽 건물과 간판 리듬' },
  { name: 'i28-street-w', pos: { x: -12.0, y: 27.5, z: 0 }, yaw: Math.PI, pitch: 0.14, note: '반대 방향 원경 — 스카이라인' },
  // 지상 가로 2차 — 이면도로 · 신호등 방향 · 지반
  { name: 'i29-signal-face', pos: { x: -34.8, y: 26.8, z: 0 }, yaw: 0, pitch: 0.10, note: '서단 등이 진행 방향(+x)을 향하는가 — 이쪽에서는 뒷면' },
  { name: 'i30-signal-back', pos: { x: -19.0, y: 27.5, z: 0 }, yaw: Math.PI, pitch: 0.06, note: '동쪽에서 보면 서단 등면이 정면으로 보이는가' },
  { name: 'i31-sideroad', pos: { x: -27.0, y: 24.5, z: 0 }, yaw: -Math.PI / 2, pitch: 0.02, note: '이면도로가 남쪽으로 뚫려 있는가(건물이 없는가)' },
  { name: 'i32-south-ground', pos: { x: -45.0, y: 23.0, z: 0 }, yaw: -1.15, pitch: 0.02, note: '남측 건물이 지반을 딛고 있는가' },
  // 차량 교통 (Kenney Car Kit · CC0)
  { name: 'i33-traffic-cross', pos: { x: -35.8, y: 26.8, z: 0 }, yaw: 0, pitch: 0.05, note: '횡단보도 앞 차량 흐름' },
  { name: 'i34-traffic-side', pos: { x: -27.0, y: 24.5, z: 0 }, yaw: -Math.PI / 2, pitch: 0.02, note: '이면도로 — 신호에 따라 서는가' },
  { name: 'i35-traffic-wide', pos: { x: -50.0, y: 26.0, z: 0 }, yaw: 0.5, pitch: 0.08, note: '가로 원경 — 차량이 도로를 채우는가' },
  // 화살표 방향 — 주 진행은 +x 라 대부분 직진(↑)이다
  { name: 'i36-arrow-gate', pos: { x: 65.4, y: 8.2, z: B1 }, yaw: 0, pitch: 0.22, note: '개찰구 "승강장" 은 직진 ↑' },
  { name: 'i37-arrow-gate-e', pos: { x: 72.0, y: 8.0, z: B1 }, yaw: Math.PI, pitch: 0.22, note: '동면 "환승" ↑ · 출구 띠에 화살표 없음' },
  { name: 'i38-arrow-wc', pos: { x: 35.0, y: 15.0, z: B1 }, yaw: 0, pitch: 0.24, note: '화장실은 북(y 25~30) → ← 가 맞다' },
  { name: 'i39-arrow-floor', pos: { x: 7.0, y: 15.0, z: B1 }, yaw: 0, pitch: -0.42, note: '바닥 "출구" — 계단이 북이라 ←' },
  { name: 'i40-arrow-floor2', pos: { x: 35.0, y: 15.0, z: B1 }, yaw: 0, pitch: -0.42, note: '바닥 "승강장" — 동이라 ↑' },
  // 통로 광고 · 승강장 PIDS — 벽/천장에 붙어 있는가
  { name: 'i41-ads-n', pos: { x: 80.0, y: 6.0, z: B1 }, yaw: Math.PI / 2, pitch: 0.08, note: '북면 광고가 벽에 밀착 · 한 벌만' },
  { name: 'i42-ads-s', pos: { x: 80.0, y: 6.0, z: B1 }, yaw: -Math.PI / 2, pitch: 0.08, note: '남면도 같게' },
  // PIDS 는 x 92·124·156·188 · y 6.0~6.6, 케이스 z −17.65~−17.02 다.
  // 가까이서 올려다보면 **밑면만** 보인다(눈높이 −19.4 라 2 m 아래다).
  // 문안은 남·북 두 면에 있으므로 **면 법선에 가까운 쪽**에서 봐야 읽힌다.
  // 축선(y 6.3)에 서면 기둥에 카메라가 박히고, 멀리서 옆으로 보면 스침각이라
  // 글자가 뭉갠다. x 156 전광판을 x 150 · y 11 에서 잡으면 법선에서 52° 다.
  // yaw = atan2(6.3−11.0, 156−150) ≈ −0.66, pitch = atan(2.0 / 7.6) ≈ 0.26.
  { name: 'i43-pids', pos: { x: 150.0, y: 11.0, z: -20 }, yaw: -0.66, pitch: 0.26, note: 'PIDS 가 천장에 안 잘리고 문안이 읽히는가' },
  // 하강 소핏 절단 · 역명판 축소
  { name: 'i44-desc-stop', pos: { x: 124.0, y: 6.0, z: -20 }, yaw: Math.PI, pitch: 0.45, note: '승강장 위 경사 램프가 없고 개구부 끝에서 수직으로 꺾이는가' },
  // 자판기 — 점포 개구부(칸 중심 ±0.80)를 비켜 파일런 앞에 서 있는가
  { name: 'i46-vend-cvs', pos: { x: 10.88, y: 8.0, z: B1 }, yaw: -Math.PI / 2, pitch: 0.02, note: '편의점 문이 뚫려 있고 자판기가 옆 기둥에 붙었는가' },
  { name: 'i47-vend-row', pos: { x: 19.0, y: 9.5, z: B1 }, yaw: -1.15, pitch: 0.02, note: '점포 열 사선 — 자판기 3대가 파일런에 붙었는가' },
  // 차도 개방 — 적신호에도 건너고 차도에도 내려선다(치이면 스폰)
  { name: 'i48-on-road', pos: { x: -40.0, y: 19.0, z: 0 }, yaw: 0, pitch: 0.04, note: '차도 한복판에 설 수 있는가 · 차가 달려오는가' },
  { name: 'i49-cross-red', pos: { x: -32.0, y: 27.5, z: 0 }, yaw: 0, pitch: 0.04, note: '횡단보도 위 — 적신호에도 막히지 않는가' },
  { name: 'i45-name-sign', pos: { x: 132.0, y: 11.5, z: -20 }, yaw: -Math.PI / 2, pitch: 0.42, note: '역명판 3.4×1.3 m · 밑변 바닥 위 2.4 m' },
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
// 촬영 지점이 35곳으로 늘고 차량까지 로드하면서 소프트웨어 래스터에서 240 초를 넘겼다
// (단독 실행은 2.1 분인데 전체 스위트에서만 죽는 것이 그 신호였다).
// 지점이 49곳이 되고 `road.spec` 의 실시간 대기(45초)가 붙으면서 420 초에서도
// 한 번 넘겼다 — 단독은 2.6 분인데 전체에서만 죽는 같은 신호라 다시 올린다.
test.setTimeout(540_000)

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
