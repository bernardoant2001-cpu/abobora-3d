"""
Gato preto de desenho animado dos anos 30 (chamado por scene.py), com esqueleto.

Todas as malhas são "skinned" no armature CatRig, então o corpo dobra de forma contínua:
CatSpine > CatHead, CatLegUp{0..3} > CatLegLow{0..3}, CatTail0 > ... > CatTail5.
O site gira esses ossos (andar, virar a cabeça, rabo ondulando). Olha para +x; o chão é y = 0.
"""
import bpy
import bmesh
import math
from mathutils import Vector

TAU = math.tau


def V(x, y, z):
    return Vector((x, -z, y))


def _mat(name, color, rough, emit=False, strength=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    b = m.node_tree.nodes['Principled BSDF']
    h = color.lstrip('#')
    lin = [(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in lin]
    b.inputs['Base Color'].default_value = (*lin, 1)
    b.inputs['Roughness'].default_value = rough
    if emit:
        b.inputs['Emission Color'].default_value = (*lin, 1)
        b.inputs['Emission Strength'].default_value = strength
    return m


def _smooth(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def _catmull(pts, n):
    """curva suave passando pelos pontos (Catmull-Rom), n amostras"""
    pts = [pts[0]] + pts + [pts[-1]]
    out = []
    segs = len(pts) - 3
    for k in range(n):
        u = k / (n - 1) * segs
        i = min(int(u), segs - 1)
        t = u - i
        p0, p1, p2, p3 = pts[i], pts[i + 1], pts[i + 2], pts[i + 3]
        t2, t3 = t * t, t * t * t
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    return out


class Cat:
    def __init__(self, col, at):
        self.col = col
        self.fur = _mat('CatFur', '#0d0a0a', 0.5)
        self.white = _mat('CatWhite', '#f4ead2', 0.55)
        self.eye = _mat('CatEye', '#fffaf0', 0.25, emit=True, strength=0.0)
        self.ink = _mat('CatPupil', '#050303', 0.15)
        self.pink = _mat('CatInner', '#5a3434', 0.8)

        arm_data = bpy.data.armatures.new('CatRig')
        self.rig = bpy.data.objects.new('Cat', arm_data)
        self.rig.location = at
        col.objects.link(self.rig)
        bpy.context.view_layer.objects.active = self.rig
        for o in bpy.context.view_layer.objects:
            o.select_set(o == self.rig)
        bpy.ops.object.mode_set(mode='EDIT')
        eb = arm_data.edit_bones

        def bone(name, head, tail, parent=None):
            b = eb.new(name)
            b.head = V(*head)
            b.tail = V(*tail)
            if parent:
                b.parent = eb[parent]
            return b

        bone('CatSpine', (-0.14, 0.3, 0), (0.14, 0.34, 0))
        bone('CatHead', (0.2, 0.42, 0), (0.2, 0.68, 0), 'CatSpine')
        self.legs = []
        for i, (x, z) in enumerate(((0.13, 0.075), (0.13, -0.075), (-0.15, 0.08), (-0.15, -0.08))):
            hip = (x, 0.27, z)
            knee = (x + (0.02 if i < 2 else -0.025), 0.155, z)
            ankle = (x, 0.045, z)
            bone(f'CatLegUp{i}', hip, knee, 'CatSpine')
            bone(f'CatLegLow{i}', knee, ankle, f'CatLegUp{i}')
            self.legs.append((hip, knee, ankle))
        # rabo em S: sobe, curva para trás e termina num gancho
        self.tail_pts = [(-0.25, 0.32, 0), (-0.36, 0.38, 0), (-0.43, 0.5, 0.01), (-0.42, 0.64, 0.02),
                         (-0.35, 0.74, 0.02), (-0.27, 0.78, 0.01), (-0.22, 0.74, 0)]
        for k in range(6):
            bone(f'CatTail{k}', self.tail_pts[k], self.tail_pts[k + 1], 'CatSpine' if k == 0 else f'CatTail{k - 1}')
        for b in eb:
            b.use_deform = True
        bpy.ops.object.mode_set(mode='OBJECT')

    # ---------------------------------------------------------------- malhas

    def _skin(self, name, bm, material, weights):
        """liga a malha ao esqueleto; weights(posição three) → {osso: peso}"""
        me = bpy.data.meshes.new(name)
        bm.normal_update()
        bm.to_mesh(me)
        bm.free()
        me.materials.append(material)
        me.shade_smooth()
        ob = bpy.data.objects.new(name, me)
        self.col.objects.link(ob)
        groups = {}
        for v in me.vertices:
            p = v.co
            for b, w in weights(Vector((p.x, p.z, -p.y))).items():
                if w <= 0:
                    continue
                g = groups.get(b) or ob.vertex_groups.new(name=b)
                groups[b] = g
                g.add([v.index], w, 'REPLACE')
        ob.parent = self.rig
        ob.location = (0, 0, 0)
        mod = ob.modifiers.new('Armature', 'ARMATURE')
        mod.object = self.rig
        return ob

    def _blob(self, name, balls, material, weights, resolution=0.011):
        mb = bpy.data.metaballs.new(name)
        mb.resolution = mb.render_resolution = resolution
        mb.threshold = 0.6
        for c, r, s in balls:
            e = mb.elements.new()
            e.co = V(*c)
            e.radius = r
            e.type = 'ELLIPSOID'
            e.size_x, e.size_y, e.size_z = s[0], s[2], s[1]
        tmp = bpy.data.objects.new(name + 'Tmp', mb)
        self.col.objects.link(tmp)
        bpy.context.view_layer.objects.active = tmp
        for o in bpy.context.view_layer.objects:
            o.select_set(o == tmp)
        bpy.ops.object.convert(target='MESH')
        tmp = bpy.context.view_layer.objects.active
        bm = bmesh.new()
        bm.from_mesh(tmp.data)
        old = tmp.data
        bpy.data.objects.remove(tmp)
        bpy.data.meshes.remove(old)
        return self._skin(name, bm, material, weights)

    def _ellipsoid(self, name, c, s, material, weights, rot=(0, 0, 0), segs=20):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=max(8, segs * 2 // 3), radius=1)
        bmesh.ops.scale(bm, vec=(s[0], s[2], s[1]), verts=bm.verts)
        from mathutils import Euler
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Euler((rot[0], -rot[2], rot[1])).to_matrix())
        bmesh.ops.translate(bm, vec=V(*c), verts=bm.verts)
        return self._skin(name, bm, material, weights)

    def _tube(self, name, path, radius, material, weights, segs=12):
        """tubo suave ao longo de pontos (coordenadas three) com pontas arredondadas"""
        bm = bmesh.new()
        pts = [V(*p) for p in path]
        rings = []
        prev_n = None
        for k, p in enumerate(pts):
            t = k / (len(pts) - 1)
            tan = (pts[min(k + 1, len(pts) - 1)] - pts[max(k - 1, 0)]).normalized()
            if prev_n is None:
                n = tan.cross(Vector((0, 1, 0)))
                if n.length < 1e-4:
                    n = tan.cross(Vector((1, 0, 0)))
            else:
                n = prev_n - tan * prev_n.dot(tan)
            n.normalize()
            prev_n = n
            b = tan.cross(n)
            r = radius(t)
            rings.append([bm.verts.new(p + (n * math.cos(TAU * i / segs) + b * math.sin(TAU * i / segs)) * r) for i in range(segs)])
        for a_, b_ in zip(rings, rings[1:]):
            for i in range(segs):
                j = (i + 1) % segs
                bm.faces.new((a_[i], a_[j], b_[j], b_[i]))
        for ring, p, d in ((rings[0], pts[0], pts[0] - pts[1]), (rings[-1], pts[-1], pts[-1] - pts[-2])):
            cap = bm.verts.new(p + d.normalized() * radius(0 if ring is rings[0] else 1) * 0.9)
            for i in range(segs):
                j = (i + 1) % segs
                bm.faces.new((ring[i], ring[j], cap) if ring is rings[-1] else (ring[j], ring[i], cap))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        return self._skin(name, bm, material, weights)

    # ---------------------------------------------------------------- modelo

    def build(self):
        spine = lambda p: {'CatSpine': 1.0}  # noqa: E731
        head = lambda p: {'CatHead': 1.0}  # noqa: E731

        # corpo em pera, peito estufado e pescoço curto
        self._blob('CatBody', [
            ((-0.12, 0.3, 0), 0.165, (1.0, 0.86, 0.86)),
            ((0.0, 0.28, 0), 0.16, (1.05, 0.8, 0.82)),
            ((0.12, 0.31, 0), 0.155, (0.95, 0.92, 0.86)),
            ((0.19, 0.4, 0), 0.105, (0.85, 1.1, 0.85)),
        ], self.fur, spine)
        self._ellipsoid('CatChest', (0.205, 0.34, 0), (0.035, 0.07, 0.055), self.white, spine)

        # cabeça grande com bochechas
        hx, hy = 0.27, 0.56
        self._blob('CatSkull', [
            ((hx, hy, 0), 0.19, (1.1, 0.92, 1.08)),
            ((hx + 0.04, hy - 0.06, 0.085), 0.1, (0.95, 0.85, 1.0)),
            ((hx + 0.04, hy - 0.06, -0.085), 0.1, (0.95, 0.85, 1.0)),
        ], self.fur, head)
        # máscara branca em amendoim + queixo
        for s in (-1, 1):
            self._ellipsoid(f'CatCheek{s}', (hx + 0.123, hy - 0.07, s * 0.045), (0.05, 0.055, 0.065), self.white, head)
        self._ellipsoid('CatChin', (hx + 0.103, hy - 0.12, 0), (0.045, 0.035, 0.05), self.white, head)
        self._ellipsoid('CatNose', (hx + 0.171, hy - 0.04, 0), (0.02, 0.016, 0.028), self.ink, head, segs=14)
        smile = [(hx + 0.153, hy - 0.075, z) for z in (-0.06,)] + [(hx + 0.171, hy - 0.098, 0)] + [(hx + 0.153, hy - 0.075, 0.06)]
        self._tube('CatSmile', _catmull([Vector(p) for p in smile], 12), lambda t: 0.006, self.ink, head, 6)

        # olhos enormes encostados, pupilas grandes e brilho
        for s in (-1, 1):
            self._ellipsoid(f'CatEyeWhite{s}', (hx + 0.118, hy + 0.045, s * 0.05), (0.026, 0.078, 0.054),
                            self.eye, head, rot=(0, s * 0.25, 0))
            self._ellipsoid(f'CatPupil{s}', (hx + 0.138, hy + 0.03, s * 0.046), (0.012, 0.042, 0.027), self.ink, head, segs=16)
            self._ellipsoid(f'CatShine{s}', (hx + 0.147, hy + 0.05, s * 0.041), (0.004, 0.01, 0.008), self.eye, head, segs=8)
            # orelhas grandes, curvadas para fora, com miolo rosado
            self._ear(s, hx, hy, head)
            for k, dy in enumerate((0.0, -0.025)):
                self._tube(f'CatWhisker{s}{k}', [(hx + 0.158, hy - 0.06 + dy, s * 0.06), (hx + 0.188, hy - 0.055 + dy * 1.8, s * 0.16),
                                                 (hx + 0.198, hy - 0.06 + dy * 3, s * 0.25)], lambda t: 0.004 * (1 - 0.6 * t),
                           self.white, head, 5)

        # pernas de "mangueira" que dobram no joelho + patas de luva
        for i, (hip, knee, ankle) in enumerate(self.legs):
            H, K, A = Vector(hip), Vector(knee), Vector(ankle)
            up, low = f'CatLegUp{i}', f'CatLegLow{i}'

            def leg_w(p, H=H, K=K, A=A, up=up, low=low):
                # mistura suave em volta do joelho, pela altura
                k = _smooth(K.y + 0.03, K.y - 0.03, p.y)
                return {up: 1 - k, low: k}

            path = _catmull([H + Vector((0, 0.02, 0)), K, A], 14)
            self._tube(f'CatLeg{i}', path, lambda t: 0.032 - 0.008 * t, self.fur, leg_w, 10)
            self._ellipsoid(f'CatPaw{i}', (ankle[0] + 0.025, 0.03, ankle[2]), (0.056, 0.032, 0.044), self.white,
                            lambda p, low=low: {low: 1.0}, segs=16)

        # rabo contínuo, peso distribuído pelos 6 ossos
        pts = [Vector(p) for p in self.tail_pts]
        lengths = [0.0]
        for a_, b_ in zip(pts, pts[1:]):
            lengths.append(lengths[-1] + (b_ - a_).length)

        def tail_w(p):
            best, bt = 0, 1e9
            for k in range(6):
                a_, b_ = pts[k], pts[k + 1]
                ab = b_ - a_
                t = max(0.0, min(1.0, (p - a_).dot(ab) / ab.length_squared))
                d = (a_ + ab * t - p).length
                if d < bt:
                    best, bt, tt = k, d, t
            w = {f'CatTail{best}': 1.0}
            if tt > 0.65 and best < 5:
                f = (tt - 0.65) / 0.35 * 0.5
                w = {f'CatTail{best}': 1 - f, f'CatTail{best + 1}': f}
            elif tt < 0.35:
                f = (0.35 - tt) / 0.35 * 0.5
                w = {f'CatTail{best}': 1 - f, (f'CatTail{best - 1}' if best > 0 else 'CatSpine'): f}
            return w

        self._tube('CatTail', _catmull(pts, 40), lambda t: 0.032 - 0.016 * t, self.fur, tail_w, 10)

    def _ear(self, s, hx, hy, weights):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=18, radius1=0.075, radius2=0.004, depth=0.16)
        bmesh.ops.scale(bm, vec=(0.45, 1.0, 1.0), verts=bm.verts)
        for v in bm.verts:
            h = (v.co.z + 0.08) / 0.16
            v.co.y -= s * 0.03 * h * h
        inner = bmesh.new()
        bmesh.ops.create_cone(inner, cap_ends=True, segments=12, radius1=0.045, radius2=0.002, depth=0.11)
        bmesh.ops.scale(inner, vec=(0.2, 1.0, 1.0), verts=inner.verts)
        from mathutils import Euler, Matrix
        place = Matrix.Translation(V(hx - 0.04, hy + 0.15, s * 0.11)) @ Euler((s * -0.4, 0.15, s * 0.25)).to_matrix().to_4x4()
        bmesh.ops.transform(bm, matrix=place, verts=bm.verts)
        bmesh.ops.transform(inner, matrix=place @ Matrix.Translation((0.024, 0, -0.012)), verts=inner.verts)
        self._skin(f'CatEar{s}', bm, self.fur, weights)
        self._skin(f'CatEarInner{s}', inner, self.pink, weights)


def build_cat(col, at):
    cat = Cat(col, at)
    cat.build()
    return cat.rig
