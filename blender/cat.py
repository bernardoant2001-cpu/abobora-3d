"""
Gato preto de desenho animado dos anos 30 (chamado por scene.py).

Peças separadas e com pivôs nos lugares certos para o site animar:
Cat (raiz, no chão) > CatBody, CatHead (pivô no pescoço), CatLeg0..3 (pivô no quadril/ombro),
CatTail0 > CatTail1 > CatTail2 > CatTail3 (cada um gira um pouco e o rabo ondula).
Olha para +x; 1 unidade = mesma escala da mesa.
"""
import bpy
import bmesh
import math
from mathutils import Vector


def V(x, y, z):
    return Vector((x, -z, y))


def _mat(name, color, rough, emit=None, strength=0.0):
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


def _blob(name, balls, material, col, resolution=0.012):
    """metaballs (centro, raio, escala xyz) fundidos e convertidos em malha"""
    mb = bpy.data.metaballs.new(name)
    mb.resolution = resolution
    mb.render_resolution = resolution
    mb.threshold = 0.6
    for c, r, s in balls:
        e = mb.elements.new()
        e.co = V(*c)
        e.radius = r
        e.type = 'ELLIPSOID'
        e.size_x, e.size_y, e.size_z = s[0], s[2], s[1]
    ob = bpy.data.objects.new(name, mb)
    col.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.view_layer.objects:
        o.select_set(o == ob)
    bpy.ops.object.convert(target='MESH')
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    ob.data.materials.clear()
    ob.data.materials.append(material)
    ob.data.shade_smooth()
    return ob


def _ellipsoid(name, c, s, material, col, segs=24):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=max(8, segs * 2 // 3), radius=1)
    bmesh.ops.scale(bm, vec=(s[0], s[2], s[1]), verts=bm.verts)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material)
    me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    ob.location = V(*c)
    col.objects.link(ob)
    return ob


def _whisker(name, a, b, material, col, r=0.0035):
    bm = bmesh.new()
    pa, pb = V(*a), V(*b)
    d = (pb - pa)
    bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=r, radius2=r * 0.4, depth=d.length)
    rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=rot, verts=bm.verts)
    bmesh.ops.translate(bm, vec=(pa + pb) / 2, verts=bm.verts)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material)
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    return ob


def _ear(name, c, side, fur, inner, col):
    """orelha em cone achatado, levemente curvada para fora, com miolo mais claro"""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.055, radius2=0.004, depth=0.11)
    bmesh.ops.scale(bm, vec=(1.0, 0.45, 1.0), verts=bm.verts)
    for v in bm.verts:
        h = (v.co.z + 0.055) / 0.11
        v.co.x -= 0.02 * h * h
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(fur)
    me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    ob.location = V(*c)
    ob.rotation_euler = (side * -0.35, 0.15, side * 0.2)
    col.objects.link(ob)

    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=0.032, radius2=0.002, depth=0.075)
    bmesh.ops.scale(bm, vec=(1.0, 0.25, 1.0), verts=bm.verts)
    me = bpy.data.meshes.new(name + 'Inner')
    bm.to_mesh(me)
    bm.free()
    me.materials.append(inner)
    me.shade_smooth()
    io = bpy.data.objects.new(name + 'Inner', me)
    io.location = (0.012, -0.012, -0.012)
    io.parent = ob
    col.objects.link(io)
    return ob


def build_cat(col, at):
    fur = _mat('CatFur', '#0d0a0a', 0.55)
    white = _mat('CatWhite', '#f4ead2', 0.6)
    eye = _mat('CatEye', '#fffaf0', 0.25, emit=True, strength=0.0)
    pupil = _mat('CatPupil', '#050303', 0.15)
    pink = _mat('CatInner', '#4a3030', 0.8)

    root = bpy.data.objects.new('Cat', None)
    root.location = at
    col.objects.link(root)

    body = _blob('CatBody', [
        ((-0.13, 0.28, 0), 0.17, (1.0, 0.88, 0.9)),
        ((-0.01, 0.27, 0), 0.16, (1.0, 0.82, 0.85)),
        ((0.11, 0.3, 0), 0.16, (0.95, 0.92, 0.86)),
        ((0.18, 0.38, 0), 0.12, (0.85, 1.15, 0.85)),
        ((0.21, 0.45, 0), 0.1, (0.85, 1.0, 0.85)),
    ], fur, col)
    body.parent = root
    # peito branco
    chest = _ellipsoid('CatChest', (0.2, 0.33, 0), (0.035, 0.06, 0.05), white, col)
    chest.parent = root

    # cabeça: pivô no pescoço
    neck = bpy.data.objects.new('CatHead', None)
    neck.location = V(0.22, 0.44, 0)
    neck.parent = root
    col.objects.link(neck)
    hx, hy = 0.07, 0.07  # centro do crânio em relação ao pescoço
    head = _blob('CatSkull', [
        ((hx, hy, 0), 0.17, (1.0, 0.92, 1.12)),
        ((hx + 0.02, hy - 0.04, 0.06), 0.1, (0.9, 0.8, 1.0)),
        ((hx + 0.02, hy - 0.04, -0.06), 0.1, (0.9, 0.8, 1.0)),
    ], fur, col)
    head.parent = neck
    muzzle = _ellipsoid('CatMuzzle', (hx + 0.085, hy - 0.045, 0), (0.05, 0.045, 0.075), white, col)
    muzzle.parent = neck
    nose = _ellipsoid('CatNose', (hx + 0.135, hy - 0.02, 0), (0.014, 0.011, 0.02), pupil, col, 12)
    nose.parent = neck
    for s in (-1, 1):
        e = _ellipsoid(f'CatEyeWhite{s}', (hx + 0.098, hy + 0.035, s * 0.042), (0.025, 0.05, 0.034), eye, col)
        e.parent = neck
        p = _ellipsoid(f'CatPupil{s}', (hx + 0.118, hy + 0.028, s * 0.04), (0.012, 0.03, 0.018), pupil, col, 16)
        p.parent = neck
        hl = _ellipsoid(f'CatShine{s}', (hx + 0.128, hy + 0.045, s * 0.036), (0.004, 0.007, 0.006), eye, col, 8)
        hl.parent = neck
        ear = _ear(f'CatEar{s}', (hx - 0.02, hy + 0.1, s * 0.065), s, fur, pink, col)
        ear.parent = neck
        for k, dy in enumerate((-0.005, -0.025)):
            w = _whisker(f'CatWhisker{s}{k}', (hx + 0.11, hy - 0.04 + dy, s * 0.05),
                         (hx + 0.13, hy - 0.03 + dy * 2.5, s * 0.19), white, col)
            w.parent = neck

    # pernas: pivô no ombro/quadril, patinha branca de luva
    for i, (x, z) in enumerate(((0.14, 0.07), (0.14, -0.07), (-0.16, 0.075), (-0.16, -0.075))):
        pivot = bpy.data.objects.new(f'CatLeg{i}', None)
        pivot.location = V(x, 0.24, z)
        pivot.parent = root
        col.objects.link(pivot)
        leg = _blob(f'CatLegMesh{i}', [
            ((0, -0.01, 0), 0.09, (0.72, 1.0, 0.72)),
            ((0, -0.1, 0), 0.07, (0.56, 1.1, 0.56)),
            ((0.005, -0.18, 0), 0.065, (0.55, 1.0, 0.55)),
        ], fur, col)
        leg.parent = pivot
        paw = _ellipsoid(f'CatPaw{i}', (0.018, -0.218, 0), (0.042, 0.024, 0.033), white, col, 16)
        paw.parent = pivot

    # rabo em 4 segmentos aninhados (cada um começa na ponta do anterior)
    parent = root
    base = V(-0.26, 0.33, 0)
    for k in range(4):
        r0 = 0.03 - k * 0.005
        seg_len = 0.13
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=r0, radius2=r0 - 0.005, depth=seg_len)
        bmesh.ops.translate(bm, vec=(0, 0, seg_len / 2), verts=bm.verts)
        bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=r0 + 0.002)
        me = bpy.data.meshes.new(f'CatTail{k}')
        bm.to_mesh(me)
        bm.free()
        me.materials.append(fur)
        me.shade_smooth()
        seg = bpy.data.objects.new(f'CatTail{k}', me)
        col.objects.link(seg)
        seg.parent = parent
        if k == 0:
            seg.location = base
            # rabo para trás e para cima
            seg.rotation_euler = (0, math.radians(-60), 0)
        else:
            seg.location = (0, 0, seg_len)
            seg.rotation_euler = (0, math.radians((20, 30, 45)[k - 1]), 0)
        parent = seg
    return root
