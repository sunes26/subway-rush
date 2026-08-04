import { expect, test } from '@playwright/test'

/** S1-6 · S7-2 — 드로우 콜·삼각형 예산 검증 */
test('렌더 예산', async ({ page }) => {
  await page.goto('/?seed=42')
  await page.waitForFunction(() => !!window.__game, null, { timeout: 20_000 })
  await page.waitForTimeout(1500)
  await page.keyboard.press('Enter')

  const results: Record<string, { calls: number; tris: number }> = {}
  const spots: readonly [string, number, number, number, string][] = [
    ['Z1', -58, 24, 0, 'Z1'],
    ['Z2', 30, 20, -6, 'Z2'],
    ['Z3', 57, 14, -6, 'Z3'],
    ['Z4', 104, 6.7, -13, 'Z4'],
    ['Z5', 130, 8, -20, 'Z5'],
  ]
  for (const [name, x, y, z, zone] of spots) {
    await page.evaluate(([px, py, pz, zn]) => {
      const s = window.__game!.state()
      window.__game!.set({ zone: zn as never,
        player: { ...s.player, pos: { x: px as number, y: py as number, z: pz as number } } } as never)
    }, [x, y, z, zone] as const)
    await page.waitForTimeout(1600)
    results[name] = await page.evaluate(() => {
      const r = (window as unknown as { __renderer?: { info: { render: { calls: number; triangles: number } } } }).__renderer
      return { calls: r?.info.render.calls ?? -1, tris: r?.info.render.triangles ?? -1 }
    })
  }
  console.log('RENDER BUDGET', JSON.stringify(results, null, 1))
  for (const [zone, v] of Object.entries(results)) {
    // 1인칭 기준 예산.
    // 쿼터뷰는 위에서 내려다보며 한 존만 담았지만, 1인칭은 눈높이에서 통로를 따라
    // 멀리까지 본다 — 인접 존과 천장이 동시에 시야에 들어오므로 콜이 늘어난다.
    // 그레이박스 시절 목표 80 → 실물 120 → 1인칭 160 → 실내 마감 180 → 개찰구 증설 200.
    //
    // 로더가 **머티리얼별로 병합**하므로 병합분의 드로우 콜 수 ≈ 머티리얼 종류다.
    // 다만 게이트는 상태에 따라 색·위치가 바뀌어 **병합에서 제외**된다
    // (`DYNAMIC_NAME`: 플랩 2 · 사인면 1 · 바닥램프 1 = 게이트당 4개).
    //
    // 이번 상향의 근거는 마감이 아니라 구조 변경이다 — 개찰구를 6기 → 9기로 늘리면서
    // 동적 메시가 24 → 36개로 **+12** 늘었다. Z2 지점에서 게이트 뱅크가 시야에 들어온다.
    // 화장실을 새로 지으며 늘어난 머티리얼은 7종 → 2종으로 이미 통합했다(−4 콜).
    //
    // 진짜 상한은 여기가 아니라 `A-6 60fps 유지` 쪽이다.
    // 더 줄여야 하면 `render/gate-rig.ts`가 답이다 — 플랩을 InstancedMesh로 그리는
    // 구현이 이미 있는데 main.ts가 임포트하지 않아 죽어 있고, 살리면 18콜을 1콜로 줄인다.
    // 200 → 210. 레퍼런스 대조 품질 상향(§22)에서 존별로 머티리얼이 늘었다 —
    // Z4 에 광고·사인·걸레받이 6종, Z3 에 「나가는 곳」 연두 1종.
    // **존당 머티리얼 = 드로우 콜**이고, Z4·Z3 는 Z2 시점에서도 같이 잡힌다.
    // 같은 작업에서 `SIGN_DARK`를 DYNAMIC_MATERIAL 에서 빼 −11 콜을 먼저 회수했다.
    // 실측 Z2 200. 프레임 시간의 진짜 관문은 여전히 `feel.spec` 이고 그쪽은 통과한다.
    // 210 → 230. 마감 상향(§23)에서 존별 머티리얼이 늘었다.
    // 처음엔 Z2 가 269 까지 갔는데, 원인은 마감 자체가 아니라 `HQ_*` 머티리얼을
    // **124종 새로 만든 것**이었다 — 위에 적었듯 존의 콜 ≈ 머티리얼 종류다.
    // `tools/hq_merge_materials.py` 로 기존 팔레트에 얹어 215 로 되돌렸다.
    // 덤으로: `SELF_LIT_MATERIALS`·`DECAL_MATERIALS`·`GLASS_MATERIALS` 는 **이름 목록**이라
    // 새 이름을 쓰는 동안 광고가 발광 경로를 못 타고 바닥 선이 폴리곤 오프셋을 못 받았다.
    // 마감을 추가할 때 **새 머티리얼을 만들지 말 것.** 팔레트에 얹으면 콜도 룩도 공짜다.
    expect(v.calls, `${zone} draw calls`).toBeLessThan(230)
    // 삼각형 상한 12만 → 20만 (실측 Z2 15.3만).
    //
    // ⚠ 이 값을 한 번 75만까지 올렸다가 되돌렸다. 그 판단이 틀렸던 경위를 남긴다 —
    // 10만 삼각형짜리 실측 양변기를 6개 넣었더니 Z2가 69만이 됐는데
    // **`A-6 60fps 유지`는 그대로 통과했다.** 그걸 근거로 "삼각형은 병목이 아니다"라고
    // 결론냈지만, 같은 빌드에서 `feel.spec`이 무너졌다 — W를 3초 눌러 15m를 가야 하는데
    // 6.4m밖에 못 갔다. 프레임 시간이 2배 넘게 늘어 고정 60Hz 시뮬이 실시간을 못 따라간 것이다.
    //
    // 교훈: **fps 테스트는 프레임 시간 악화를 놓친다.** 렌더가 무거워지면
    // "초당 프레임 수"보다 "3초 동안 실제로 몇 m 갔나"가 먼저 무너진다.
    // 지오메트리를 늘릴 땐 `feel.spec`을 같이 볼 것.
    // 20만 → 26만. 실측 Z2 19.3만이라 여유가 3%뿐이었다 — 그 정도면 정상적인 추가에도
    // 깨져서 경고선 구실을 못 한다. 폭주(2~3배)는 여전히 잡히는 선으로 올린다.
    // 프레임 시간을 실제로 지키는 건 이 값이 아니라 `feel.spec` 쪽이다(위 경위 참고).
    // 26만 → 30만. 모서리 챔퍼 패스(§22.8) 때문이다 — 상가 집기·광고 프레임·사인 케이스에
    // 1.2cm 모따기를 넣어 37개 오브젝트가 5,640 → 19,080 삼각형이 됐다.
    // "너무 사각형으로 보인다"는 지적에 대한 답이라 되돌릴 값이 아니다.
    // 실측 Z2 268,580. 여기도 폭주 감지선일 뿐, 프레임 시간은 `feel.spec` 이 지킨다.
    // 30만 → 42만. 레퍼런스 대조 2차(§23)로 역 지오메트리가 183 k → 270 k 면이 됐다.
    //
    // ⚠ 이 값을 올리기 전에 `feel.spec` 이 무너지는 걸 봤다 — 3초 전진 15 m → 6 m.
    // 위 경위대로라면 프레임 시간 붕괴이므로 되돌려야 맞다. **그런데 아니었다.**
    // 이 설정은 `--use-angle=swiftshader`, 즉 WebGL 을 **CPU 로** 그린다.
    // 같은 빌드를 `playwright.gpu.config.ts`(실제 GPU)로 돌리면 3/3 통과하고
    // 사람이 직접 플레이해도 렉이 없다. 소프트웨어 래스터가 삼각형에 과민했던 것이다.
    //
    // 교훈: **소프트웨어 렌더에서의 프레임 지표는 실제 조작감이 아니다.**
    // 그래도 저사양(내장 그래픽) 신호로는 유효하므로, 여유가 사라지면
    // 거리 LOD(마감층은 30 m 밖에서 안 읽힌다)를 먼저 넣을 것.
    // 42만 → 47만. 지상 가로를 세우면서다(§24) — 도로 양쪽에 건물 14동을 올리고
    // 층 슬래브 띠를 **둘레로** 둘렀다. 띠를 앞면에만 두면 가로 축에서 볼 때
    // 측면이 통짜 회색 덩어리가 되므로 되돌릴 값이 아니다.
    // 실측 Z1 228,677 · Z2 435,193. Z2 가 같이 늘어난 것은 개구부 절단(bisect)으로
    // 천장 격자 면이 쪼개졌기 때문이다.
    //
    // 여기는 **폭주 감지선**이고 프레임 시간을 지키는 건 `feel.spec` 쪽이다
    // (위 경위 참고). 이 빌드에서 `feel.spec` · `A-6 60fps` 는 GPU 설정에서 통과한다.
    expect(v.tris, `${zone} triangles`).toBeLessThan(470_000)
  }
})
