"""리깅·포즈 헬퍼.

여기 있는 것들은 ACT-05~08 에서 비싸게 배운 것들이다. 다음 캐릭터가
같은 함정을 다시 밟지 않도록 한곳에 모아 둔다.
"""
import bpy
import math
from mathutils import Euler, Matrix, Vector

D = math.radians


def sample_action(rig, act, f0, f1, bones, scene=None):
    """액션을 프레임별로 떠서 포즈 값을 뽑는다.

    하체를 MC 원본에서 리샘플해 가져올 때 쓴다 — 이러면 발 미끄러짐이
    원본과 같은 값으로 유지되고, 커지면 회귀로 잡힌다.
    """
    scene = scene or bpy.context.scene
    ad = rig.animation_data or rig.animation_data_create()
    prev = ad.action
    ad.action = act
    dg = bpy.context.evaluated_depsgraph_get()
    out = {}
    for f in range(f0, f1 + 1):
        scene.frame_set(f)
        dg.update()
        snap = {}
        for bn in bones:
            pb = rig.pose.bones.get(bn)
            if pb is None:
                raise RuntimeError("pose bone missing: %s" % bn)
            snap[bn] = {"loc": list(pb.location), "rot": list(pb.rotation_euler)}
        out[f] = snap
    ad.action = prev
    scene.frame_set(f0)
    return out


def act_span(a):
    fr = a.frame_range
    return int(round(fr[0])), int(round(fr[1]))


def bone_attach(rig, obj, bone):
    """오브젝트를 본에 매단다. 본 부모의 원점은 **본 꼬리**다.

    현재 월드 위치를 유지하도록 basis 를 역산한다 —
    basis = (rig_world @ pose_matrix @ T(0, bone_len, 0))⁻¹ @ world
    """
    pb = rig.pose.bones[bone]
    blen = rig.data.bones[bone].length
    pm = rig.matrix_world @ pb.matrix @ Matrix.Translation((0.0, blen, 0.0))
    w = obj.matrix_world.copy()
    obj.parent = rig
    obj.parent_type = 'BONE'
    obj.parent_bone = bone
    obj.matrix_parent_inverse = Matrix.Identity(4)
    obj.matrix_basis = pm.inverted() @ w
    bpy.context.view_layer.update()


def arm_solver(rig, dg):
    """팔 6DOF 좌표하강 솔버를 만든다.

    주의 셋 —
    * **잔차는 손 오차만 돌려준다.** 합산 비용의 제곱근을 잔차라고 하면
      팔꿈치 항이 섞여, 손이 목표에 닿았는데도 커 보인다.
    * **씨앗을 여러 개 넣는다.** 좌표하강은 시작점에 따라 국소최소에 갇힌다
      (실측: 손 49mm 이탈).
    * **조준 항은 각도(rad)를 그대로 쓴다.** `(1-dot)` 은 작은 각에서 2차로
      죽어 손 위치 항에 눌린다.
    """
    def tip(bone):
        return rig.matrix_world @ rig.pose.bones[bone].tail

    def elbow(bone):
        return rig.matrix_world @ rig.pose.bones[bone].head

    def _once(side, hand, elb, aimv, aim_fn, elbow_w, aim_w, seed, passes):
        ua, la = "UpperArm." + side, "LowerArm." + side
        par = list(seed)

        def cost(p):
            rig.pose.bones[ua].rotation_euler = Euler(
                [D(p[0]), D(p[1]), D(p[2])], 'XYZ')
            rig.pose.bones[la].rotation_euler = Euler(
                [D(p[3]), D(p[4]), D(p[5])], 'XYZ')
            dg.update()
            c = (tip(la) - hand).length ** 2
            c += elbow_w * (elbow(la) - elb).length ** 2
            if aimv is not None and aim_w > 0.0:
                c += aim_w * aim_fn().angle(aimv) ** 2
            c += 1e-6 * sum(x * x for x in p)
            return c

        step, best = 24.0, cost(par)
        for _ in range(passes):
            improved = True
            while improved:
                improved = False
                for i in range(6):
                    for sgn in (step, -step):
                        trial = list(par)
                        trial[i] += sgn
                        if abs(trial[i]) > 150:
                            continue
                        c = cost(trial)
                        if c < best - 1e-12:
                            best, par, improved = c, trial, True
            step *= 0.5
        cost(par)
        ang = math.degrees(aim_fn().angle(aimv)) if aimv is not None else None
        return par, best, (tip(la) - hand).length, ang

    def solve(side, hand, elb, aim=None, aim_fn=None,
              elbow_w=0.006, aim_w=0.0, start=None, seeds=None, passes=10):
        """seeds 를 지정하면 그것만 쓴다.

        `passes` 는 스텝을 절반으로 줄이는 횟수다. 둘 다 기존 자산을 그대로
        재현해야 할 때만 건드린다 — 씨앗을 늘리거나 담금을 한 번 더 하면
        더 나은 최소값을 찾지만, 그만큼 예전 결과와 0.1~0.3mm 달라진다.
        """
        aimv = aim.normalized() if aim else None
        if aimv is not None and aim_fn is None:
            raise RuntimeError("aim needs aim_fn (프롭 방향을 읽는 함수)")
        if seeds is not None:
            seeds = [list(x) for x in seeds]
            best = None
            for sd in seeds:
                r = _once(side, hand, elb, aimv, aim_fn, elbow_w, aim_w, sd, passes)
                if best is None or r[1] < best[1]:
                    best = r
            par, _c, err, ang = best
            _once(side, hand, elb, aimv, aim_fn, elbow_w, aim_w, par, passes)
            return [round(x, 3) for x in par], err, ang
        seeds = [[0.0] * 6]
        if start:
            seeds.append(list(start))
        seeds += [[-40.0, 0, 0, -30.0, 0, 0], [-70.0, 0, 0, 20.0, 0, 0],
                  [-20.0, 0, -30.0, -50.0, 0, 0], [-60.0, 0, 0, -40.0, 0, 0],
                  [-50.0, -20.0, 0, -60.0, 0, 0], [-80.0, 0, 20.0, -30.0, 0, 0],
                  [-45.0, 15.0, -20.0, -45.0, 10.0, 0]]
        best = None
        for sd in seeds:
            r = _once(side, hand, elb, aimv, aim_fn, elbow_w, aim_w, sd, passes)
            if best is None or r[1] < best[1]:
                best = r
        par, _c, err, ang = best
        _once(side, hand, elb, aimv, aim_fn, elbow_w, aim_w, par, passes)
        return [round(x, 3) for x in par], err, ang

    solve.tip = tip
    solve.elbow = elbow
    return solve


def abduct_sign(rig, dg, side, base, restore):
    """팔을 몸에서 멀어지게 하는 회전 부호를 **실측**한다.

    본 로컬 축은 본 방향에 따라 뒤집힌다 — 눈대중하면 반대로 벌린다
    (실측: L 은 -8°, R 은 +8° 가 바깥이다).
    """
    ua, la = "UpperArm." + side, "LowerArm." + side
    out = {}
    for sgn in (+1.0, -1.0):
        restore()
        rig.pose.bones[ua].rotation_euler = Euler(
            [D(base[0]), D(base[1]), D(base[2] + sgn * 8.0)], 'XYZ')
        rig.pose.bones[la].rotation_euler = Euler(
            [D(base[3]), D(base[4]), D(base[5])], 'XYZ')
        dg.update()
        t = rig.matrix_world @ rig.pose.bones[la].tail
        out[sgn] = math.hypot(t.x, t.y)
    restore()
    return 8.0 if out[+1.0] > out[-1.0] else -8.0


def rotate_mesh_about(obj, angle_deg, axis, pivot):
    """메시를 **자기 중심**으로 돌린다.

    `transform_apply(location=True)` 를 부른 뒤에는 오브젝트 원점이 월드
    (0,0,0) 이라, rotation_euler 를 주고 다시 apply 하면 파츠가 월드 원점을
    축으로 돌아 90mm 씩 날아간다. 이 함정을 ACT-08 에서 세 번 밟았다.
    """
    import bmesh
    R = Matrix.Rotation(D(angle_deg), 4, axis)
    p = Vector(pivot)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    for v in bm.verts:
        v.co = p + (R @ (v.co - p))
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
