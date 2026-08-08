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
  BoxGeometry, CanvasTexture, Group, LinearFilter, Mesh, MeshBasicMaterial,
  PlaneGeometry, SRGBColorSpace, type Object3D, type Texture,
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
  setVisible(on: boolean): void
  dispose(): void
}>

/**
 * 실물 치수(m). 주인공이 1.48m 인 3등신이라 실제 휴대폰(0.15m)을 그대로 쓰면
 * 손에 비해 작아서 화면이 안 읽힌다. 조금 키워 **읽히는 크기**로 잡는다 —
 * 이 게임의 다른 소품도 같은 이유로 실물보다 크다.
 */
const SIZE = { w: 0.115, h: 0.235, d: 0.014 } as const

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
  root.position.set(0, 0.21 / CHAR_SCALE, 0.022)
  root.rotation.set(0.34, 0, -0.16)
  root.visible = false

  return {
    root,
    attachTo(bone) {
      if (root.parent !== bone) bone.add(root)
    },
    setVisible(on) { root.visible = on },
    dispose() {
      root.traverse((o) => { if (o instanceof Mesh) o.geometry.dispose() })
      tex.dispose()
      root.removeFromParent()
    },
  }
}
