/**
 * `items.glb` 원본 — **한 번만 읽고 나눠 쓴다.**
 *
 * 소비처가 둘이 됐다: 바닥에 놓인 프롭(`render/props.ts`)과 손에 든 물건
 * (`render/held.ts`). 파일이 1.3 MB 라 브라우저 캐시가 네트워크는 막아 주지만
 * **파싱과 지오메트리 업로드는 두 번 일어난다** — 부팅 프레임에서 그건 그대로 끊김이다.
 * 여기서 한 번 파싱한 `gltf.scene` 을 돌려주고, 소비처는 각자 `clone()` 한다.
 *
 * ⚠ 돌려주는 것은 **원본 트리**다. 여기에 직접 손대면 다른 소비처가 같이 바뀐다
 * (`props.ts` 의 backlit 복제 경고와 같은 이유). 반드시 `clone(true)` 후에 만진다.
 */

import type { Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

let pending: Promise<Object3D> | null = null

/**
 * 캐시된 `items.glb` 루트. 실패는 **던진다** — 폴백 정책은 소비처마다 다르다
 * (프롭은 자리표시자를 세우고, 손은 그냥 빈손이다).
 */
export const itemsSource = (baseUrl: string): Promise<Object3D> => {
  pending ??= new GLTFLoader().loadAsync(`${baseUrl}models/items.glb`)
    .then((g) => g.scene as Object3D)
    .catch((e: unknown) => {
      // 실패를 캐시에 남기면 다음 소비처가 재시도할 기회를 잃는다
      pending = null
      throw e
    })
  return pending
}
