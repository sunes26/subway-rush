/**
 * 휴대폰 — **주인공의 손에 있는 실물**이다.
 *
 * ■ 왜 화면 구석의 카드가 아닌가
 *
 * 이전 판은 앱 화면을 DOM 카드로 화면 오른쪽 아래에 띄웠다. 정보는 읽혔지만
 * 그건 **주인공이 보는 물건이 아니라 플레이어에게 주는 HUD** 였다. 3인칭에서
 * 인물은 아무것도 안 들고 있는데 옆에 앱 화면이 떠 있으니 공간이 두 겹이 된다.
 *
 * 그래서 3D 로 옮겼다. 팔에 붙어 있으므로 카메라가 어디로 가든 손과 같이 움직이고,
 * 어깨 너머(OTS) 구도에서 자연스럽게 읽힌다.
 *
 * ■ 손 본이 없다
 *
 * 이 리그의 팔은 `LowerArmR` 에서 끝난다(골격 17: Root·Hips·Spine·Chest·Head·
 * Shoulder/UpperArm/LowerArm{L,R}·UpperLeg/LowerLeg/Foot{L,R}). 그래서 팔뚝 끝을
 * 손으로 친다 — 3등신 SD 라 손가락이 없어 어차피 구분이 안 간다.
 *
 * ■ 화면은 캔버스로 그린다
 *
 * 텍스트를 폴리곤으로 만들 수 없고, 스프라이트로 겹치면 각도가 안 맞는다.
 * 2D 캔버스에 앱 화면을 그려 텍스처로 붙이면 **화면이 진짜 화면처럼** 기울고 돈다.
 * `MeshBasicMaterial` 이라 조명을 안 받는다 — 발광하는 화면이므로 그게 맞다.
 */

import {
  BoxGeometry, CanvasTexture, CapsuleGeometry, Group, LinearFilter, Matrix4, Mesh,
  MeshBasicMaterial, PlaneGeometry, Quaternion, SkinnedMesh, SRGBColorSpace, Vector3,
  type Material, type Object3D, type Texture,
} from 'three'
import { CHAR_SCALE } from './actors'
import { toonMat } from './toon'

/**
 * 화면 픽셀. 비스듬히 보므로 실제 화면 폭보다 넉넉히 잡는다 — 이 정도면
 * 확대돼도 글자 가장자리가 안 뭉갠다.
 */
const W = 440
const H = 900

/**
 * 앱 화면.
 *
 * ★ **면적을 「3분 후」에 몰아준다.**
 *
 * 폰이 실물 크기(0.082 × 0.168)라 화면에서는 세로 20% 남짓이다. 그 안에서
 * 0.5초 만에 읽히려면 글자가 커야 하는데, 폰을 키우면 태블릿이 된다.
 * 그래서 **폰이 아니라 레이아웃**을 바꿨다 — 숫자 한 줄이 화면의 3분의 1 을
 * 차지하고, 나머지는 그것을 뒷받침하는 크기로 내려앉는다.
 *
 * 이 화면에서 크게 읽혀야 하는 것은 하나뿐이다. 둘이면 둘 다 안 읽힌다.
 */
const drawScreen = (): HTMLCanvasElement => {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')!
  const sans = '"Noto Sans KR", "Apple SD Gothic Neo", system-ui, sans-serif'

  g.fillStyle = '#0b0c0f'
  g.fillRect(0, 0, W, H)

  // 상태 표시줄 — 있다는 것만 알면 된다
  g.fillStyle = '#6c707a'
  g.font = `500 26px ${sans}`
  g.fillText('08:47', 26, 46)
  g.textAlign = 'right'
  g.fillText('LTE', W - 26, 46)
  g.textAlign = 'left'

  // 노선 · 역
  g.fillStyle = '#00A84D'
  g.beginPath(); g.arc(44, 112, 19, 0, Math.PI * 2); g.fill()
  g.fillStyle = '#fff'
  g.font = `700 24px ${sans}`
  g.textAlign = 'center'
  g.fillText('2', 44, 121)
  g.textAlign = 'left'
  g.fillStyle = '#e9e7e1'
  g.font = `600 33px ${sans}`
  /**
   * 이 판의 무대는 **홍대입구역**이다. 붕어빵 아저씨가 이미 그렇게 말하고 있고
   * (`data/interactables.ts` `FISHCAKE_GREETING`), 개찰구 분기 사인도 그 전제로 서 있다 —
   * 직진이 「합정 방면」, 북쪽이 「신촌 방면」인 것은 홍대입구에서만 성립한다.
   * 여기만 「신도림역」이라 혼자 어긋나 있었다. 신도림은 **목적지 방면**이지 이 역이 아니다.
   */
  g.fillText('홍대입구역', 74, 123)

  const rule = (y: number, a = '#23252b'): void => {
    g.strokeStyle = a
    g.lineWidth = 2
    g.beginPath(); g.moveTo(26, y); g.lineTo(W - 26, y); g.stroke()
  }

  // ── 이번 열차. 이 화면의 전부다
  rule(168)
  g.fillStyle = '#8a8e98'
  g.font = `600 30px ${sans}`
  g.fillText('이번 열차', 26, 216)

  /**
   * 숫자와 단위를 갈라 **「3」과 「분」의 크기를 다르게** 준다. 같은 크기로 쓰면
   * 세 글자가 뭉쳐 한 덩어리로 보이고, 작아지면 그 덩어리가 먼저 뭉갠다.
   *
   * ■ ★ 크기는 **화면 픽셀로 환산해서** 정한다 — 캔버스 px 는 아무 뜻이 없다
   *
   * 한동안 `3` 168 · `분` 96 · `후` 74 였다. 캔버스에서는 커 보이지만 실제로
   * 화면에 몇 px 로 맺히는지 재 보면 다른 이야기가 나온다:
   *
   *   폰 화면 0.168m · 카메라 0.71m · FOV 74°
   *   → 프레임 높이 2·0.71·tan37° = 1.07m → 폰은 세로 **113px**(720 중)
   *   → 캔버스 1px = 113/900 = **0.126 화면px**
   *   → `3` 15px · `분` 12px · `후` **9px**
   *
   * 한글 9~12px 를 14° 기울여 1.4초 안에 읽으라는 뜻이었다. 폰 크기도 거리도
   * 각도(14°)도 정상이었고 **글자만 작았다.**
   *
   * 그래서 둘을 같이 고친다 — 여기서 자체를 키우고(아래), 샷 ② 가 0.72m 에서
   * 0.44m 로 밀고 들어간다(`intro.ts`). 합쳐서 대략 2배가 된다:
   *
   *   `3` 30px · `분` 24px · `후` 21px  ← 이 정도면 한 번에 읽힌다
   *
   * ⚠ 「3」만 키우면 안 된다. 숫자만 읽히고 단위가 안 읽히면 "3"이 무엇의 3인지
   *   모른다 — 읽어야 하는 것은 숫자가 아니라 **「3분 후」라는 한 덩어리**다.
   *   그래서 `3` 은 오히려 조금 줄이고 `분`·`후` 를 올려 셋의 격차를 좁혔다.
   */
  g.fillStyle = '#FF8A1E'
  g.font = `800 150px ${sans}`
  g.fillText('3', 22, 372)
  const w3 = g.measureText('3').width
  g.font = `800 118px ${sans}`
  g.fillText('분', 22 + w3 + 8, 372)
  const wm = g.measureText('분').width
  g.font = `800 104px ${sans}`
  g.fillText('후', 22 + w3 + wm + 22, 372)

  // ── 다음 열차 — 보조. 여기가 크면 위가 안 읽힌다
  rule(424)
  g.fillStyle = '#8a8e98'
  g.font = `500 28px ${sans}`
  g.fillText('다음 열차', 26, 472)
  g.fillStyle = '#b8b6b0'
  g.font = `600 40px ${sans}`
  g.fillText('20분 26초 후', 26, 524)

  /**
   * 출근 시각 — 08:47 과 나란히 놓이면 "놓치면 지각"이 저절로 만들어진다.
   * 문장으로 쓰지 않는 이유가 이것이다(자막 금지).
   */
  rule(572)
  g.fillStyle = '#8a8e98'
  g.font = `500 27px ${sans}`
  g.fillText('출근', 26, 618)
  g.fillStyle = '#E5484D'
  g.font = `700 30px ${sans}`
  g.fillText('09:00', 106, 618)

  return c
}

export type Phone = Readonly<{
  root: Group
  /** 팔뚝 본에 매단다. 이미 붙어 있으면 아무 일도 안 한다 */
  attachTo(bone: Object3D): void
  /**
   * **자세를 본에서 떼어낸다.** 위치만 손을 따라가고 방향은 여기서 정한다.
   *
   * @param eye   카메라의 월드 위치(three 좌표)
   * @param face  주인공 얼굴의 월드 위치(three 좌표)
   * @param up    **카메라의 up 벡터**(three 좌표). 폰의 세로축이 이것에 맞춰진다 —
   *              화면의 글자가 프레임에서 똑바로 서게 하는 기준이다. 아래 참고.
   */
  aim(eye: Vector3, face: Vector3, up: Vector3): void
  setVisible(on: boolean): void
  dispose(): void
}>

/**
 * 실물 치수(m) — **평범한 스마트폰.**
 *
 * ⚠ 화면이 안 읽힌다고 계속 키우다 0.150 × 0.305 까지 갔는데, 그건 태블릿이다.
 *   사람이 손에 든 물건이 아니라 **공중에 뜬 전광판**으로 보였다.
 *   가독성은 크기가 아니라 **카메라 거리**로 푸는 문제다 — 폰은 실물로 돌리고
 *   OTS 를 폰 가까이 가져간다.
 *
 * 실제 스마트폰은 0.071 × 0.147 이다. 3등신 SD 의 손이 크므로 손바닥보다
 * 조금 큰 선에서 0.082 × 0.168 로 잡는다.
 */
const SIZE = { w: 0.082, h: 0.168, d: 0.010 } as const

/**
 * ★ **쥐는 손을 폰 그룹에 붙인다.**
 *
 * ■ 왜 팔이 아니라 폰에 붙이는가
 *
 * 이 리그의 팔은 `LowerArmR` 에서 끝난다 — **손 본이 없다.** 그래서 손가락을
 * 폰에 감는 애니메이션이 원리적으로 불가능하고, 지금까지는 "팔뚝 끝이 손"이라는
 * 전제로 폰을 그 자리에 놓기만 했다. 그러면 아무리 좌표를 맞춰도 화면에는
 * **둥근 팔뚝 끝이 폰에 닿아 있는 것**까지만 보인다. "쥐었다"가 안 읽힌다.
 *
 * 그래서 손을 **폰의 자식**으로 만든다. 그러면 폰이 어디로 가고 어떻게 돌든
 * 손은 같이 간다 — 접촉이 좌표 맞추기가 아니라 **부모-자식 관계**로 보장된다.
 * 이 방향으로만 "손과 폰이 떨어졌다"는 부류의 버그가 구조적으로 사라진다.
 *
 * ⚠ 손이 폰과 같이 도는 것은 물리적으로 맞다 — 쥐고 있으므로 한 덩어리다.
 *   `aim()` 이 얼굴 쪽으로 20% 만 트는 범위라 전완 방향과도 크게 안 어긋난다.
 *
 * ■ ★ 손가락은 **−X 모서리**다 — 이건 측정해서 정했다
 *
 * 처음엔 "+X 가 화면의 오른쪽일 것"이라 보고 손가락을 +X 에 뒀다. 그런데 렌더에는
 * 엄지만 보이고 손가락이 없었다. 손가락을 빨강·엄지를 파랑으로 칠해 찍어 보니
 * **+X 가 화면의 왼쪽**이었고, 그 왼쪽은 팔뚝이 폰으로 들어오는 쪽이다 —
 * 손가락 셋이 통째로 팔뚝 덩어리 뒤에 묻혀 있었다.
 *
 * 그래서 손가락은 팔뚝 반대쪽(−X)에 둔다. 팔뚝이 안 가리므로 셋이 다 보이고,
 * 엄지는 팔뚝 쪽(+X)에 남는다 — 손목이 있는 쪽에 엄지가 오는 것이 실제 손이다.
 *
 * ⚠ 이 부호는 `aim()` 이 만드는 회전에 달려 있다. 카메라나 겨냥 비율을 크게
 *   바꾸면 다시 재야 한다. 추측하지 말고 색을 칠해서 찍으면 한 번에 나온다.
 *
 * ■ 높이는 읽어야 할 글자를 피해서 정했다 (전부 로컬 y, 원점 = 쥐는 점)
 *
 *   0.062 ~ 0.074   「다음 열차 · 20분 26초 후」   ← 가려선 안 된다
 *   0.091           「3분 후」                     ← 가려선 안 된다
 *   ~0.056          손가락 상단                    ← 6mm 아래에서 끝낸다
 *
 * 손가락을 화면 가운데로 올려 붙이면 그 순간 정보가 사라진다. 손을 크게 그리는
 * 것보다 **글자를 안 가리는 것**이 먼저다.
 */
const HAND = {
  /**
   * 손가락 — `[로컬 y, 앞면을 넘어오는 길이]`.
   *
   * ⚠ 처음엔 셋을 같은 길이(0.042)로 뒀다. 그러면 앞면에서 **끝이 일자로 맞아**
   *   손가락이 아니라 빗살처럼 보인다. 가운데가 가장 길고 위아래가 짧은 것이
   *   실제 손 모양이다 — 길이를 다르게 준 이유는 그것뿐이다.
   *
   * ⚠ 그리고 짧으면(0.042) 팔뚝 끝의 둥근 덩어리에 묻혀 **셋이 한 덩어리**가 된다.
   *   앞면을 절반 넘게 건너와야 폰 위에 얹힌 것으로 읽힌다.
   */
  finger: [[0.007, 0.050], [0.026, 0.057], [0.045, 0.049]],
  fingerR: 0.0105,
  thumbR: 0.0115,
} as const

/**
 * 두 점을 잇는 캡슐 — 손가락·엄지를 좌표로 놓기 위한 것이다.
 *
 * 회전을 오일러 각으로 찍으면 값이 무슨 뜻인지 아무도 모르게 된다. 시작점과
 * 끝점을 주면 방향은 계산으로 나오고, 나중에 위치를 옮길 때도 점만 옮기면 된다.
 */
const capsuleBetween = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  r: number,
  mat: Material,
): Mesh => {
  const from = new Vector3(...a)
  const to = new Vector3(...b)
  const dir = to.clone().sub(from)
  const len = dir.length()
  const m = new Mesh(new CapsuleGeometry(r, Math.max(len - r * 2, 0.001), 4, 8), mat)
  m.position.copy(from).addScaledVector(dir, 0.5)
  // 캡슐의 긴 축은 +Y 다. 그 축을 dir 로 돌린다
  m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize())
  return m
}

export const buildPhone = (): Phone => {
  const root = new Group()
  root.name = 'intro-phone'

  /**
   * ★ 그룹의 **원점을 폰의 아래 모서리**에 둔다.
   *
   * 원점이 폰 한가운데면 그 점을 손에 맞췄을 때 폰의 절반이 손 **아래로**
   * 늘어진다 — 쥔 게 아니라 손에 걸쳐 놓은 모양이 된다.
   * 사람이 쥐는 자리는 아래쪽이므로, 몸체와 화면을 위로 올려 **원점 = 쥐는 점**
   * 으로 만든다. 그러면 자세를 어떻게 돌리든 손과 폰이 안 떨어진다.
   */
  /**
   * ★ 쥐는 점을 폰의 **아래 모서리에 거의 붙인다**(0.006 만 안쪽).
   *
   * ■ 왜 0.022 → 0.006 인가 — **손과 폰이 떨어지는 것을 크기로 풀면 안 된다**
   *
   * 손이 화면 아래쪽을 가려서, 한때 폰을 **손 끝 방향으로 밀어냈다**(0.205 → 0.250).
   * 전완 길이가 약 0.21m 인데 0.25 로 보냈으니 **4cm 를 넘겨** 손에서 떨어졌고,
   * 그게 "공중에 떠 있다"의 정체였다. 가림을 없애려다 접촉을 잃었다.
   *
   * 옳은 방향은 반대다 — 쥐는 점은 손 **안에** 두고(0.195 < 0.21), 폰 몸체를
   * 그 위로 올린다. 그러면 손은 폰의 아래 모서리·뒷면에 닿은 채로 남고 화면은
   * 손 위에서 열린다. 실제로 사람이 폰을 쥐는 모양이 이것이다.
   */
  const GRIP_UP = SIZE.h / 2 - 0.006

  const body = new Mesh(
    new BoxGeometry(SIZE.w, SIZE.h, SIZE.d),
    toonMat(0x23252b),
  )
  body.position.y = GRIP_UP
  root.add(body)

  const tex: Texture = new CanvasTexture(drawScreen())
  tex.colorSpace = SRGBColorSpace
  tex.minFilter = LinearFilter
  tex.magFilter = LinearFilter
  // 비스듬히 볼 때 글자가 뭉개지지 않게 — 화면은 늘 각도가 붙는다
  tex.anisotropy = 8
  const screen = new Mesh(
    new PlaneGeometry(SIZE.w - 0.012, SIZE.h - 0.016),
    // 화면은 스스로 빛난다 — 툰 램프를 태우면 회색이 된다
    new MeshBasicMaterial({ map: tex, toneMapped: false }),
  )
  /**
   * 화면은 **−Z 쪽**에 붙인다.
   *
   * 실측: 휴대폰을 든 순간 팔뚝 본의 로컬 −Z 가 월드 (−0.75, 0.66, −0.05),
   * 즉 **뒤·위** 를 가리킨다 — 앉은 사람의 얼굴이 있는 방향이다. 화면이 그쪽을
   * 봐야 주인공이 화면을 보는 것이 되고, 어깨 너머(OTS) 카메라에도 읽힌다.
   */
  screen.position.set(0, GRIP_UP, -(SIZE.d / 2 + 0.001))
  screen.rotation.y = Math.PI
  root.add(screen)

  /**
   * ── 쥐는 손 (`HAND` 주석 참고)
   *
   * 색은 **박지 않는다.** 주인공은 GLB 리그이고 피부색은 그 파일의 재질에 있다.
   * 여기에 색을 적어 두면 캐릭터를 다시 굽는 날 손만 다른 색이 된다 —
   * `attachTo` 에서 리그의 재질에서 읽어 온다. 기본값은 못 읽었을 때만 쓴다.
   */
  const skin = toonMat(0xece7de)
  const hand = new Group()
  hand.name = 'intro-phone-hand'

  /** 손바닥 — 폰 **뒷면**(+Z)에 붙는다. 앞에서는 폰에 가려 모서리만 보인다 */
  const palm = new Mesh(new BoxGeometry(0.060, 0.076, 0.030), skin)
  palm.position.set(-0.006, 0.030, SIZE.d / 2 + 0.014)
  hand.add(palm)

  /**
   * 손가락 — 뒷면에서 **오른쪽 모서리를 넘어** 앞면으로 나온다.
   *
   * 앞면을 가로지르는 길이는 모서리에서 2.7cm 정도다. 폰 폭이 8.2cm 이므로
   * 화면의 오른쪽 3분의 1 만 걸치고, 그 자리 그 높이에는 글자가 없다.
   */
  const zBack = SIZE.d / 2 + 0.012
  const zFront = -(SIZE.d / 2 + 0.013)
  for (const [y, len] of HAND.finger) {
    hand.add(capsuleBetween(
      [-(SIZE.w / 2) + 0.004, y, zBack],
      [-(SIZE.w / 2) + len, y, zFront],
      HAND.fingerR, skin,
    ))
  }

  /**
   * 엄지 — 왼쪽 아래에서 **위로 비스듬히** 올라온다.
   *
   * 손가락과 같은 방향으로 두면 갈퀴처럼 보인다. 엄지는 다른 손가락과 마주보는
   * 각으로 붙어야 "쥐었다"가 된다 — 그래서 세로 성분이 크다. 상단(0.048)이
   * 「20분 26초 후」(0.062) 아래에서 끝난다.
   */
  hand.add(capsuleBetween(
    [SIZE.w / 2 + 0.002, 0.006, zBack],
    [SIZE.w / 2 - 0.020, 0.052, zFront - 0.003],
    HAND.thumbR, skin,
  ))

  root.add(hand)

  /**
   * ★ **본에 매달면 캐릭터 배율(`CHAR_SCALE` 1.6)을 그대로 먹는다.**
   *
   * 이걸 놓쳐서 두 가지가 동시에 틀렸다.
   *   · 휴대폰이 1.6배로 커졌다 — 세로 0.235m 로 만든 것이 화면에서는 0.376m,
   *     즉 **37cm 짜리 판때기**였다. 손에 쥔 물건으로 안 보이는 게 당연하다.
   *   · 위치 오프셋도 1.6배가 됐다 — 로컬 0.179 로 준 것이 월드에서 0.287 이라
   *     팔뚝(0.235)을 넘겨 **손에서 5cm 떨어져** 떠 있었다.
   *     (실측: 어깨 −61.266 · 팔꿈치 −61.415 · 폰 −61.135)
   *
   * 자식 스케일로 배율을 되돌리고, 오프셋은 팔뚝 길이 안으로 줄인다.
   * 숫자를 박지 않고 `CHAR_SCALE` 로 나눈다 — 배율이 바뀌면 따라간다.
   */
  root.scale.setScalar(1 / CHAR_SCALE)
  /**
   * ★ 손은 본의 **+Y 쪽**이다. 로컬 Y 가 곧 본이 뻗은 방향이므로 팔뚝 끝 = 손은
   *   +Y 다. 한동안 −Y 로 매달아서 휴대폰이 **팔꿈치 뒤쪽**에 붙어 있었다 —
   *   팔을 앞으로 들어도 폰만 뒤로 남아 손과 따로 놀았다.
   *   (실측: 팔꿈치 −61.276 · 폰 −61.363 — 폰이 팔꿈치보다 뒤였다)
   *
   * 길이는 팔뚝(≈0.21m)만큼. `CHAR_SCALE` 이 곱해지므로 그것으로 나눈다.
   */
  /**
   * ★ 손 **너머**에 둔다.
   *
   * 팔뚝 끝(= 손)에 폰의 **중심**을 맞췄더니 손이 화면 한복판을 가렸다.
   * 실제로 사람은 폰의 아래쪽 모서리를 쥔다 — 그래서 손보다 폰 높이의 절반쯤
   * 더 내보낸다(0.21 → 0.33). 그러면 손은 아래 모서리에 걸리고 정보 영역이
   * 통째로 열린다.
   *
   * 로컬 값은 월드의 1/`CHAR_SCALE` 이다 — 본에 매달리면 그 배율이 곱해진다.
   */
  /**
   * 원점이 곧 쥐는 점이므로 **팔뚝 끝(= 손)에 그대로** 놓는다.
   * 팔뚝은 0.21m 이고, 본에 매달리면 `CHAR_SCALE` 이 곱해지므로 나눠 준다.
   */
  /**
   * `x` 는 손등 기준의 **좌우**다. `+x` 가 손 뒤쪽(카메라 반대편)이라, 0.024 로
   * 밀었을 때 폰이 손등 뒤로 더 들어가 화면이 거의 안 보였다. 부호를 뒤집어
   * −0.012 로 두면 폰이 손등 **앞**으로 나온다. 손 폭의 절반(≈0.025) 안이라
   * 쥐는 점은 여전히 손 안에 있다 — 접촉을 잃지 않고 화면만 열린다.
   */
  root.position.set(-0.012, 0.228 / CHAR_SCALE, 0.020)
  root.visible = false

  let skinTaken = false

  const want = new Quaternion()
  const inv = new Quaternion()
  const m = new Matrix4()
  const here = new Vector3()
  const target = new Vector3()
  const UP = new Vector3(0, 1, 0)

  return {
    root,
    attachTo(bone) {
      if (root.parent !== bone) bone.add(root)
      /**
       * ★ 손 색을 **리그에서 읽는다.** 본의 최상위 조상까지 올라가 스킨드 메시의
       *   재질 색을 그대로 가져온다. 캐릭터를 다시 굽거나 색을 바꿔도 손이 따라간다.
       *   한 번만 하면 되므로 플래그로 막는다.
       */
      if (!skinTaken) {
        let top: Object3D = bone
        while (top.parent) top = top.parent
        top.traverse((o) => {
          if (skinTaken || !(o instanceof SkinnedMesh)) return
          const mat = Array.isArray(o.material) ? o.material[0] : o.material
          const col = (mat as { color?: { getHex(): number } }).color
          if (!col) return
          skin.color.setHex(col.getHex())
          skinTaken = true
        })
      }
    },
    /**
     * ★ **세로로 세우고, 화면이 읽히는 쪽을 보게 한다.**
     *
     * 본의 자식으로 두면 방향까지 물려받는다. 팔뚝의 긴 축이 곧 폰의 긴 축이 되어
     * 팔을 들면 폰이 **전완을 따라 누운 판때기**가 된다 — 사람은 그렇게 안 든다.
     * 그래서 위치만 손에서 받고 자세는 여기서 만든다.
     *
     * 방향은 **각도를 찍어 맞추지 않는다.** 화면(로컬 −Z)이 향할 목표점을 정하고
     * 거기서 회전을 역산한다. 목표점은 얼굴과 카메라 사이 65% 지점이다 —
     *
     *   · 얼굴 쪽 100% 면 법선이 주인공의 몸통을 향한다. 그 축 위에는 등·어깨·팔이
     *     있어서 **카메라를 어디에 놓아도 가려진다.** 등받이 뒤·오른쪽 뒤·머리 위를
     *     차례로 시도했고 전부 막혔다.
     *   · 카메라 쪽 100% 면 폰을 카메라에 들이대는 꼴이 된다.
     *
     * 65% 는 "옆자리 시선을 피해 폰을 살짝 안쪽으로 트는" 실제 각과 겹친다.
     * 브리프가 허용한 cinematic cheat 는 이 한 번으로 끝난다.
     */
    /**
     * ★ **세로축은 카메라의 up 에 맞춘다 — 월드 up 이 아니다.**
     *
     * 한동안 `UP = (0,1,0)`(월드 위)로 `lookAt` 했다. 카메라가 인물 옆에서 볼
     * 때는 멀쩡했는데, OTS 를 폰 쪽으로 밀어 넣자 **글자가 옆으로 누웠다.**
     * 실측하면 화면 세로축의 프레임 기울기가 컷 동안 **29° → 64°** 로 벌어졌다.
     *
     * 원인은 `lookAt` 의 성질이다. 시선이 기준 up 과 나란해질수록 롤이 불안정해지고,
     * 카메라가 붙으면서 내려다보는 각이 55° → 65° 로 서자 그 구간에 들어갔다.
     * 각도를 손으로 맞춰 덮을 수 있는 종류가 아니다 — 기준을 바꿔야 사라진다.
     *
     * 카메라의 up 을 기준으로 삼으면 폰의 세로축이 **화면의 세로**에 맞춰지므로
     * 롤은 구조적으로 작게 유지된다. 카메라를 어디로 옮겨도 다시 안 생긴다.
     *
     * ⚠ 이것이 "폰을 화면에 붙여 놓는" 것은 아니다. 위치는 여전히 손 본에서 오고,
     *   법선도 여전히 얼굴 쪽으로 35% 틀어져 있다(아래). 정하는 것은 **비틀림 하나**다.
     *   실제로 사람은 글자가 똑바로 보이도록 폰을 돌려 쥔다 — 그 동작에 해당한다.
     */
    aim(eye, face, up) {
      root.getWorldPosition(here)
      /**
       * 0.65 → 0.80. 화면을 카메라 쪽으로 더 돌린다.
       *
       * 0.65 는 "옆자리 시선을 피해 살짝 안으로 트는" 각인데, 그러면 화면의 왼쪽
       * 모서리가 **손 뒤로 들어가** 「3분 후」의 첫 글자가 가렸다. 0.80 이면 폰이
       * 손보다 앞으로 나와 글자가 다 열린다. 여전히 얼굴 쪽으로 20% 틀어져 있어
       * "카메라에 들이댄" 모양은 안 된다.
       */
      target.copy(face).lerp(eye, 0.80)
      // `Matrix4.lookAt(eye, target, up)` 은 **+Z 가 target → eye** 를 향하게 만든다.
      // 즉 −Z 가 here → target 이다. 화면이 −Z 이므로 이대로 맞는다.
      m.lookAt(here, target, up.lengthSq() > 1e-6 ? up : UP)
      want.setFromRotationMatrix(m)
      root.parent?.getWorldQuaternion(inv)
      root.quaternion.copy(inv.invert()).multiply(want)
    },
    setVisible(on) { root.visible = on },
    dispose() {
      root.traverse((o) => { if (o instanceof Mesh) o.geometry.dispose() })
      tex.dispose()
      root.removeFromParent()
    },
  }
}
