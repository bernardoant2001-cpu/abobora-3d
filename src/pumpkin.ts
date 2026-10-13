import * as THREE from 'three'
import type { Pt, Stencil } from './stencils'

export const RADIUS = 1.25
const SQUASH = 0.8
const RIBS = 10
const SEG_W = 192
const SEG_H = 128
const MASK_W = 2048
const MASK_H = 1024
const WALL = 0.92

export function pumpkinGeometry() {
  const geo = new THREE.SphereGeometry(1, SEG_W, SEG_H, -Math.PI / 2)
  const pos = geo.attributes.position
  const uv = geo.attributes.uv
  const colors = new Float32Array(pos.count * 3)
  const lobe = new THREE.Color('#ff8a1f')
  const groove = new THREE.Color('#b9420d')
  const crown = new THREE.Color('#8f4512')
  const c = new THREE.Color()

  for (let i = 0; i < pos.count; i++) {
    const phi = uv.getX(i) * Math.PI * 2
    const theta = (1 - uv.getY(i)) * Math.PI
    const s = Math.sin(theta)
    const h = Math.cos(theta)
    const g = 1 - Math.sqrt(Math.abs(Math.cos((RIBS * phi) / 2)))
    const r = (1 - 0.1 * g) * (1 + 0.05 * Math.max(0, -h))
    const pole = Math.exp(-(s * s) / 0.05)
    const y = h * SQUASH - Math.sign(h) * (h > 0 ? 0.32 : 0.2) * pole
    pos.setXYZ(i, pos.getX(i) * r * RADIUS, y * RADIUS, pos.getZ(i) * r * RADIUS)
    c.copy(lobe)
      .lerp(groove, Math.pow(g, 0.7))
      .lerp(crown, Math.exp(-(s * s) / 0.15) * (h > 0 ? 0.85 : 0.4))
    c.toArray(colors, i * 3)
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.computeVertexNormals()

  // a costura do UV duplica vértices; média das normais para não aparecer a emenda
  const n = geo.attributes.normal
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  for (let y = 0; y <= SEG_H; y++) {
    const i = y * (SEG_W + 1)
    const j = i + SEG_W
    a.fromBufferAttribute(n, i).add(b.fromBufferAttribute(n, j)).normalize()
    n.setXYZ(i, a.x, a.y, a.z)
    n.setXYZ(j, a.x, a.y, a.z)
  }
  geo.computeBoundingBox()
  return geo
}

/**
 * Máscara pintada em UV: branco = casca, preto = escavado.
 * Vira o alphaMap da casca e da parede interna.
 */
export class Carver {
  readonly canvas = document.createElement('canvas')
  readonly texture: THREE.CanvasTexture
  dirty = false
  private ctx: CanvasRenderingContext2D
  private snap = document.createElement('canvas')
  private snapCtx: CanvasRenderingContext2D
  private history: { x: number; y: number; data: ImageData }[] = []
  private box = [Infinity, Infinity, -Infinity, -Infinity]
  private last: [number, number] | null = null
  private cut: CanvasGradient
  private patch: CanvasGradient

  constructor() {
    this.canvas.width = this.snap.width = MASK_W
    this.canvas.height = this.snap.height = MASK_H
    this.ctx = this.canvas.getContext('2d')!
    this.snapCtx = this.snap.getContext('2d', { willReadFrequently: true })!
    this.ctx.fillStyle = '#fff'
    this.ctx.fillRect(0, 0, MASK_W, MASK_H)

    this.cut = this.ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
    this.cut.addColorStop(0.55, 'rgba(0,0,0,1)')
    this.cut.addColorStop(1, 'rgba(0,0,0,0)')
    this.patch = this.ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
    this.patch.addColorStop(0.55, 'rgba(255,255,255,1)')
    this.patch.addColorStop(1, 'rgba(255,255,255,0)')

    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.wrapS = THREE.RepeatWrapping
  }

  begin() {
    this.snapCtx.drawImage(this.canvas, 0, 0)
    this.box = [Infinity, Infinity, -Infinity, -Infinity]
    this.last = null
  }

  end() {
    this.last = null
    const x = Math.max(0, Math.floor(this.box[0]))
    const y = Math.max(0, Math.floor(this.box[1]))
    const w = Math.min(MASK_W, Math.ceil(this.box[2])) - x
    const h = Math.min(MASK_H, Math.ceil(this.box[3])) - y
    if (w <= 0 || h <= 0) return
    this.history.push({ x, y, data: this.snapCtx.getImageData(x, y, w, h) })
    if (this.history.length > 40) this.history.shift()
  }

  /** interrompe a interpolação quando o traço sai da abóbora */
  lift() {
    this.last = null
  }

  paint(uv: THREE.Vector2, size: number, carve: boolean) {
    const x = uv.x * MASK_W
    const y = (1 - uv.y) * MASK_H
    const theta = (1 - uv.y) * Math.PI
    const s = Math.sin(theta)
    const c = Math.cos(theta)
    const rx = (size * MASK_W) / (2 * Math.PI * RADIUS * Math.max(s, 0.15))
    const ry = (size * MASK_H) / (Math.PI * RADIUS * Math.sqrt(c * c + SQUASH * SQUASH * s * s))

    if (this.last && Math.abs(x - this.last[0]) < MASK_W / 2) {
      const [lx, ly] = this.last
      const steps = Math.ceil(Math.hypot((x - lx) / rx, (y - ly) / ry) / 0.2)
      for (let i = 1; i <= steps; i++) {
        this.stamp(lx + ((x - lx) * i) / steps, ly + ((y - ly) * i) / steps, rx, ry, carve)
      }
    } else {
      this.stamp(x, y, rx, ry, carve)
    }
    this.last = [x, y]
  }

  undo() {
    const step = this.history.pop()
    if (!step) return
    this.ctx.putImageData(step.data, step.x, step.y)
    this.dirty = true
  }

  clear() {
    this.replace(() => {})
  }

  stencil(s: Stencil) {
    this.replace((ctx) => {
      const path = (pts: Pt[], color: string) => {
        ctx.filter = 'blur(5px)'
        ctx.fillStyle = color
        ctx.beginPath()
        for (const p of pts) ctx.lineTo(...project(p))
        ctx.closePath()
        ctx.fill()
        ctx.filter = 'none'
      }
      s.draw({ carve: (p) => path(p, '#000'), keep: (p) => path(p, '#fff') })
    })
  }

  private replace(draw: (ctx: CanvasRenderingContext2D) => void) {
    this.begin()
    this.ctx.fillStyle = '#fff'
    this.ctx.fillRect(0, 0, MASK_W, MASK_H)
    draw(this.ctx)
    this.box = [0, 0, MASK_W, MASK_H]
    this.end()
    this.dirty = true
  }

  private stamp(x: number, y: number, rx: number, ry: number, carve: boolean) {
    const ctx = this.ctx
    ctx.fillStyle = carve ? this.cut : this.patch
    for (const ox of [0, -MASK_W, MASK_W]) {
      const cx = x + ox
      if (cx + rx < 0 || cx - rx > MASK_W) continue
      ctx.setTransform(rx, 0, 0, ry, cx, y)
      ctx.beginPath()
      ctx.arc(0, 0, 1, 0, Math.PI * 2)
      ctx.fill()
      this.box[0] = Math.min(this.box[0], cx - rx)
      this.box[1] = Math.min(this.box[1], y - ry)
      this.box[2] = Math.max(this.box[2], cx + rx)
      this.box[3] = Math.max(this.box[3], y + ry)
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.dirty = true
  }
}

/** coordenadas na superfície (comprimento de arco a partir do centro da frente) → pixel da máscara */
function project([a, b]: Pt): [number, number] {
  const theta = Math.PI / 2 - b / (RADIUS * SQUASH)
  const phi = a / (RADIUS * Math.sin(theta) * 0.97)
  return [MASK_W * (0.5 + phi / (Math.PI * 2)), (MASK_H * theta) / Math.PI]
}

export function createStem() {
  const geo = new THREE.CylinderGeometry(0.07, 0.12, 0.5, 16, 12)
  const p = geo.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const z = p.getZ(i)
    const y = p.getY(i) + 0.25
    const k = (1 + 0.12 * Math.cos(Math.atan2(z, x) * 7)) * (1 + 0.9 * Math.exp(-y * 18))
    p.setXYZ(i, x * k + 0.55 * y * y, y, z * k)
  }
  geo.computeVertexNormals()
  const side = new THREE.MeshStandardMaterial({ color: '#5f7326', roughness: 0.85 })
  const cap = new THREE.MeshStandardMaterial({ color: '#c8b27a', roughness: 0.9 })
  const stem = new THREE.Mesh(geo, [side, cap, cap])
  stem.castShadow = true
  return stem
}

export function leafGeometry() {
  const s = new THREE.Shape()
  s.moveTo(0, 0)
  s.bezierCurveTo(0.14, 0.04, 0.2, 0.22, 0, 0.42)
  s.bezierCurveTo(-0.2, 0.22, -0.14, 0.04, 0, 0)
  const geo = new THREE.ShapeGeometry(s, 16)
  const p = geo.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const y = p.getY(i)
    p.setZ(i, x * x * 1.6 - y * y * 0.35)
  }
  geo.computeVertexNormals()
  return geo
}

function createVine() {
  const base = new THREE.Vector3(0.06, 0.62, 0.02)
  const end = new THREE.Vector3(0.7, 1.05, -0.25)
  const dir = end.clone().sub(base).normalize()
  const u = new THREE.Vector3(0, 1, 0).cross(dir).normalize()
  const v = dir.clone().cross(u)
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= 60; i++) {
    const t = i / 60
    const a = t * Math.PI * 9
    const r = 0.075 * (1 - 0.55 * t) * Math.min(1, t * 6)
    pts.push(
      base.clone().lerp(end, t).addScaledVector(u, Math.cos(a) * r).addScaledVector(v, Math.sin(a) * r),
    )
  }
  const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 200, 0.014, 6)
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#557a22', roughness: 0.7 }))
}

const FLESH_SKIN = 'vec3( 1.0, 0.75, 0.35 )'

export function createCarvedPumpkin(geo: THREE.BufferGeometry, mask: THREE.Texture, glow: { value: number }) {
  const group = new THREE.Group()

  const skin = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.48,
    alphaMap: mask,
    alphaTest: 0.5,
  })
  skin.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = glow
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGlow;')
      .replace(
        '#include <alphamap_fragment>',
        `float carve = texture2D( alphaMap, vAlphaMapUv ).g;
        diffuseColor.a *= carve;
        float rim = 1.0 - smoothstep( 0.5, 1.0, carve );
        diffuseColor.rgb = mix( diffuseColor.rgb, ${FLESH_SKIN}, rim );`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3( 1.0, 0.55, 0.15 ) * rim * uGlow;`,
      )
  }

  // parede interna: frente = polpa (espessura do corte), verso = interior iluminado pela vela
  const flesh = new THREE.MeshStandardMaterial({
    color: '#ff9a2e',
    roughness: 0.9,
    side: THREE.DoubleSide,
    alphaMap: mask,
    alphaTest: 0.5,
  })
  flesh.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = glow
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGlow;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if ( gl_FrontFacing ) diffuseColor.rgb = vec3( 1.0, 0.78, 0.42 );`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += ( gl_FrontFacing ? vec3( 0.5, 0.26, 0.07 ) : vec3( 1.0, 0.38, 0.05 ) * 0.8 ) * uGlow;`,
      )
  }

  const outer = new THREE.Mesh(geo, skin)
  outer.castShadow = true
  const inner = new THREE.Mesh(geo, flesh)
  inner.scale.setScalar(WALL)
  inner.castShadow = true

  const top = (SQUASH - 0.32) * RADIUS
  const bottom = -(SQUASH - 0.2) * RADIUS * WALL

  const stem = createStem()
  stem.position.y = top - 0.06
  stem.rotation.y = 0.6

  const vine = createVine()
  vine.castShadow = true

  const leaf = new THREE.Mesh(
    leafGeometry(),
    new THREE.MeshStandardMaterial({ color: '#5c8a2b', roughness: 0.75, side: THREE.DoubleSide }),
  )
  leaf.position.set(-0.08, top + 0.02, 0.06)
  leaf.rotation.set(-1.05, 0.2, 0.9)
  leaf.castShadow = true

  const wax = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.13, 0.09, 24),
    new THREE.MeshStandardMaterial({ color: '#f3ead8', roughness: 0.6, emissive: '#ffb060', emissiveIntensity: 0.4 }),
  )
  wax.position.y = bottom + 0.045
  const flame = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 2.6, 0.8) }),
  )
  flame.scale.set(0.035, 0.085, 0.035)
  flame.position.y = bottom + 0.16

  const light = new THREE.PointLight('#ff9b3d', 5, 0, 2)
  light.position.y = bottom + 0.3
  light.castShadow = true
  light.shadow.mapSize.set(1024, 1024)
  light.shadow.bias = -0.004
  light.shadow.normalBias = 0.02
  light.shadow.camera.near = 0.05

  group.add(outer, inner, stem, vine, leaf, wax, flame, light)
  group.position.y = -geo.boundingBox!.min.y
  return { group, outer, flame, light }
}

export function createSmallPumpkin(geo: THREE.BufferGeometry, scale: number) {
  const group = new THREE.Group()
  const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }))
  body.castShadow = true
  body.receiveShadow = true
  const stem = createStem()
  stem.position.y = (SQUASH - 0.32) * RADIUS - 0.06
  group.add(body, stem)
  group.scale.setScalar(scale)
  group.position.y = -geo.boundingBox!.min.y * scale
  return group
}
