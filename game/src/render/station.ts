/**
 * 실제 3D 역사 로더 — `assets/station_map.blend`에서 뽑은 존별 GLB를 씬에 올린다.
 *
 * 절차 생성 그레이박스를 **보이는 것만** 교체한다. 충돌(`data/world.ts`의 SOLIDS)과
 * 게임 로직은 그대로다 — 보이는 것과 막는 것을 분리해 두면 아트가 바뀌어도 밸런스가 안 흔들린다.
 *
 * 두 가지 규칙으로 굴러간다.
 * 1. **정적 지오메트리는 머티리얼별로 병합**한다. 1,446개 메시를 그대로 올리면 드로우 콜 1,446이다.
 * 2. **동적 부품은 머티리얼 이름으로 찾는다** (`LED_RED`, `TL_GRN`, `PSD_*`…).
 *    오브젝트 이름은 리네임되면 끊기지만, 머티리얼은 룩을 정의하므로 훨씬 안정적이다.
 */

import {
  Box3, type Camera, Color, DoubleSide, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial,
  PlaneGeometry, Quaternion, RingGeometry, SRGBColorSpace, TextureLoader, Vector3,
  type BufferGeometry, type Material, type MeshStandardMaterial, type Object3D, type Texture,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { PALETTE, TRAIN } from '../data/tuning'
import { DOOR_XS, GATES } from '../data/world'
import type { GameState } from '../state/types'
import {
  buildContactShadows, mayGround, shadowQuadFrom, type ShadowQuad,
} from './contact-shadows'
import {
  buildDynamicGlow, buildGlowMesh, glowQuadsFrom, GLOW_EXCLUDE, GLOW_GAIN,
  type DynamicGlow, type GlowQuad,
} from './glow'
import { splitIslands } from './islands'
import { depthOffset, toonMat } from './toon'

export const ZONE_FILES = [
  'Z1_GROUND', 'Z2_CONCOURSE', 'Z3_GATES', 'Z4_DESCENT', 'Z5_PLATFORM', 'Z5_TRAIN',
] as const

/**
 * 머리 위 구조물 — 천장·지붕·매달림 사인.
 *
 * **1인칭에서는 있어야 하고, 쿼터뷰에서는 없어야 한다.**
 * 쿼터뷰 카메라는 반드시 방 밖 위쪽에 서므로 이것들이 화면을 통째로 막는다
 * (정류장 쉘터 지붕은 부록 A의 스폰 지점 −58,24를 정확히 덮어서, 그리면
 *  게임 시작 순간 캐릭터가 안 보였다). 1인칭은 반대로 이게 없으면 실내가 실내로 안 읽힌다.
 * 그래서 지우지 않고 **별도 그룹으로 분리해 모드에 따라 켠다.**
 * 단, `*_top`은 게이트 상단함·자판기 상단이라 일괄로 잡으면 안 된다.
 */
const OVERHEAD_MATERIALS = new Set(['ST_CEIL'])
const OVERHEAD_NAME = /ceil/i
const OVERHEAD_EXACT = /^(Z1_BS_roof|Z4_corridor_top|Z5_hang_)/

const isOverhead = (name: string, matName: string): boolean =>
  OVERHEAD_MATERIALS.has(matName) || OVERHEAD_NAME.test(name) || OVERHEAD_EXACT.test(name)

/** 존 그룹을 그릴 최대 거리(m). 안개 far(≈90m)와 맞춰 둔다. */
const VISIBLE_RANGE = 95

/**
 * 라이트맵 사용 여부. **지금은 끈다.**
 *
 * 파이프라인은 완성돼 있다 — `tools/hq_lightmap.py` 가 존별 2048² 아틀라스를 굽고,
 * `export_station.py` 가 사이드카(`assets/lightmap_uv.npz`)가 있으면 UV 를 실어 낸다.
 * 아래 코드도 전부 살아 있어서 이 상수만 켜면 동작한다.
 *
 * 그런데 **켜면 화면이 나빠진다.** 세 번 구워 보고 내린 결론이다.
 *
 *  · 바닥값 0.35 로 구우면 라이트맵이 순수 가산이라 전부 밝아지기만 하고 명암이 안 생긴다
 *  · 바닥값을 0.06 으로 낮추면 명암은 생기는데, 아틀라스 **커버리지가 26~42 % 뿐**이라
 *    타일 줄눈·천장 티바 같은 얇은 트림이 텍셀 몇 개에 뭉개져 **검은 선**으로 굳는다
 *  · 런타임 광원을 줄여 라이트맵이 주도하게 해도 위 두 증상이 그대로 남는다
 *
 * 진짜 원인은 **UV 밀도**다. 128 m 짜리 승강장을 2048² 한 장에 담으면서
 * Smart UV Project 가 얇은 조각을 잘게 흩뿌린다. 다시 하려면 아틀라스를 존당 여러 장으로
 * 나누거나, 트림류를 라이트맵에서 빼고 큰 면만 굽는 쪽이 맞다.
 *
 * 그때까지는 꺼 둔다. 켜지 않으면 GLB 에 UV 가 안 실려 용량도 22.6 → 13.2 MB 로 돌아간다.
 */
const USE_LIGHTMAP = false

/**
 * 병합하지 않고 개별로 남길 부품 (상태에 따라 움직이거나 색이 바뀐다).
 * 앞의 `(B_)?` 는 반대 방면 열차·안전문(Blender 복제, 디렉터 지시)을 잡는다 —
 * `B_TR_door_12`·`B_Z5_psd_door_3` 도 원본과 똑같이 동적 부품으로 분류돼야
 * 문이 안 열리는 채로 굳지 않는다.
 */
const DYNAMIC_NAME =
  /^(B_)?(Z3_GATE_G\d_[NS]_flap|Z3_sign_G\d_face|Z3_GATE_G\d_floorlamp|Z5_psd_door_\d+|TR_door_|TR_dwin_|Z1_OBJ02_signal)/
// ⚠ 여기 올린 머티리얼은 **쓰는 오브젝트마다 드로우 콜 1개**가 된다 (병합에서 빠지므로).
// `SIGN_DARK`가 올라가 있었는데, 그 색으로 칠해진 것 중 실제로 상태에 따라 바뀌는 건
// 게이트 표지판 **면**(`Z3_sign_G\d_face`)뿐이고 그건 위 이름 규칙이 이미 잡는다.
// 나머지(표지판 테두리 9개 · 레일 · PIDS 케이스 · 출구번호판)는 전부 정적인데
// 병합에서 빠져 Z3 에서만 콜 10개를 쓰고 있었다. 빼니 −11 콜.
const DYNAMIC_MATERIAL = new Set([
  'LED_RED', 'LED_GREEN', 'SIGN_RED', 'SIGN_GREEN',
  'TL_RED', 'TL_GRN', 'TL_COUNT',
])

const isDynamic = (o: Mesh): boolean => {
  if (DYNAMIC_NAME.test(o.name)) return true
  const m = o.material as Material | Material[]
  const names = Array.isArray(m) ? m.map((x) => x.name) : [m.name]
  return names.some((n) => DYNAMIC_MATERIAL.has(n))
}

/**
 * 텍스처를 벗겨낸 머티리얼 색 보정.
 *
 * 임포트 에셋은 색을 텍스처로 갖고 있어서 베이스 컬러가 무채색 0.8이다.
 * 텍스처를 뺀 채 그대로 쓰면 흰 판자로 보인다 — 여기서 노선/차종 색을 직접 준다.
 */
const MATERIAL_TINT: Record<string, number> = {
  Material: 0x2f6fbf,        // Z1 버스 — 서울 간선버스 파랑
  MAT_BUS: 0x2f6fbf,
  'Material.001': 0x8f959b,  // Z5 잡부재
}

/**
 * 유리로 그려야 하는 머티리얼.
 *
 * 안전문·에스컬레이터 난간·상가 창을 불투명으로 두면 유리로 안 읽힐 뿐 아니라
 * **들어오는 열차가 안 보인다** — 안전문 너머를 보는 건 이 게임에서 정보다.
 */
const GLASS_MATERIALS = new Set([
  'PSD_GLASS', 'ST_GLASS', 'ESC_GLASS', 'BLD_GLASS', 'BLD_GLASS_HQ', 'VM_GLASS', 'TR_WINDOW',
])

/**
 * 바닥·벽에 얹히는 데칼 — 줄눈·점자블록·노선띠·광고판·차선.
 *
 * 호스트 표면과 몇 mm 차이라 카메라가 움직이면 깊이 판정이 뒤집혀 점멸한다.
 * 지오메트리도 6mm 띄웠지만(Blender), 원거리에서는 깊이 정밀도가 그걸 못 버틴다.
 * 폴리곤 오프셋으로 확실히 앞에 세운다 — 아래 `DEPTH_LAYER` 의 기본 층이 2다.
 */
const DECAL_MATERIALS = new Set([
  'ST_TACTILE', 'ST_TACT_WARN', 'PF_TACTILE', 'SW_TACTILE', 'PF_YELLOW',
  'FLOOR_JOINT', 'LINE2_GRN', 'AD_PANEL', 'AD_PANEL2', 'AD_PANEL3',
  'RD_LINE', 'WEAR_LOW', 'WEAR_HIGH',
])

/**
 * 깊이 층 — **완전히 겹친 면의 앞뒤를 못박는다.** 클수록 앞, 음수면 뒤.
 *
 * ── 왜 필요한가 (전부 `tests/e2e/gap-diag.spec.ts` 로 실측한 값이다)
 * "역 입구 계단 옆이 깜빡인다"·"전광판 앞이 깜빡인다"의 정체는 둘 다 같다 —
 * 두 머티리얼의 면 사이 간격이 **0.00000 mm**, 즉 완전히 같은 평면이다.
 *   · 계단실: 인도 슬래브 절단면 `SW_PAVER`(8.4 m²) ↔ 계단실 옆벽 `ST_WALL`(86.7 m²)
 *     — 공유 평면 y=25.4 · y=30.6 (계단 구멍 양옆). "양 옆이 깜빡인다"가 이것이다.
 *   · 전광판: `SIGN_DARK` ↔ `SIGN_PLATE`, `AD_PANEL` ↔ `AD_PANEL2` — 사인 케이스와
 *     그 안의 판, 광고 바탕과 그 위 그래픽이 같은 8 mm 슬래브를 공유한다.
 *
 * ── 왜 near/far 조정이 답이 아닌가
 * near 0.08→1.0, far 260→150 을 전부 재 봤다. 겹침이 **정확히 0** 이라 깊이 정밀도를
 * 아무리 올려도 안 갈린다. 갈리는 건 삼각 분할이 달라 생기는 ULP 잡음뿐이고,
 * 그래서 픽셀마다 얼룩이 지고 카메라가 움직이면 그 얼룩이 뒤집힌다.
 *
 * ── 진짜 원인은 모델링이다
 * 같은 자리에 면이 두 장 있는 것 자체가 결함이다(Blender 쪽 `tools/`).
 * 여기서 하는 건 **렌더러가 그 상황에서도 흔들리지 않게** 앞뒤를 고정하는 일이다.
 * 지오메트리가 고쳐지면 이 표는 그대로 둬도 해가 없다 — 오프셋은 1~5 단위뿐이다.
 *
 * 적지 않은 머티리얼은 0(구조체), 단 `DECAL_MATERIALS` 는 기본 2다.
 */
const DEPTH_LAYER: Readonly<Record<string, number>> = {
  // 인도 슬래브는 계단실 안에서 **벽 뒤로** 물러난다. 실내에서 보이는 면은 벽이 맞다.
  SW_PAVER: -1,
  // 구조체에 붙는 마감 — 천장 티바·덕트·기둥 걸레받이·벽 트림
  CEIL_RIB: 1, DUCT: 1, COL_SKIRT: 1, ST_TRIM: 1, PF_DARKWALL: 1,
  STAIR_TREAD: 1, HQ_PARAPET: 1, ESC_SKIRT: 1,
  // 바닥 마모 자국은 점자블록·줄눈(2) 밑에 깔린다
  WEAR_LOW: 1, WEAR_HIGH: 1,
  STAIR_NOSE: 2, HQ_PARAPET_CAP: 2, ENTR_STEEL: 2,
  // 점자블록은 두 종류가 맞닿는다 — 경고(점형)를 유도(선형) 위에 둔다
  ST_TACT_WARN: 3,
  /**
   * 사인 적층: 판 → 어두운 문안 블록 → 광고 바탕 → 그래픽.
   *
   * `SIGN_DARK` 를 판보다 **뒤**(케이스로 보고 1)에 뒀다가 되돌렸다. 전광판 포스터를
   * 렌더해 보니 안쪽 문안 막대가 통째로 사라졌다 — `SIGN_DARK` 는 케이스만이 아니라
   * **밝은 판 위에 얹히는 어두운 문안 블록**으로도 쓰인다. 뒤로 밀면 글이 안 읽힌다.
   * "해석이 갈리면 두 안을 렌더해 본다"가 여기서 값을 했다.
   */
  SIGN_PLATE: 2, SIGN_INFO: 2, MAP_FACE: 2, AD_PANEL: 2,
  SIGN_DARK: 3, SIGN_EXIT: 3, AD_PANEL2: 4, AD_PANEL3: 5,
  // 노선 띠는 벽에도 사인 판에도 얹힌다 — 실측(승강장 1.5 m 앞)에서 `SIGN_PLATE` 와
  // 정확히 같은 평면이었다. 사인 적층 전체보다 앞에 둔다.
  LINE2_GRN: 6, LINE_BADGE_2: 6, LINE_BADGE_A: 6, LINE_BADGE_K: 6,
  // 글자는 언제나 맨 앞이다. 이 게임에서 사인 가독성은 룩보다 우선이다.
  //
  // ⚠ 이 값을 사인 판(`SIGN_DARK` 3)보다 크게 벌리지 말 것. 매달림 사인은 판 두께가
  //    9 cm 인데 양면 글자가 각각 판 밖 1 cm 에 있다. 층 간격을 키우면 **반대편 글자가
  //    판을 뚫고 비쳐** 두 문안이 겹쳐 보인다 — 바닥 사인을 고치려고 9 로 올렸다가
  //    "화장실" 위에 뒤집힌 "승강장"이 겹쳐 나왔다. 바닥 사인은 층이 아니라
  //    `hq_fixups.floor_sign_border()` 에서 테두리를 걷어내는 쪽으로 푼다.
  TXT_DARK: 7, EXIT_TXT: 7,
  // ⚠ `TXT_WHITE` 만 3(사인 판과 같은 층)이다. 7 로 두면 오프셋이 **판 두께를 이겨**
  //    매달림 사인의 반대편 문안이 앞면으로 비친다 — 판을 0.14 m 로 키워도 뚫렸다
  //    (실측: 픽은 판을 맨 앞으로 주는데 화면에는 뒤쪽 글자가 그려진다).
  //    글자는 판 표면에서 12 mm 앞에 **실제로** 놓여 있으므로 같은 층이면 지오메트리가
  //    순서를 정하고, 자기 면 글자는 그대로 읽히면서 반대편은 판에 가려진다.
  TXT_WHITE: 3,
}

const depthLayerOf = (name: string): number =>
  DEPTH_LAYER[name] ?? (DECAL_MATERIALS.has(name) ? 2 : 0)

/**
 * 스스로 빛나는 면 — 조명기구와 백라이트 광고판.
 *
 * 툰 셰이딩은 면의 법선으로 밝기를 정한다. 그래서 **아래를 향한 천장 조명이
 * 천장보다 어둡게** 나왔다 — 조명이 조명으로 안 읽힌다. 실제 역에서 시선을 끄는
 * 건 연속 라인 조명과 백라이트 광고판이고, 그 둘이 어두우면 실내가 통째로 죽는다.
 * 광원은 음영을 받지 않는 게 맞으므로 조명 영향이 없는 basic 머티리얼로 그린다.
 */
const SELF_LIT_MATERIALS = new Set([
  'FIXTURE', 'AD_PANEL', 'AD_PANEL2', 'AD_PANEL3', 'VM_LIGHT', 'CHG_SCR', 'ESC_COMB',
  'LED_AMBER', 'SH_GREEN', 'SH_RED',
  // 가로 상가 간판. Blender 에서 발광인데 여기 없으면 툰으로 칠해져 **꺼진 판**이 된다
  // (계단통 조명에서 이미 한 번 물린 함정이다 — 새 발광 재질은 반드시 여기에 올린다).
  'BLD_SIGN_0', 'BLD_SIGN_1', 'BLD_SIGN_2', 'BLD_SIGN_3', 'BLD_SIGN_4',
  // 바닥 유도 사인 판. Blender 에서 발광 2.5 인데 여기 없어서 툰으로 칠해졌고,
  // 짙은 남색(0.02,0.12,0.35)이 어두운 단계로 떨어져 **바닥에 검은 구멍**처럼 보였다.
  'SIGN_INFO',
  // 사인 글자. 발광 띠 위에 툰 셰이딩된 흰 글자를 얹으면 회색이 되어 안 읽힌다.
  // 안내 사인은 읽히는 게 존재 이유다.
  'TXT_WHITE',
  // 승강장 전광판 **문안**. 툰으로 칠하면 안 된다 — 7 m 만 떨어져도 주황 글자가
  // 검게 죽어 케이스가 통짜 검은 상자로 보였다. 발광 재질 누락은 이걸로 네 번째다.
  // ⚠ 바탕 띠(`HQ_PIDS_BAND`)는 **일부러 뺀다.** 같이 발광시키면 띠의 번짐이
  //   글자를 덮어 주황 덩어리가 된다. 실사 전광판도 어두운 바탕에 밝은 글자다.
  'HQ_PIDS_TXT',
  // 객실 형광 라인. 승강장에서 열차 안이 **밝게** 보여야 "탈 수 있는 칸"으로 읽힌다.
  // ⚠ 천장판(`TR_INNER`)은 **일부러 뺐다.** 같이 발광시키면 음영이 사라져 객실 위쪽
  //   절반이 흰 공백으로 날아간다(실제로 그렇게 나와서 되돌렸다) — 전광판 바탕 띠를
  //   뺀 것과 같은 이유다. 빛은 기구가 내고 천장은 그 빛을 받는 면이어야 한다.
  // `GLOW_EXCLUDE` 에도 올려 뒀다 — 열차가 움직여서 글로우 판이 못 따라온다.
  'TR_LIGHT',
])

/**
 * 진짜 거울. 이 머티리얼로 병합된 면은 Mesh 대신 `Reflector`로 만든다.
 *
 * Reflector는 프레임마다 씬을 한 번 더 그려 반사 텍스처를 만든다 — 비싸다.
 * 그래서 **면 3장(남·여·다목적)을 한 오브젝트로 합쳐 패스를 하나로 묶고**,
 * 화장실에서 멀어지면 `visible=false`로 꺼서 그 패스 자체를 건너뛴다.
 */
const MIRROR_MATERIAL = 'WC_MIRROR'
/** 이 거리 밖에서는 반사를 끈다. 화장실 안에서만 보이면 된다. */
const MIRROR_RANGE = 14

/**
 * 접촉 그림자를 만들지 **않을** 오브젝트.
 *
 * 그림자는 월드 좌표로 굽는다 — 움직이는 것에 붙이면 물체가 떠난 자리에 그림자만 남는다.
 * 열차(Z5_TRAIN 존 전체)는 아예 제외하고, 여기서는 존 안에서 움직이는 것들을 잡는다.
 *  · `Z*_ITM*` 줍는 아이템 (사라진다)
 *  · `Z4_elev_car` 엘리베이터 칸 (오르내린다)
 */
const NO_SHADOW_NAME = /(^Z\d_ITM|elev_car)/i

/** 접촉 그림자를 만들지 않을 머티리얼 — 유리·발광면·바닥 데칼은 접지 부품이 아니다 */
const noShadowMaterial = (name: string): boolean =>
  GLASS_MATERIALS.has(name) || SELF_LIT_MATERIALS.has(name) || DECAL_MATERIALS.has(name)

const baseColor = (m: Material | Material[]): number => {
  const one = (Array.isArray(m) ? m[0] : m) as MeshStandardMaterial | undefined
  const tint = one?.name ? MATERIAL_TINT[one.name] : undefined
  if (tint !== undefined) return tint
  return one?.color ? one.color.getHex() : 0xcccccc
}

/**
 * 씬에서 **빼는 노드** — 이름으로 지운다.
 *
 * `Z2_OBJ16_umb0..5` 는 우산꽂이에 꽂힌 우산 **자리표시자**다. 발광 재질(SH_GREEN)로
 * 만들어져 있어 형광 초록 막대 여섯 개로 보였다(디렉터 지적 2026-08-06).
 * 진짜 우산 메시(`items.glb ITM09_Umbrella`)를 `data/decor.ts` + `render/props.ts` 가
 * **같은 좌표에** 세운다.
 *
 * ⚠ 왜 GLB 를 다시 굽지 않았나 — 역 GLB 재빌드는 Blender 왕복이고, 그동안 이 파일이
 *   화면의 진실이다. 이름 하나를 여기서 빼는 편이 되돌리기도 쉽다.
 *   대신 **이 목록이 곧 빚**이다: 다음 역 리빌드 때 노드 자체를 지우고 여기를 비운다.
 *
 * 이름이 사라져도(에셋 갱신) 조용히 통과한다 — 없는 것을 안 그리는 건 실패가 아니다.
 */
const NODE_DROP: ReadonlySet<string> = new Set([
  'Z2_OBJ16_umb0', 'Z2_OBJ16_umb1', 'Z2_OBJ16_umb2',
  'Z2_OBJ16_umb3', 'Z2_OBJ16_umb4', 'Z2_OBJ16_umb5',
])

// ─────────────────────────── 병합 ───────────────────────────

type Bucket = { geos: BufferGeometry[]; color: number }

/**
 * 씬 하나를 훑어 정적 메시는 머티리얼별로 모으고, 동적 메시는 그대로 넘긴다.
 *
 * @param splitOpp 켜면 `B_` 접두사가 붙은 메시(반대 방면 열차 복제본, 디렉터 지시)를
 *   `oppBuckets`/`oppOverhead` 로 따로 모은다 — 반대 방면 열차 몸체는 본편과
 *   **다른 x** 로 움직여야 하므로 같은 머티리얼이라도 한 버킷에 섞이면 안 된다.
 */
const collect = (
  scene: Object3D,
  glow: GlowQuad[],
  glowOverhead: GlowQuad[],
  shadows: ShadowQuad[] | null,
  splitOpp = false,
): {
  buckets: Map<string, Bucket>; overhead: Map<string, Bucket>; dynamics: Mesh[]
  oppBuckets: Map<string, Bucket>; oppOverhead: Map<string, Bucket>
} => {
  const buckets = new Map<string, Bucket>()
  const overhead = new Map<string, Bucket>()
  const oppBuckets = new Map<string, Bucket>()
  const oppOverhead = new Map<string, Bucket>()
  const dynamics: Mesh[] = []
  scene.updateWorldMatrix(true, true)

  scene.traverse((o) => {
    const m = o as Mesh
    if (!m.isMesh || !m.geometry) return
    // 발광 판(glow)도 이 아래에서 뜬다 — 여기서 걸러야 막대의 **빛까지** 같이 사라진다
    if (NODE_DROP.has(m.name)) return
    const matName = Array.isArray(m.material) ? m.material[0]?.name ?? '' : m.material.name

    if (isDynamic(m)) { dynamics.push(m); return }

    const geo = m.geometry.clone()
    geo.applyMatrix4(m.matrixWorld)
    // 병합하려면 애트리뷰트 구성이 같아야 한다. UV는 안 쓰므로 버린다.
    // (`USE_LIGHTMAP` 이 켜지면 `uv` 는 남긴다 — 라이트맵 좌표가 거기 실려 온다.)
    if (!USE_LIGHTMAP) geo.deleteAttribute('uv')
    geo.deleteAttribute('uv1')
    geo.deleteAttribute('tangent')
    const isUp = isOverhead(m.name, matName)
    const opp = splitOpp && m.name.startsWith('B_')
    const into = opp ? (isUp ? oppOverhead : oppBuckets) : (isUp ? overhead : buckets)

    /**
     * 글로우 판은 **병합 전에** 뜬다. 병합 후에는 `merged:AD_PANEL` 하나가 존 전체라
     * 부품 위치를 되찾을 방법이 없다. 소스 메시도 이미 조인돼 있으므로
     * (Z5 AD_PANEL 한 메시가 97~127 m) 연결 요소로 한 번 더 쪼개야 부품이 나온다.
     */
    if (SELF_LIT_MATERIALS.has(matName) && !GLOW_EXCLUDE.has(matName)) {
      glowQuadsFrom(
        splitIslands(geo), baseColor(m.material), GLOW_GAIN[matName] ?? 1,
        isUp ? glowOverhead : glow,
      )
    }

    // 접촉 그림자도 같은 이유로 병합 전, 섬 단위로 뜬다.
    // 메시 bbox 로 미리 걸러 건축 본체에 union-find 를 돌리지 않는다.
    if (shadows && !isUp && !noShadowMaterial(matName) && !NO_SHADOW_NAME.test(m.name)) {
      geo.computeBoundingBox()
      if (geo.boundingBox && mayGround(geo.boundingBox)) {
        for (const island of splitIslands(geo, 30_000)) shadowQuadFrom(island, shadows)
      }
    }

    const key = matName || 'default'
    const b = into.get(key)
    if (b) b.geos.push(geo)
    else into.set(key, { geos: [geo], color: baseColor(m.material) })
  })
  return { buckets, overhead, dynamics, oppBuckets, oppOverhead }
}

/**
 * 병합된 평면들을 반사면으로 바꾼다.
 *
 * `Reflector`가 요구하는 두 가지를 맞춰야 한다.
 *  1. **로컬 +Z 가 거울 법선.** 병합 지오메트리는 월드 좌표라 법선이 제멋대로다.
 *  2. **반사 평면은 오브젝트의 월드 "위치"를 지난다.** 지오메트리만 옮겨 놓고
 *     오브젝트를 원점에 두면 반사면이 원점에 생겨 **벽 너머가 비친다** — 실제로 그랬다.
 *
 * 그래서 지오메트리를 중심으로 옮기고(local = q⁻¹·(world − center)),
 * 오브젝트를 그 중심에 세운다.
 */
const makeMirror = (geo: BufferGeometry, color: number): Reflector | null => {
  geo.computeVertexNormals()
  const na = geo.getAttribute('normal')
  if (!na || na.count === 0) return null
  const normal = new Vector3(na.getX(0), na.getY(0), na.getZ(0)).normalize()
  geo.computeBoundingBox()
  const center = geo.boundingBox!.getCenter(new Vector3())
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), normal)
  geo.translate(-center.x, -center.y, -center.z)
  geo.applyQuaternion(q.clone().invert())
  const mirror = new Reflector(geo, {
    // 화장실 거울은 작고 가까이서만 본다 — 512면 충분하고 패스 비용이 1/4이다
    textureWidth: 512,
    textureHeight: 512,
    color: new Color(color),
  })
  mirror.position.copy(center)
  mirror.quaternion.copy(q)
  mirror.name = `mirror:${MIRROR_MATERIAL}`
  return mirror
}

/**
 * 존 라이트맵 아틀라스를 읽는다. 없으면 `null` — 라이트맵 없이도 그대로 돌아간다.
 *
 * `flipY = false` 가 필수다. glTF 의 UV 원점은 좌상단이고 three 의 기본 텍스처는
 * 상하를 뒤집는다 — 놓치면 조명 웅덩이가 위아래 반대로 찍힌다.
 * 베이크가 선형값을 sRGB 로 인코딩해 저장하므로 three 가 디코딩하도록 `SRGBColorSpace`.
 */
const loadLightmap = (
  loader: TextureLoader, baseUrl: string, zone: string,
): Promise<Texture | null> =>
  loader
    .loadAsync(`${baseUrl}models/map/lightmap/LM_${zone}.webp`)
    .then((t) => {
      t.flipY = false
      t.colorSpace = SRGBColorSpace
      t.channel = 0
      t.needsUpdate = true
      return t
    })
    .catch(() => null)

const mergeBuckets = (
  buckets: Map<string, Bucket>, into: Group, lightMap: Texture | null = null,
): void => {
  for (const [name, b] of buckets) {
    const merged = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false)
    if (!merged) continue
    if (name === MIRROR_MATERIAL) {
      const mirror = makeMirror(merged, b.color)
      if (mirror) {
        into.add(mirror)
        if (b.geos.length > 1) for (const g of b.geos) g.dispose()
        continue
      }
    }
    const glass = GLASS_MATERIALS.has(name)
    const layer = depthLayerOf(name)
    /**
     * ⚠ 자체발광과 유리에는 라이트맵을 **주지 않는다.**
     *
     * `MeshBasicMaterial` 은 라이트맵을 곱하는 게 아니라 상수 1.0 을 **대체**한다.
     * 넘기면 사인·광고판이 구운 그림자만큼 어두워진다. 안내 사인이 전부 자체발광이라
     * 이 한 줄로 "구석이 어두워져 사인이 안 읽힌다"는 위험이 구조적으로 사라진다.
     * 유리는 뒤가 비쳐야 하므로 정적 조명이 의미가 없다.
     */
    const lm = glass || SELF_LIT_MATERIALS.has(name) ? null : lightMap
    const mat = glass
      ? toonMat(b.color, { transparent: true, opacity: 0.34 })
      : SELF_LIT_MATERIALS.has(name)
        ? new MeshBasicMaterial({
            color: new Color(b.color),
            toneMapped: false,
            ...depthOffset(layer),
          })
        : toonMat(b.color, { depthLayer: layer, lightMap: lm })
    const mesh = new Mesh(merged, mat)
    // 유리는 나중에 그린다 — 뒤에 있는 열차·통로가 먼저 깊이버퍼에 들어가야 비쳐 보인다
    if (glass) mesh.renderOrder = 2
    mesh.name = `merged:${name}`
    into.add(mesh)
    if (b.geos.length > 1) for (const g of b.geos) g.dispose()
  }
}

// ─────────────────────────── 동적 부품 ───────────────────────────

/**
 * 개찰기 플랩 문 한 장.
 *
 * `openAngle` 은 **경첩 기준** 열린 각(rad). 로더가 월드 트랜스폼을 지오메트리에 굽기
 * 때문에(`bakeGeo`) Blender 에서 원점을 경첩에 두어도 익스포트 뒤에 사라진다 —
 * 그래서 여기서 다시 경첩으로 원점을 옮기고 노드 위치로 되돌린다.
 */
type Flap = { gate: number; node: Object3D; openAngle: number }
/** 동적 글로우 메시 안에서 이 부품이 차지하는 판 구간 [시작, 개수] */
type GlowRange = readonly [number, number]
type SignFace = { gate: number; mat: MeshBasicMaterial; glow: GlowRange }
/** 같은 진행률로 함께 움직이는 문 묶음 — 좌/우 각각 한 덩어리로 병합한다 */
type DoorBank = { left: Mesh | null; right: Mesh | null }

/**
 * 상태 표시등을 **자체 발광 머티리얼로 교체**한다.
 *
 * 원본은 MeshStandardMaterial이라 색을 바꿔도 조명·톤매핑을 거치면서 뭉개진다
 * (초록으로 칠한 사인이 화면에서는 살구색으로 나왔다).
 * 표지판은 실제로도 백라이트 사인이므로 조명 영향을 받지 않는 게 맞고,
 * 무엇보다 **이 색이 이 게임의 유일한 판단 근거**라 정확해야 한다.
 * 머티리얼은 게이트마다 개별로 만든다 — 공유하면 하나를 칠할 때 전부 물든다.
 */
const emissiveOf = (o: Object3D, color: number): MeshBasicMaterial => {
  const mat = new MeshBasicMaterial({ color: new Color(color), toneMapped: false })
  ;(o as Mesh).material = mat
  return mat
}

/** 글로우 색 계산용 스크래치 — 프레임마다 Color 를 새로 만들지 않는다 */
const tintTmp = new Color()

const worldX = (o: Object3D): number => {
  o.updateWorldMatrix(true, false)
  return new Vector3().setFromMatrixPosition(o.matrixWorld).x
}

const worldZ = (o: Object3D): number => {
  o.updateWorldMatrix(true, false)
  return new Vector3().setFromMatrixPosition(o.matrixWorld).z
}

/**
 * 플랩 문의 원점을 **경첩**으로 옮기고 열린 각을 돌려준다.
 *
 * 문은 닫힌 자세로 들어온다 — 통로를 가로질러(월드 z 로 길게) 서 있고 진행 방향(x)으로 얇다.
 * 열리면 경첩을 축으로 90° 돌아 하우징에 나란히 눕는다.
 *
 * 경첩은 **게이트 중앙에서 먼 쪽** 세로 모서리다. 이름의 N/S 로 정하지 않는다 —
 * 좌표계 규약(게임 y → three −z)이 한 번이라도 바뀌면 조용히 뒤집히고,
 * 그러면 문이 하우징 **안쪽**으로 열려 눈앞에서 사라진다.
 */
const hingeAt = (node: Mesh, gateId: number): number => {
  const gate = GATES.find((g) => g.id === gateId)
  node.geometry.computeBoundingBox()
  const bb = node.geometry.boundingBox
  if (!gate || !bb) return 0
  const centerZ = -gate.y
  const hz = Math.abs(bb.max.z - centerZ) > Math.abs(bb.min.z - centerZ) ? bb.max.z : bb.min.z
  const hx = (bb.min.x + bb.max.x) / 2
  node.geometry.translate(-hx, 0, -hz)
  node.position.set(hx, 0, hz)
  // 경첩을 원점으로 옮긴 뒤 문이 뻗은 방향(±z)이 회전 부호를 정한다.
  // +z 로 뻗으면 +90°, −z 면 −90° 에서 문이 +x(진행 방향)에 눕는다.
  return (centerZ - hz >= 0 ? 1 : -1) * (Math.PI / 2)
}

/** 가장 가까운 가동문 중심 x. 패널이 어느 쪽으로 열려야 하는지 정한다. */
const nearestDoor = (x: number): number =>
  DOOR_XS.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a), DOOR_XS[0] as number)

export type Station = Readonly<{
  root: Group
  sync(s: GameState, dtSec: number, greenLight: boolean, lightRemainSec: number): void
  /** 천장·지붕 표시 여부. 1인칭이면 true, 쿼터뷰면 false */
  setOverhead(on: boolean): void
  stats: Readonly<{ merged: number; dynamic: number; lightmaps: number }>
}>

export const loadStation = async (
  baseUrl: string,
  // 게이트 기호를 카메라로 빌보드하던 시절의 인자. 기호가 고정 방향이 되면서 안 쓰지만
  // 호출부(main.ts)의 시그니처라 남겨 둔다.
  _camera: Camera,
  onProgress?: (done: number, total: number) => void,
): Promise<Station> => {
  const loader = new GLTFLoader()
  // 라이트맵은 GLB 와 **같이** 받는다. 순차로 받으면 존 6개에 왕복이 6번 더 붙는다.
  const texLoader = new TextureLoader()
  let done = 0
  const scenes = await Promise.all(
    ZONE_FILES.map(async (z) => {
      const [g, lm] = await Promise.all([
        loader.loadAsync(`${baseUrl}models/map/${z}.glb`),
        loadLightmap(texLoader, baseUrl, z),
      ])
      onProgress?.(++done, ZONE_FILES.length)
      return [z, g.scene, lm] as const
    }),
  )
  // 라이트맵이 몇 존이나 붙었는지 남긴다. 사이드카 없이 익스포트하면 0 이 되는데,
  // 그때는 조용히 라이트맵 없는 예전 룩으로 떨어진다 — 티가 안 나므로 수를 찍어 둔다.
  const lightmapCount = scenes.filter((s) => s[2] !== null).length

  const root = new Group()
  root.name = 'station'

  /**
   * 존별 그룹. 병합 메시는 존 전체를 덮는 바운딩 박스를 갖기 때문에
   * 프러스텀 컬링이 전혀 걸리지 않는다 — 어느 존에 서 있든 맵 전체가 그려진다.
   * 그래서 **존 단위로 직접 껐다 켠다.** 안개 far(약 90m) 밖은 어차피 안 보인다.
   */
  const zoneGroups: { group: Group; box: Box3 }[] = []
  /** 존별 천장 서브그룹. 존 그룹 아래 두면 거리 컬링에 같이 걸린다. */
  const overheadGroups: Group[] = []
  let overheadOn = true
  const trainGroup = new Group()
  trainGroup.name = 'station:train'
  /** 반대 방면 열차(디렉터 지시) — 본편과 다른 x 로 움직이므로 몸체를 별도 그룹에 둔다 */
  const train2Group = new Group()
  train2Group.name = 'station:train2'

  const flaps: Flap[] = []
  const signs: SignFace[] = []
  const lamps: SignFace[] = []
  // 신호등은 **여러 기**다. 횡단보도 양단에 보행등이 서고 차도에 차량등이 따로 선다.
  // 예전엔 `let tlRed`(하나)라 마지막으로 로드된 등만 색이 바뀌었다 —
  // 등을 늘리는 순간 나머지는 계속 빨간불로 굳는다.
  const tlReds: MeshBasicMaterial[] = []
  const tlGreens: MeshBasicMaterial[] = []
  const tlRedGlows: GlowRange[] = []
  const tlGreenGlows: GlowRange[] = []
  const tlCount: Object3D[] = []

  /** 글로우 판 목록 — 맵 전체를 한 메시로 굽는다(드로우 콜 3개). glow.ts 주석 참고. */
  const glowQuads: GlowQuad[] = []
  const glowOverheadQuads: GlowQuad[] = []
  const dynGlowQuads: GlowQuad[] = []
  /** 접촉 그림자 판 — 맵 전체를 한 메시로(드로우 콜 1개). contact-shadows.ts 주석 참고. */
  const shadowQuads: ShadowQuad[] = []

  /** 상태에 따라 색이 바뀌는 발광 부품의 글로우를 등록하고 그 구간을 돌려준다. */
  const addDynGlow = (node: Mesh, colorHex: number, gain: number): GlowRange => {
    const start = dynGlowQuads.length
    const pos = node.geometry.getAttribute('position')
    if (!pos) return [start, 0]
    glowQuadsFrom(
      [new Box3().setFromBufferAttribute(pos as never)], colorHex, gain, dynGlowQuads,
    )
    return [start, dynGlowQuads.length - start]
  }
  /** 사인 면의 월드 박스 + 정면 법선. 사인이 아래로 기울어져 있어서
   *  단순히 −x로 밀면 프레임 안에 파묻힌다 — 실제 법선을 따라 띄워야 한다. */
  const signBoxes = new Map<number, Box3>()
  const psdGeo: { left: BufferGeometry[]; right: BufferGeometry[] } = { left: [], right: [] }
  const trainGeo: { left: BufferGeometry[]; right: BufferGeometry[] } = { left: [], right: [] }
  /**
   * 차문의 **창**만 따로 받는 뱅크.
   *
   * 문짝과 한 덩어리로 합치면 뱅크의 단색(0x6f8797)으로 칠해져 **불투명한 판**이 된다.
   * 그러면 닫힌 열차가 통짜 회색 상자로 읽히고, 객실을 지어 넣어도 밖에서 안 보인다.
   * 유리 뱅크를 하나 더 두는 값(드로우 콜 2개)이 그 정보값보다 싸다 —
   * 안전문 유리를 투명으로 둔 이유(`GLASS_MATERIALS` 주석)와 같은 판단이다.
   */
  const dwinGeo: { left: BufferGeometry[]; right: BufferGeometry[] } = { left: [], right: [] }
  /** 반대 방면 안전문·차문(`B_` 접두사) — 본편과 다른 doorProgress 로 슬라이드한다 */
  const psdGeo2: { left: BufferGeometry[]; right: BufferGeometry[] } = { left: [], right: [] }
  const trainGeo2: { left: BufferGeometry[]; right: BufferGeometry[] } = { left: [], right: [] }
  const dwinGeo2: { left: BufferGeometry[]; right: BufferGeometry[] } = { left: [], right: [] }

  let mergedCount = 0
  let dynamicCount = 0

  const bakeGeo = (m: Mesh): BufferGeometry => {
    m.updateWorldMatrix(true, false)
    const geo = m.geometry.clone()
    geo.applyMatrix4(m.matrixWorld)
    geo.deleteAttribute('uv')
    geo.deleteAttribute('uv1')
    geo.deleteAttribute('tangent')
    return geo
  }

  for (const [zone, scene, lightMap] of scenes) {
    const isTrain = zone === 'Z5_TRAIN'
    const group = isTrain ? trainGroup : new Group()
    group.name = `station:${zone}`
    // 열차는 매 프레임 x 로 움직인다 — 월드 좌표 그림자를 붙이면 떠난 자리에 그림자만 남는다
    const { buckets, overhead, dynamics, oppBuckets, oppOverhead } =
      collect(scene, glowQuads, glowOverheadQuads, isTrain ? null : shadowQuads, isTrain)
    const before = group.children.length
    mergeBuckets(buckets, group, lightMap)
    const oGroup = new Group()
    oGroup.name = `overhead:${zone}`
    mergeBuckets(overhead, oGroup, lightMap)
    if (oGroup.children.length > 0) { group.add(oGroup); overheadGroups.push(oGroup) }
    mergedCount += group.children.length - before + oGroup.children.length

    // 반대 방면 열차 몸체(`B_` 접두사) — 본편 `trainGroup` 이 아니라 `train2Group` 에 쌓는다
    if (isTrain) {
      const before2 = train2Group.children.length
      mergeBuckets(oppBuckets, train2Group, lightMap)
      const oGroup2 = new Group()
      oGroup2.name = 'overhead:Z5_TRAIN_opp'
      mergeBuckets(oppOverhead, oGroup2, lightMap)
      if (oGroup2.children.length > 0) { train2Group.add(oGroup2); overheadGroups.push(oGroup2) }
      mergedCount += train2Group.children.length - before2 + oGroup2.children.length
    }

    for (const m of dynamics) {
      const matName = Array.isArray(m.material) ? m.material[0]?.name ?? '' : m.material.name
      const opp = m.name.startsWith('B_')

      // ── 안전문 · 차문: 전부 같은 doorProgress로 움직이므로 좌/우 두 덩어리로 합친다.
      //    개별로 두면 이 둘만으로 드로우 콜 96개다. `B_` 접두사(반대 방면)는 별도
      //    뱅크(`psdGeo2`/`trainGeo2`)로 갈라 본편과 다른 doorProgress 로 움직인다.
      if (/^(B_)?Z5_psd_door_/.test(m.name) || /^(B_)?(TR_door_|TR_dwin_)/.test(m.name)) {
        const x = worldX(m)
        // 문짝은 **좌/우 두 장**이고 원점이 각자 자기 쪽에 있다(`tools/hq_train.py`).
        // 한 장짜리 슬래브였을 때는 원점이 개구 중심이라 `x >= x` 가 늘 참이 되어
        // 32짝이 전부 'right' 로 몰렸고, 그래서 문이 반만 열렸다.
        const side = x >= nearestDoor(x) ? 'right' : 'left'
        const isPsd = /Z5_psd_door_/.test(m.name)
        const isWin = /^(B_)?TR_dwin_/.test(m.name)
        const geoSet = isPsd
          ? (opp ? psdGeo2 : psdGeo)
          : isWin ? (opp ? dwinGeo2 : dwinGeo) : (opp ? trainGeo2 : trainGeo)
        geoSet[side].push(bakeGeo(m))
        dynamicCount++
        continue
      }

      const node = new Mesh(bakeGeo(m), m.material as Material)
      node.name = m.name
      ;(isTrain && opp ? train2Group : group).add(node)
      dynamicCount++

      const flapM = /^Z3_GATE_G(\d)_([NS])_flap$/.exec(m.name)
      if (flapM) {
        // 하우징과 같은 회색이면 닫힌 문이 **벽으로도 문으로도 안 읽힌다.**
        // 실물 플랩은 반투명 아크릴이라 금속 본체와 확실히 구분된다 — 그 대비만 가져온다.
        node.material = toonMat(0xbfe4ee)
        const gate = Number(flapM[1])
        flaps.push({ gate, node, openAngle: hingeAt(node, gate) })
        continue
      }
      const signM = /^Z3_sign_G(\d)_face$/.exec(m.name)
      if (signM) {
        signs.push({
          gate: Number(signM[1]), mat: emissiveOf(node, 0x00a84d),
          // 게이트 사인은 멀리서 "어느 게이트가 살아 있나"를 읽는 유일한 근거다.
          // 백라이트가 번져 보여야 통로 끝에서도 초록/빨강이 먼저 눈에 든다.
          glow: addDynGlow(node, 0x00a84d, 1.35),
        })
        signBoxes.set(Number(signM[1]), new Box3().setFromObject(node))
        continue
      }
      // 바닥 램프는 **이름으로만** 잡는다. LED_* 머티리얼로 잡으면 게이트 상판까지 물든다
      const lampM = /^Z3_GATE_G(\d)_floorlamp$/.exec(m.name)
      if (lampM) {
        lamps.push({
          gate: Number(lampM[1]), mat: emissiveOf(node, 0x00a84d),
          // 바닥 램프는 발밑을 물들이는 게 실물과 같다 — 개찰구 앞에서 진입선을 읽게 해 준다
          glow: addDynGlow(node, 0x00a84d, 1.6),
        })
        continue
      }
      if (matName === 'TL_RED') {
        tlReds.push(emissiveOf(node, 0xe5484d))
        tlRedGlows.push(addDynGlow(node, 0xe5484d, 1.5))
      } else if (matName === 'TL_GRN') {
        tlGreens.push(emissiveOf(node, 0x00a84d))
        tlGreenGlows.push(addDynGlow(node, 0x00a84d, 1.5))
      } else if (matName === 'TL_COUNT') tlCount.push(node)
    }

    if (!isTrain) {
      root.add(group)
      zoneGroups.push({ group, box: new Box3().setFromObject(group) })
    }
  }

  // 거울은 프레임마다 씬을 한 번 더 그린다. 화장실 근처가 아니면 꺼서 그 패스를 건너뛴다.
  const mirrors: { obj: Object3D; center: Vector3 }[] = []
  root.traverse((o) => {
    if (o.name.startsWith('mirror:')) {
      mirrors.push({ obj: o, center: new Box3().setFromObject(o).getCenter(new Vector3()) })
    }
  })

  const bank = (
    geos: { left: BufferGeometry[]; right: BufferGeometry[] },
    color: number, parent: Group, glass = false,
  ): DoorBank => {
    const one = (list: BufferGeometry[]): Mesh | null => {
      if (list.length === 0) return null
      const g = list.length === 1 ? list[0] : mergeGeometries(list, false)
      if (!g) return null
      const mesh = new Mesh(g, glass ? toonMat(color, { transparent: true, opacity: 0.34 }) : toonMat(color))
      if (glass) mesh.renderOrder = 2
      mesh.frustumCulled = false
      parent.add(mesh)
      return mesh
    }
    return { left: one(geos.left), right: one(geos.right) }
  }

  // 안전문은 승강장에 고정, 차문은 열차와 함께 움직인다
  const z5 = zoneGroups.find((z) => z.group.name === 'station:Z5_PLATFORM')?.group ?? root
  const psdBank = bank(psdGeo, 0xc6ced4, z5, true)
  const trainBank = bank(trainGeo, 0x6f8797, trainGroup)
  const dwinBank = bank(dwinGeo, 0xa9c3cf, trainGroup, true)
  root.add(trainGroup)
  mergedCount += 6

  // 반대 방면 안전문·차문 — 같은 식, 별도 뱅크로 `train2Group` 에 붙인다
  const psdBank2 = bank(psdGeo2, 0xc6ced4, z5, true)
  const trainBank2 = bank(trainGeo2, 0x6f8797, train2Group)
  const dwinBank2 = bank(dwinGeo2, 0xa9c3cf, train2Group, true)
  root.add(train2Group)
  mergedCount += 6

  // ── 색각 보조 기호 — GLB 사인 면 앞에 ▲ / ✕ 를 얹는다.
  //    색만으로 구분하면 이 게임의 유일한 판단 근거가 색각 이상 플레이어에게서 사라진다.
  //    막대 30장을 개별 메시로 두면 Z3에서만 드로우 콜 30개다 → 인스턴싱 2개로 묶는다.
  // 배경은 상태색(초록/적색), 기호는 흰색. 실제 개찰구 사인과 같은 대비 구조다.
  // 기호를 상태색으로 칠하면 배경에 묻혀 형태가 안 읽힌다 — 색이 아니라 **형태**가 정보다.
  const SYMBOL = 0xf7f7f4
  // ○ = 통행 가능 / ✕ = 폐쇄. 한국 지하철 개찰구 상부 표시의 실제 규약이다.
  // 처음엔 ▲(막대 3개)였는데 화살표는 "저쪽으로 가라"는 뜻이라 의미가 어긋난다 —
  // 이 표시가 말하는 것은 방향이 아니라 **이 게이트를 지나갈 수 있는가**다.
  const CROSS_BARS = [Math.PI / 4, -Math.PI / 4] as const
  const flatMat = (c: number): MeshBasicMaterial =>
    new MeshBasicMaterial({ color: new Color(c), toneMapped: false, side: DoubleSide })

  const gateOrder = GATES.filter((g) => signBoxes.has(g.id))
  // 링은 막대로 못 만든다. 바깥지름 0.42 는 사인 판 높이(0.44 m)에 맞춘 값이고,
  // ✕(막대 0.62 를 ±45°로 겹치면 사각 0.44)와 화면상 크기가 같아진다.
  const arrows = new InstancedMesh(new RingGeometry(0.12, 0.21, 32), flatMat(SYMBOL),
    Math.max(1, gateOrder.length))
  const crosses = new InstancedMesh(new PlaneGeometry(0.62, 0.12), flatMat(SYMBOL),
    Math.max(1, gateOrder.length * CROSS_BARS.length))
  arrows.frustumCulled = false
  crosses.frustumCulled = false
  const z3Group = zoneGroups.find((z) => z.group.name === 'station:Z3_GATES')?.group ?? root
  z3Group.add(arrows, crosses)
  mergedCount += 2

  const symMat = new Matrix4()
  const HIDE = new Vector3(0, 0, 0)
  const ONE = new Vector3(1, 1, 1)

  /**
   * 기호는 **고정 방향**이다 — 게이트 열을 따라 들어오는 쪽(서쪽)을 본다.
   *
   * 예전에는 매 프레임 카메라로 빌보드했다. 시선을 돌릴 때마다 ○·✕ 가 같이 돌아
   * 역에 붙은 표지가 아니라 화면에 뜬 UI 로 보였다. 실제 개찰구 상부 표시는 고정이다.
   *
   * 빌보드를 쓴 이유였던 "사인이 기울어져 있어 고정 오프셋으로는 파묻힌다"는
   * 지금 지오메트리에서는 성립하지 않는다. 실측하면 `Z3_sign_G*_face` 는
   * 법선이 정확히 ±x 인 평판(x 59.905~59.935 · 폭 1.16 · 높이 0.44)이고,
   * 케이스(`SIGN_DARK` x 59.94~60.06)는 **면보다 뒤**에 있어 서쪽은 비어 있다.
   * 그래서 면의 서쪽 끝에서 6 cm 만 띄우면 무엇에도 안 파묻힌다.
   *
   * 회전과 자리는 사인이 안 움직이므로 **로드 때 한 번** 만들어 둔다 —
   * 프레임마다 Quaternion 을 새로 만들 이유가 없었다.
   */
  const SYMBOL_LIFT = 0.06
  const FACE_WEST = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2)
  // ✕ 막대는 사인 평면 **안에서** 기운다 — 판을 세운 뒤의 로컬 z 축이 회전축이다
  const CROSS_Q = CROSS_BARS.map((rot) => FACE_WEST.clone()
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), rot)))
  const symbolAt = new Map<number, Vector3>()
  for (const g of gateOrder) {
    const box = signBoxes.get(g.id) as Box3
    const c = box.getCenter(new Vector3())
    symbolAt.set(g.id, new Vector3(box.min.x - SYMBOL_LIFT, c.y, c.z))
  }

  const syncSymbols = (workingIds: readonly number[]): void => {
    gateOrder.forEach((g, i) => {
      const a = symbolAt.get(g.id) as Vector3
      const ok = workingIds.includes(g.id)
      symMat.compose(a, FACE_WEST, ok ? ONE : HIDE)
      arrows.setMatrixAt(i, symMat)
      CROSS_Q.forEach((q, k) => {
        symMat.compose(a, q, ok ? HIDE : ONE)
        crosses.setMatrixAt(i * CROSS_BARS.length + k, symMat)
      })
    })
    arrows.instanceMatrix.needsUpdate = true
    crosses.instanceMatrix.needsUpdate = true
  }

  // ── 발광면 글로우. 존별로 나누지 않고 맵 전체를 3덩어리로 굽는다 —
  //    Z2 지점이 이미 215콜(예산 230)이라 "보이는 존 수 × 콜"을 감당할 여유가 없다.
  //    거리 페이드(glow.ts uFadeFar 78 m)가 존 컬링(95 m) 안쪽에서 컬링 역할을 대신한다.
  const glowStatic = buildGlowMesh(glowQuads, 'static')
  if (glowStatic) root.add(glowStatic)
  const glowOverhead = buildGlowMesh(glowOverheadQuads, 'overhead')
  if (glowOverhead) root.add(glowOverhead)
  const glowDynamic: DynamicGlow | null = buildDynamicGlow(dynGlowQuads, 'dynamic')
  if (glowDynamic) root.add(glowDynamic.mesh)

  // ── 접촉 그림자 (AO 대용). 역시 맵 전체를 한 덩어리로 — 드로우 콜 +1.
  const contactShadows = buildContactShadows(shadowQuads)
  if (contactShadows) root.add(contactShadows)

  const green = new Color(PALETTE.line2)
  const red = new Color(PALETTE.danger)
  const dark = new Color(0x1a1d22)
  /** 글로우 색 갱신은 상태가 바뀔 때만 — 매 프레임 어트리뷰트를 다시 올릴 이유가 없다 */
  let glowKey = ''
  const paintGlow = (range: GlowRange, c: Color, gain: number): void => {
    if (!glowDynamic || range[1] === 0) return
    tintTmp.copy(c).multiplyScalar(gain)
    for (let i = 0; i < range[1]; i++) glowDynamic.setColor(range[0] + i, tintTmp)
  }

  return {
    root,
    setOverhead(on) {
      overheadOn = on
      for (const g of overheadGroups) g.visible = on
      // 천장을 끄는 쿼터뷰에서 천장 조명 글로우만 공중에 남으면 안 된다
      if (glowOverhead) glowOverhead.visible = on
    },
    stats: { merged: mergedCount, dynamic: dynamicCount, lightmaps: lightmapCount },
    sync(s, dtSec, greenLight, lightRemainSec) {
      // ── 존 가시성: 안개 far 밖의 존은 그리지 않는다
      const p = new Vector3(s.player.pos.x, s.player.pos.z, -s.player.pos.y)
      for (const z of zoneGroups) z.group.visible = z.box.distanceToPoint(p) < VISIBLE_RANGE
      // 반사는 씬을 한 번 더 그린다 — 가까울 때만 켠다
      for (const mi of mirrors) mi.obj.visible = mi.center.distanceTo(p) < MIRROR_RANGE
      void overheadOn

      // ── 게이트 사인 · 램프 · 기호
      for (const sg of signs) sg.mat.color.copy(s.gates.workingIds.includes(sg.gate) ? green : red)
      for (const lp of lamps) lp.mat.color.copy(s.gates.workingIds.includes(lp.gate) ? green : red)
      syncSymbols(s.gates.workingIds)

      // ── 발광 글로우 색 (상태가 바뀐 프레임에만 올린다)
      const key = `${s.gates.workingIds.join(',')}|${greenLight ? 1 : 0}`
      if (glowDynamic && key !== glowKey) {
        glowKey = key
        for (const sg of signs) {
          paintGlow(sg.glow, s.gates.workingIds.includes(sg.gate) ? green : red, 1.35)
        }
        for (const lp of lamps) {
          paintGlow(lp.glow, s.gates.workingIds.includes(lp.gate) ? green : red, 1.6)
        }
        for (const g of tlRedGlows) paintGlow(g, greenLight ? dark : red, 1.5)
        for (const g of tlGreenGlows) paintGlow(g, greenLight ? green : dark, 1.5)
        glowDynamic.flush()
      }

      // ── 게이트 플랩 — **기본은 닫힘.** 태그가 통과되면 그 게이트만 열린다.
      //    `passed` 로 전부 여는 것은 운임구역에 들어간 뒤 되돌아 나올 때 갇히지 않게
      //    하는 장치다(충돌 쪽 `gateFlaps` 도 같은 조건으로 막기를 그만둔다).
      //    두 곳이 같은 식을 쓰므로 **보이는 문과 막는 벽이 어긋날 수 없다.**
      for (const f of flaps) {
        const open = s.gates.passed || (s.gates.state === 'open' && s.gates.activeId === f.gate)
        const target = open ? f.openAngle : 0
        f.node.rotation.y += (target - f.node.rotation.y) * (1 - Math.exp(-dtSec / 0.09))
      }

      // ── 안전문 · 열차
      const slide = s.train.doorProgress * 0.78
      if (psdBank.left) psdBank.left.position.x = -slide
      if (psdBank.right) psdBank.right.position.x = slide

      const t = s.train
      trainGroup.visible = t.state !== 'incoming' && t.x < 300
      trainGroup.position.x = t.x - TRAIN.firstCarX
      if (trainBank.left) trainBank.left.position.x = -slide
      if (trainBank.right) trainBank.right.position.x = slide
      // 문창은 문짝과 **같이** 움직여야 한다 — 따로 두면 유리만 제자리에 남는다
      if (dwinBank.left) dwinBank.left.position.x = -slide
      if (dwinBank.right) dwinBank.right.position.x = slide

      // ── 반대 방면 안전문 · 열차 — 같은 식, `s.train2` 를 본다
      const slide2 = s.train2.doorProgress * 0.78
      if (psdBank2.left) psdBank2.left.position.x = -slide2
      if (psdBank2.right) psdBank2.right.position.x = slide2

      const t2 = s.train2
      train2Group.visible = t2.state !== 'incoming' && t2.x < 300
      train2Group.position.x = t2.x - TRAIN.firstCarX
      if (trainBank2.left) trainBank2.left.position.x = -slide2
      if (trainBank2.right) trainBank2.right.position.x = slide2
      if (dwinBank2.left) dwinBank2.left.position.x = -slide2
      if (dwinBank2.right) dwinBank2.right.position.x = slide2

      // ── 신호등
      for (const m of tlReds) m.color.copy(greenLight ? dark : red)
      for (const m of tlGreens) m.color.copy(greenLight ? green : dark)
      const k = Math.max(0.05, Math.min(1, lightRemainSec / (greenLight ? 12 : 18)))
      for (const c of tlCount) c.scale.y = k
    },
  }
}

export const stationZoneCount = ZONE_FILES.length
export { worldZ }
