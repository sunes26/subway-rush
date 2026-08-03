/**
 * 연결 요소(섬) 분해 — 하나의 메시 안에 흩어져 있는 **개별 부품**을 찾아낸다.
 *
 * 왜 필요한가. GLB 의 오브젝트는 이미 조인되어 있다. 실측으로 확인한 것들:
 *   Z5 `AD_PANEL`  한 메시가 97~127 m 에 걸쳐 있다 (승강장 광고판 전체가 한 덩어리)
 *   Z2 `SH_RED`    한 메시가 37.6 × 29.8 m (콩코스 상가 사인 전체)
 *   Z2 `FIXTURE`   메시당 정점 252개 ≈ 조명 상자 10개가 한 덩어리
 * 그래서 "소스 메시 = 부품 하나"라는 가정으로 글로우 판이나 그림자를 깔면
 * **역사를 통째로 덮는 판때기 한 장**이 나온다. 부품 단위로 쪼개야 한다.
 *
 * ⚠ 인덱스 버퍼만으로 연결 성분을 찾으면 안 된다. glTF 는 평면 셰이딩 때문에
 * 면마다 정점을 쪼개 두므로(상자 하나 = 정점 24개), 상자가 **면 6장으로 흩어진다.**
 * 위치를 1 mm 격자로 용접한 뒤에 이어 붙여야 상자가 상자로 나온다.
 */

import { Box3, Vector3, type BufferGeometry } from 'three'

/** 용접 격자 — 1 mm. 이 맵의 최소 디테일(모따기 1.2 cm)보다 한 자릿수 작다. */
const WELD = 1000

const v = new Vector3()

/**
 * 월드 좌표로 구워진 지오메트리를 섬 단위 AABB 목록으로 쪼갠다.
 *
 * @param maxVertices 이 이상이면 빈 배열을 돌려준다. 건축 본체(벽·바닥·천장)는
 *   섬으로 쪼개 봐야 쓸 데가 없고 로드 시간만 먹는다.
 */
export const splitIslands = (geo: BufferGeometry, maxVertices = 40_000): Box3[] => {
  const pos = geo.getAttribute('position')
  if (!pos || pos.count === 0 || pos.count > maxVertices) return []

  const n = pos.count
  const idx = geo.getIndex()

  // ── 1) 위치 용접: 같은 자리의 정점들을 대표 인덱스 하나로 모은다
  const weld = new Map<string, number>()
  const rep = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(pos.getX(i) * WELD)},${Math.round(pos.getY(i) * WELD)},${Math.round(pos.getZ(i) * WELD)}`
    const hit = weld.get(key)
    if (hit === undefined) { weld.set(key, i); rep[i] = i } else rep[i] = hit
  }

  // ── 2) 삼각형을 따라 union-find
  const parent = new Int32Array(n)
  for (let i = 0; i < n; i++) parent[i] = i
  const find = (a: number): number => {
    let x = a
    for (;;) {
      const p = parent[x] as number
      if (p === x) return x
      // 경로 압축 — 다음 조회부터 한 단계로 끝난다
      parent[x] = parent[p] as number
      x = parent[x] as number
    }
  }
  const union = (a: number, b: number): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }

  const tris = idx ? idx.count / 3 : Math.floor(n / 3)
  for (let t = 0; t < tris; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2
    const a = rep[i0] as number
    const b = rep[i1] as number
    const c = rep[i2] as number
    union(a, b)
    union(b, c)
  }

  // ── 3) 루트별 AABB
  const boxes = new Map<number, Box3>()
  for (let i = 0; i < n; i++) {
    const r = find(rep[i] as number)
    let box = boxes.get(r)
    if (!box) { box = new Box3(); boxes.set(r, box) }
    box.expandByPoint(v.set(pos.getX(i), pos.getY(i), pos.getZ(i)))
  }
  return [...boxes.values()]
}
