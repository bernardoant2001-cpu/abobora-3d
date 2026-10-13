import * as THREE from 'three'
import type { Pt, Stencil } from './stencils'
import { createFlame } from './flame'
import { FX } from './world'

// mesmas medidas usadas em blender/scene.py
export const RADIUS = 1.25
const SQUASH = 0.8
const MASK_W = 2048
const MASK_H = 1024
const GUIDE_W = 1024
const GUIDE_H = 512
const WALL = 0.92

type P = [number, number]
export type Brush = 'carve' | 'shave' | 'restore'

// contorno em zigue-zague da tampa, em UV (v = 1 no topo); igual ao LID_GLSL abaixo
const lidEdge = (u: number) => 0.835 + 0.02 * Math.abs((((u * 14) % 1) + 1) % 1 - 0.5) * 2
const LID_GLSL = `
uniform float uLid;
float lidEdge( float u ) { return 0.835 + 0.02 * abs( fract( u * 14.0 ) - 0.5 ) * 2.0; }
float lidCut( vec2 uv ) { return uLid * smoothstep( lidEdge( uv.x ) - 0.003, lidEdge( uv.x ) + 0.003, uv.y ); }
`

/**
 * Máscara pintada em UV: branco = casca, preto = escavado.
 * Vira o alphaMap da casca e da parede interna.
 * A guia (outra textura) mostra o contorno do recorte reto antes de cortar.
 */
export class Carver {
  readonly canvas = document.createElement('canvas')
  readonly texture: THREE.CanvasTexture
  readonly guideTexture: THREE.CanvasTexture
  dirty = false
  guideDirty = false
  private ctx: CanvasRenderingContext2D
  private guide = document.createElement('canvas')
  private gctx: CanvasRenderingContext2D
  private snap = document.createElement('canvas')
  private snapCtx: CanvasRenderingContext2D
  private history: { x: number; y: number; data: ImageData }[] = []
  private box = [Infinity, Infinity, -Infinity, -Infinity]
  private last: P | null = null
  private poly: P[] = []
  private cut: CanvasGradient
  private patch: CanvasGradient
  private peel: CanvasGradient
  private probe = document.createElement('canvas')

  constructor() {
    this.canvas.width = this.snap.width = MASK_W
    this.canvas.height = this.snap.height = MASK_H
    this.guide.width = GUIDE_W
    this.guide.height = GUIDE_H
    this.ctx = this.canvas.getContext('2d')!
    this.gctx = this.guide.getContext('2d')!
    this.snapCtx = this.snap.getContext('2d', { willReadFrequently: true })!
    this.ctx.fillStyle = '#fff'
    this.ctx.fillRect(0, 0, MASK_W, MASK_H)
    this.gctx.fillStyle = '#000'
    this.gctx.fillRect(0, 0, GUIDE_W, GUIDE_H)

    this.cut = this.ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
    this.cut.addColorStop(0.55, 'rgba(0,0,0,1)')
    this.cut.addColorStop(1, 'rgba(0,0,0,0)')
    this.patch = this.ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
    this.patch.addColorStop(0.55, 'rgba(255,255,255,1)')
    this.patch.addColorStop(1, 'rgba(255,255,255,0)')
    // raspar só tira o vermelho (a casca fina); o verde continua dizendo que não está furado
    this.peel = this.ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
    this.peel.addColorStop(0, 'rgba(0,255,255,0.22)')
    this.peel.addColorStop(0.6, 'rgba(0,255,255,0.22)')
    this.peel.addColorStop(1, 'rgba(0,255,255,0)')
    this.probe.width = 64
    this.probe.height = 32

    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.wrapS = THREE.RepeatWrapping
    this.guideTexture = new THREE.CanvasTexture(this.guide)
    this.guideTexture.wrapS = THREE.RepeatWrapping
  }

  get points() {
    return this.poly.length
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

  /** fração da casca que já foi furada (amostra reduzida, barata) */
  carvedFraction() {
    const g = this.probe.getContext('2d', { willReadFrequently: true })!
    g.drawImage(this.canvas, 0, 0, 64, 32)
    const d = g.getImageData(0, 0, 64, 32).data
    let n = 0
    for (let i = 1; i < d.length; i += 4) if (d[i] < 128) n++
    return n / (64 * 32)
  }

  paint(uv: THREE.Vector2, size: number, mode: Brush) {
    const x = uv.x * MASK_W
    const y = (1 - uv.y) * MASK_H
    const [kx, ky] = scale(uv.y)
    const rx = size * kx
    const ry = size * ky

    if (this.last && Math.abs(x - this.last[0]) < MASK_W / 2) {
      const [lx, ly] = this.last
      const steps = Math.ceil(Math.hypot((x - lx) / rx, (y - ly) / ry) / 0.2)
      for (let i = 1; i <= steps; i++) {
        this.stamp(lx + ((x - lx) * i) / steps, ly + ((y - ly) * i) / steps, rx, ry, mode)
      }
    } else {
      this.stamp(x, y, rx, ry, mode)
    }
    this.last = [x, y]
  }

  /** recorte reto: adiciona um canto; clicar de novo no primeiro canto fecha e corta */
  addPoint(uv: THREE.Vector2) {
    const p = this.toMask(uv)
    if (this.poly.length >= 3 && this.nearFirst(p, uv.y)) return this.cutPolygon()
    this.poly.push(p)
    this.drawGuide()
    return false
  }

  removePoint() {
    this.poly.pop()
    this.drawGuide()
  }

  cancelPolygon() {
    if (!this.poly.length) return
    this.poly = []
    this.drawGuide()
  }

  hover(uv: THREE.Vector2 | null) {
    if (this.poly.length) this.drawGuide(uv)
  }

  cutPolygon() {
    if (this.poly.length < 3) return false
    const pts = this.poly
    this.poly = []
    this.begin()
    const ctx = this.ctx
    ctx.filter = 'blur(3px)'
    ctx.fillStyle = '#000'
    for (const ox of [0, -MASK_W, MASK_W]) {
      ctx.beginPath()
      for (const [x, y] of pts) ctx.lineTo(x + ox, y)
      ctx.closePath()
      ctx.fill()
    }
    ctx.filter = 'none'
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const wraps = Math.min(...xs) < 0 || Math.max(...xs) > MASK_W
    this.box = [
      wraps ? 0 : Math.min(...xs) - 10,
      Math.min(...ys) - 10,
      wraps ? MASK_W : Math.max(...xs) + 10,
      Math.max(...ys) + 10,
    ]
    this.end()
    this.dirty = true
    this.drawGuide()
    return true
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

  private toMask(uv: THREE.Vector2): P {
    let x = uv.x * MASK_W
    const first = this.poly[0]
    if (first && x - first[0] > MASK_W / 2) x -= MASK_W
    else if (first && first[0] - x > MASK_W / 2) x += MASK_W
    return [x, (1 - uv.y) * MASK_H]
  }

  private nearFirst(p: P, v: number) {
    const [kx, ky] = scale(v)
    const f = this.poly[0]
    return Math.hypot((p[0] - f[0]) / kx, (p[1] - f[1]) / ky) < 0.07
  }

  private drawGuide(cursor: THREE.Vector2 | null = null) {
    const g = this.gctx
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.fillStyle = '#000'
    g.fillRect(0, 0, GUIDE_W, GUIDE_H)
    this.guideDirty = true
    if (!this.poly.length) return

    const c = cursor ? this.toMask(cursor) : null
    const closing = !!c && this.poly.length >= 3 && this.nearFirst(c, cursor!.y)
    const k = GUIDE_W / MASK_W
    g.lineJoin = g.lineCap = 'round'
    for (const ox of [0, -MASK_W, MASK_W]) {
      g.setTransform(k, 0, 0, k, ox * k, 0)
      g.strokeStyle = '#fff'
      g.lineWidth = 5
      g.beginPath()
      for (const [x, y] of this.poly) g.lineTo(x, y)
      g.stroke()
      if (c) {
        g.globalAlpha = 0.55
        g.beginPath()
        g.moveTo(...this.poly[this.poly.length - 1])
        g.lineTo(...(closing ? this.poly[0] : c))
        g.stroke()
        g.globalAlpha = 1
      }
      g.fillStyle = '#fff'
      this.poly.forEach(([x, y], i) => {
        g.beginPath()
        g.arc(x, y, i === 0 ? (closing ? 20 : 13) : 9, 0, Math.PI * 2)
        g.fill()
      })
    }
    g.setTransform(1, 0, 0, 1, 0, 0)
  }

  private replace(draw: (ctx: CanvasRenderingContext2D) => void) {
    this.cancelPolygon()
    this.begin()
    this.ctx.fillStyle = '#fff'
    this.ctx.fillRect(0, 0, MASK_W, MASK_H)
    draw(this.ctx)
    this.box = [0, 0, MASK_W, MASK_H]
    this.end()
    this.dirty = true
  }

  private stamp(x: number, y: number, rx: number, ry: number, mode: Brush) {
    const ctx = this.ctx
    ctx.fillStyle = mode === 'carve' ? this.cut : mode === 'shave' ? this.peel : this.patch
    ctx.globalCompositeOperation = mode === 'shave' ? 'multiply' : 'source-over'
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
    ctx.globalCompositeOperation = 'source-over'
    this.dirty = true
  }
}

/** pixels da máscara por unidade de superfície, na latitude dada pelo v */
function scale(v: number): P {
  const theta = (1 - v) * Math.PI
  const s = Math.sin(theta)
  const c = Math.cos(theta)
  return [
    MASK_W / (2 * Math.PI * RADIUS * Math.max(s, 0.15)),
    MASK_H / (Math.PI * RADIUS * Math.sqrt(c * c + SQUASH * SQUASH * s * s)),
  ]
}

/** coordenadas na superfície (comprimento de arco a partir do centro da frente) → pixel da máscara */
function project([a, b]: Pt): P {
  const theta = Math.PI / 2 - b / (RADIUS * SQUASH)
  const phi = a / (RADIUS * Math.sin(theta) * 0.97)
  return [MASK_W * (0.5 + phi / (Math.PI * 2)), (MASK_H * theta) / Math.PI]
}

const FLESH_SKIN = 'vec3( 1.0, 0.75, 0.35 )'

/** separa a tampa (topo em zigue-zague) e a faixa de polpa da borda dela */
function lidGeometry(geo: THREE.BufferGeometry) {
  const uv = geo.getAttribute('uv')
  const pos = geo.getAttribute('position')
  const index = geo.index!
  const keep: number[] = []
  for (let i = 0; i < index.count; i += 3) {
    const tri = [index.getX(i), index.getX(i + 1), index.getX(i + 2)]
    if (tri.every((k) => uv.getY(k) > lidEdge(uv.getX(k)) - 0.012)) keep.push(...tri)
  }
  const lid = new THREE.BufferGeometry()
  for (const [name, attr] of Object.entries(geo.attributes)) lid.setAttribute(name, attr)
  lid.setIndex(keep)

  // arestas usadas por um só triângulo formam a borda; liga a casca de fora à de dentro
  const open = new Map<string, [number, number]>()
  for (let i = 0; i < keep.length; i += 3) {
    for (let e = 0; e < 3; e++) {
      const a = keep[i + e]
      const b = keep[i + ((e + 1) % 3)]
      const key = a < b ? `${a}_${b}` : `${b}_${a}`
      if (open.has(key)) open.delete(key)
      else open.set(key, [a, b])
    }
  }
  const strip: number[] = []
  const va = new THREE.Vector3()
  const vb = new THREE.Vector3()
  for (const [a, b] of open.values()) {
    va.fromBufferAttribute(pos, a)
    vb.fromBufferAttribute(pos, b)
    const ia = va.clone().multiplyScalar(WALL)
    const ib = vb.clone().multiplyScalar(WALL)
    strip.push(...vb.toArray(), ...va.toArray(), ...ia.toArray(), ...vb.toArray(), ...ia.toArray(), ...ib.toArray())
  }
  const rim = new THREE.BufferGeometry()
  rim.setAttribute('position', new THREE.Float32BufferAttribute(strip, 3))
  rim.computeVertexNormals()
  // a tampa compartilha o atributo de posição da abóbora inteira: mede só os vértices dela
  const bottom = Math.min(...keep.map((k) => pos.getY(k)))
  return { lid, rim, bottom }
}

/** transforma a abóbora modelada no Blender numa lanterna esculpível */
export function createCarvedPumpkin(outer: THREE.Mesh, carver: Carver, glow: { value: number }) {
  const lidOpen = { value: 0 }
  const skin = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.48,
    alphaMap: carver.texture,
    alphaTest: 0.5,
  })
  skin.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = glow
    shader.uniforms.uLid = lidOpen
    shader.uniforms.uGuide = { value: carver.guideTexture }
    shader.uniforms.uWall = { value: (1 - WALL) * RADIUS * 0.9 }
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float uGlow;\nuniform float uWall;\nuniform sampler2D uGuide;\n${LID_GLSL}`,
      )
      .replace(
        '#include <alphamap_pars_fragment>',
        `#include <alphamap_pars_fragment>
        float maskG( vec2 uv ) { return textureLod( alphaMap, uv, 0.0 ).g * ( 1.0 - lidCut( uv ) ); }`,
      )
      .replace(
        '#include <alphamap_fragment>',
        `vec4 mk = texture2D( alphaMap, vAlphaMapUv );
        float carve = mk.g * ( 1.0 - lidCut( vAlphaMapUv ) );

        // parede do corte: dentro de um buraco, segue o raio da câmera pela espessura da casca;
        // se ele encontra casca intacta, aquele pixel mostra a parede de polpa naquela profundidade
        vec3 wp = - vViewPosition;
        vec3 wn = normalize( vNormal );
        vec3 dp1 = dFdx( wp );
        vec3 dp2 = dFdy( wp );
        vec2 duv1 = dFdx( vAlphaMapUv );
        vec2 duv2 = dFdy( vAlphaMapUv );
        duv1.x -= floor( duv1.x + 0.5 );
        duv2.x -= floor( duv2.x + 0.5 );
        vec3 dp2perp = cross( dp2, wn );
        vec3 dp1perp = cross( wn, dp1 );
        float det = dot( dp1, dp2perp );
        float wallHit = 0.0;
        float wallDepth = 0.0;
        if ( carve < 0.5 && abs( det ) > 1e-12 ) {
          vec3 gu = ( dp2perp * duv1.x + dp1perp * duv2.x ) / det;
          vec3 gv = ( dp2perp * duv1.y + dp1perp * duv2.y ) / det;
          vec3 ray = normalize( wp );
          float tmax = uWall / max( - dot( ray, wn ), 0.08 );
          vec3 slide = ( ray - wn * dot( ray, wn ) ) * tmax;
          vec2 reach = vec2( dot( gu, slide ), dot( gv, slide ) );
          float prev = 0.0;
          for ( int i = 1; i <= 24; i ++ ) {
            float f = float( i ) / 24.0;
            if ( maskG( vAlphaMapUv + reach * f ) >= 0.5 ) {
              float lo = prev;
              float hi = f;
              for ( int k = 0; k < 5; k ++ ) {
                float m = 0.5 * ( lo + hi );
                if ( maskG( vAlphaMapUv + reach * m ) >= 0.5 ) hi = m; else lo = m;
              }
              wallHit = 1.0;
              wallDepth = hi;
              break;
            }
            prev = f;
          }
        }
        diffuseColor.a *= max( carve, wallHit );

        float skinSide = 1.0 - wallHit;
        float rim = ( 1.0 - smoothstep( 0.5, 1.0, carve ) ) * skinSide;
        float ink = smoothstep( 0.5, 0.55, carve ) * ( 1.0 - smoothstep( 0.62, 0.72, carve ) ) * skinSide;
        // casca raspada: polpa fina que deixa a vela atravessar
        float shave = ( 1.0 - mk.r ) * skinSide * smoothstep( 0.85, 1.0, carve );
        float shaveLine = smoothstep( 0.2, 0.4, shave ) * ( 1.0 - smoothstep( 0.4, 0.6, shave ) );
        float guide = texture2D( uGuide, vAlphaMapUv ).r * skinSide;
        vec3 wallColor = mix( vec3( 1.0, 0.84, 0.55 ), vec3( 0.95, 0.55, 0.18 ), wallDepth );
        diffuseColor.rgb = mix( diffuseColor.rgb, ${FLESH_SKIN}, rim );
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 1.0, 0.82, 0.52 ), shave * 0.9 );
        diffuseColor.rgb *= 1.0 - shaveLine * 0.35;
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.01, 0.006, 0.002 ), ink );
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 1.0, 0.95, 0.8 ), guide );
        diffuseColor.rgb = mix( diffuseColor.rgb, wallColor * 0.65, wallHit );`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3( 1.0, 0.55, 0.15 ) * rim * ( 1.0 - ink ) * uGlow + vec3( 1.0, 0.85, 0.55 ) * guide * 0.6;
        totalEmissiveRadiance += vec3( 1.0, 0.62, 0.22 ) * shave * uGlow * 0.55;
        totalEmissiveRadiance += wallColor * wallHit * ( 0.3 + 0.7 * wallDepth ) * uGlow;`,
      )
  }

  // parede interna: frente = polpa (espessura do corte), verso = interior iluminado pela vela
  const flesh = new THREE.MeshStandardMaterial({
    color: '#ff9a2e',
    roughness: 0.9,
    side: THREE.DoubleSide,
    alphaMap: carver.texture,
    alphaTest: 0.5,
  })
  flesh.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = glow
    shader.uniforms.uLid = lidOpen
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uGlow;\n${LID_GLSL}`)
      .replace('#include <alphamap_fragment>', 'diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g * ( 1.0 - lidCut( vAlphaMapUv ) );')
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

  // sombra da vela: os furos e o topo sem tampa deixam a luz passar
  const distance = new THREE.MeshDistanceMaterial({ alphaMap: carver.texture, alphaTest: 0.5 })
  distance.onBeforeCompile = (shader) => {
    shader.uniforms.uLid = lidOpen
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${LID_GLSL}`)
      .replace('#include <alphamap_fragment>', 'diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g * ( 1.0 - lidCut( vAlphaMapUv ) );')
  }

  outer.material = skin
  outer.receiveShadow = false
  outer.customDistanceMaterial = distance
  const inner = new THREE.Mesh(outer.geometry, flesh)
  inner.scale.setScalar(WALL)
  inner.castShadow = true
  inner.customDistanceMaterial = distance

  const bottom = -(SQUASH - 0.2) * RADIUS * WALL
  const wax = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.13, 0.09, 24),
    new THREE.MeshStandardMaterial({ color: '#f3ead8', roughness: 0.6, emissive: '#ffb060', emissiveIntensity: 0.4 }),
  )
  wax.position.y = bottom + 0.045
  const flame = createFlame(7, 0.2, FX)
  flame.group.position.y = bottom + 0.09

  const light = new THREE.PointLight('#ff9b3d', 5, 0, 2)
  light.position.y = bottom + 0.3
  light.castShadow = true
  light.shadow.mapSize.set(1024, 1024)
  light.shadow.bias = -0.004
  light.shadow.normalBias = 0.02
  light.shadow.camera.near = 0.05
  light.shadow.camera.far = 9
  light.shadow.radius = 2.5

  // tampa: fica escondida (a casca inteira desenha o topo) até ser aberta
  const parts = lidGeometry(outer.geometry)
  const lid = new THREE.Group()
  const lidMeshes = [
    new THREE.Mesh(parts.lid, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.48 })),
    new THREE.Mesh(parts.lid, new THREE.MeshStandardMaterial({ color: '#e88a2c', roughness: 0.9, side: THREE.BackSide })),
    new THREE.Mesh(parts.rim, new THREE.MeshStandardMaterial({ color: '#ffd08a', roughness: 0.85, side: THREE.DoubleSide })),
  ]
  lidMeshes[1].scale.setScalar(WALL)
  for (const m of lidMeshes) {
    m.visible = false
    m.castShadow = true
  }
  lid.add(...lidMeshes)
  for (const name of ['PumpkinStem', 'PumpkinVine', 'PumpkinLeaf']) {
    const o = outer.getObjectByName(name)
    if (o) lid.add(o)
  }

  outer.add(inner, wax, flame.group, light, lid)

  // animação da tampa: sobe, faz um arco e pousa na mesa ao lado (e volta)
  const rest = new THREE.Vector3(1.75, -parts.bottom + 0.004, 0.95)
  const restQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.04, 0.9, -0.05))
  const scratch = new THREE.Vector3()
  let anim: { t: number; p0: THREE.Vector3; q0: THREE.Quaternion; p1: THREE.Vector3; q1: THREE.Quaternion; opening: boolean } | null =
    null
  let open = false

  return {
    outer,
    flame,
    light,
    baseLight: light.position.clone(),
    get lidOpen() {
      return open
    },
    toggleLid(scene: THREE.Scene) {
      if (anim) return
      const p0 = new THREE.Vector3()
      const q0 = new THREE.Quaternion()
      lid.matrixWorld.decompose(p0, q0, scratch)
      if (!open) {
        scene.attach(lid)
        lidOpen.value = 1
        for (const m of lidMeshes) m.visible = true
        anim = { t: 0, p0, q0, p1: rest.clone(), q1: restQ.clone(), opening: true }
      } else {
        outer.updateMatrixWorld()
        const p1 = new THREE.Vector3()
        const q1 = new THREE.Quaternion()
        outer.matrixWorld.decompose(p1, q1, scratch)
        anim = { t: 0, p0, q0, p1, q1, opening: false }
      }
      open = !open
    },
    update(dt: number) {
      if (!anim) return
      anim.t = Math.min(1, anim.t + dt / 1.4)
      const k = anim.t < 0.5 ? 4 * anim.t ** 3 : 1 - (-2 * anim.t + 2) ** 3 / 2
      lid.position.lerpVectors(anim.p0, anim.p1, k)
      lid.position.y += Math.sin(Math.PI * k) * 0.8
      lid.quaternion.slerpQuaternions(anim.q0, anim.q1, k)
      if (anim.t < 1) return
      if (!anim.opening) {
        outer.attach(lid)
        lid.position.set(0, 0, 0)
        lid.quaternion.identity()
        lid.scale.set(1, 1, 1)
        lidOpen.value = 0
        for (const m of lidMeshes) m.visible = false
      }
      anim = null
    },
  }
}
