/**
 * `src/data/world.ts`의 충돌 데이터를 JSON으로 뽑는다.
 *
 * Blender에서 **보이는 것 위에 막는 것을 겹쳐 보기** 위한 것이다.
 * 이 프로젝트에서 반복해서 물린 버그가 전부 그 둘의 어긋남이었다 —
 * 계단이 0.30m 뜬 것, 유령 기둥, 문틀보다 1.35m 앞에서 막던 화장실.
 * 웹에서 돌려 보기 전에 Blender 안에서 바로 보이면 그 왕복이 없어진다.
 *
 *   cd game && npx tsx tools/dump-collision.ts
 *   → tools/collision.json
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GUIDE_PATHS, RAMPS, SLABS, SOLIDS, SPAWN } from '../src/data/world'

const HERE = dirname(fileURLToPath(import.meta.url))

const payload = {
  note: 'game/src/data/world.ts에서 생성. 직접 고치지 말 것 — 원본을 고치고 다시 뽑는다.',
  spawn: SPAWN,
  solids: SOLIDS.map((s) => ({
    id: s.id,
    rect: s.rect,
    z0: s.z0,
    h: s.h,
    look: s.look,
    // 충돌 높이와 렌더 높이가 다른 것들이 있다 — 겹쳐 볼 때 이 차이가 중요하다
    renderH: s.renderH ?? null,
  })),
  slabs: SLABS.map((s) => ({ id: s.id, rect: s.rect, z: s.z, kind: s.kind })),
  ramps: RAMPS.map((r) => ({
    id: r.id, rect: r.rect, axis: r.axis, zAtMin: r.zAtMin, zAtMax: r.zAtMax, kind: r.kind,
  })),
  guidePaths: GUIDE_PATHS,
}

mkdirSync(HERE, { recursive: true })
const out = join(HERE, 'collision.json')
writeFileSync(out, JSON.stringify(payload, null, 1), 'utf8')
console.log(
  `${out}\n  solids ${payload.solids.length} · slabs ${payload.slabs.length}`
  + ` · ramps ${payload.ramps.length} · guide ${payload.guidePaths.length}`,
)
