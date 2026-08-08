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
  BoxGeometry, CanvasTexture, Group, LinearFilter, Matrix4, Mesh, MeshBasicMaterial,
  PlaneGeometry, Quaternion, SRGBColorSpace, Vector3, type Object3D, type Texture,
} from 'three'
import { CHAR_SCALE } from './actors'
import { toonMat } from './toon'

/** 화면 픽셀 — 세로가 긴 비율. 너무 키우면 텍스처만 무거워진다 */
const W = 320
const H = 660

/**
 * 앱 화면. **"3분 후"가 가장 먼저 읽혀야 한다** — 크기·색·자리 셋을 다 준다.
 * 나머지는 그 숫자를 뒷받침하는 보조 정보다.
 */
const drawScreen = (): HTMLCanvasElement => {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')!
  const sans = '"Noto Sans KR", "Apple SD Gothic Neo", system-ui, sans-serif'

  g.fillStyle = '#0d0e11'
  g.fillRect(0, 0, W, H)

  // 상태 표시줄
  g.fillStyle = '#7d818b'
  g.font = `500 22px ${sans}`
  g.fillText('08:47', 22, 42)
  g.textAlign = 'right'
  g.fillText('LTE', W - 22, 42)
  g.textAlign = 'left'

  // 노선 · 역
  g.fillStyle = '#00A84D'
  g.beginPath(); g.arc(36, 104, 15, 0, Math.PI * 2); g.fill()
  g.fillStyle = '#fff'
  g.font = `700 19px ${sans}`
  g.textAlign = 'center'
  g.fillText('2', 36, 111)
  g.textAlign = 'left'
  g.fillStyle = '#e9e7e1'
  g.font = `600 26px ${sans}`
  g.fillText('신도림역', 62, 113)

  const rule = (y: number): void => {
    g.strokeStyle = '#23252b'
    g.lineWidth = 2
    g.beginPath(); g.moveTo(22, y); g.lineTo(W - 22, y); g.stroke()
  }

  // 이번 열차 — 이 화면의 전부
  rule(154)
  g.fillStyle = '#8a8e98'
  g.font = `500 22px ${sans}`
  g.fillText('이번 열차', 22, 196)
  g.fillStyle = '#FF8A1E'
  g.font = `800 78px ${sans}`
  g.fillText('3분 후', 22, 280)

  // 다음 열차
  rule(318)
  g.fillStyle = '#8a8e98'
  g.font = `500 22px ${sans}`
  g.fillText('다음 열차', 22, 360)
  g.fillStyle = '#cfcdc7'
  g.font = `600 34px ${sans}`
  g.fillText('7분 30초 후', 22, 404)

  // 보조 — 출근 시각. 08:47 과 나란히 놓이면 "놓치면 지각"이 저절로 만들어진다
  rule(448)
  g.fillStyle = '#8a8e98'
  g.font = `500 21px ${sans}`
  g.fillText('출근', 22, 486)
  g.fillStyle = '#E5484D'
  g.font = `600 21px ${sans}`
  g.fillText('09:00', 88, 486)
  g.fillStyle = '#8a8e98'
  g.textAlign = 'right'
  g.font = `500 21px ${sans}`
  g.fillText('도보 4분', W - 22, 486)

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
   */
  aim(eye: Vector3, face: Vector3): void
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

export const buildPhone = (): Phone => {
  const root = new Group()
  root.name = 'intro-phone'

  const body = new Mesh(
    new BoxGeometry(SIZE.w, SIZE.h, SIZE.d),
    toonMat(0x23252b),
  )
  root.add(body)

  const tex: Texture = new CanvasTexture(drawScreen())
  tex.colorSpace = SRGBColorSpace
  tex.minFilter = LinearFilter
  tex.magFilter = LinearFilter
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
  screen.position.z = -(SIZE.d / 2 + 0.001)
  screen.rotation.y = Math.PI
  root.add(screen)

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
   * 손이 폰의 아래쪽을 쥔다 — 팔뚝 끝(0.21m)에서 폰 높이의 3분의 1 만큼만 더.
   * 더 내보내면 손과 폰 사이가 뜬다.
   */
  root.position.set(0.008, 0.255 / CHAR_SCALE, 0.022)
  root.visible = false

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
    aim(eye, face) {
      root.getWorldPosition(here)
      target.copy(face).lerp(eye, 0.65)
      // `Matrix4.lookAt(eye, target, up)` 은 **+Z 가 target → eye** 를 향하게 만든다.
      // 즉 −Z 가 here → target 이다. 화면이 −Z 이므로 이대로 맞는다.
      m.lookAt(here, target, UP)
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
