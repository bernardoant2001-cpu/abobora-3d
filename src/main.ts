import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { Carver, createCarvedPumpkin, RADIUS, type Brush } from './pumpkin'
import { Painter, type Ink } from './paint'
import { createWorld, FX } from './world'
import { createInk } from './ink'
import { createSeeds } from './seeds'
import { createSurprises } from './surprises'
import { flicker } from './flame'
import { audio } from './audio'
import { STENCILS, thumbnail } from './stencils'
import { createGallery } from './gallery'
import { inject } from '@vercel/analytics'

// visitas (sem cookies), para ver de onde o pessoal chega
inject()
import { SHAPES, shapeIcon, type Shape } from './shapes'

const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!
const canvas = $<HTMLCanvasElement>('#scene')

const renderer = new THREE.WebGLRenderer({ canvas, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75))
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.45
renderer.shadowMap.enabled = true
renderer.shadowMap.autoUpdate = false

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120)
camera.layers.enable(FX)

// abertura: a abóbora do carregamento enche de tinta conforme o modelo baixa
const loaderEl = $('.loader')
const loadPct = $('#load-pct')
const startedAt = performance.now()
let realLoad = 0
let shownLoad = 0
const setLoad = (p: number) => {
  shownLoad = Math.max(shownLoad, Math.min(1, p))
  loaderEl.style.setProperty('--load', String(shownLoad))
  loadPct.textContent = `${Math.round(shownLoad * 100)}%`
}
// quando o servidor não informa o tamanho (gzip), sobe devagar sozinho até 90%
const creep = setInterval(() => setLoad(Math.max(realLoad, shownLoad + (0.9 - shownLoad) * 0.06)), 120)

const [gltf] = await Promise.all([
  new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync('/models/scene.glb', (e) => {
    if (e.total) realLoad = (e.loaded / e.total) * 0.92
  }),
  document.fonts.load('92px Creepster'),
  document.fonts.load('30px "Special Elite"'),
])

/**
 * O meshopt guarda a malha quantizada da abóbora num filho sem nome (com escala e deslocamento
 * para desfazer a quantização). Aqui ela volta para float e assume o lugar do nó 'Pumpkin',
 * para a escultura, a parede interna e a tampa trabalharem nas coordenadas reais.
 */
function adoptPumpkin(node: THREE.Object3D) {
  const skin = node.children.find((c) => (c as THREE.Mesh).isMesh && (c as THREE.Mesh).geometry.morphAttributes.position) as THREE.Mesh
  const src = skin.geometry
  const toFloat = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, scale = 1) => {
    const n = a.itemSize
    const out = new Float32Array(a.count * n)
    const get = [a.getX, a.getY, a.getZ, a.getW]
    for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) out[i * n + k] = get[k].call(a, i) * scale
    return new THREE.BufferAttribute(out, n)
  }
  const geo = new THREE.BufferGeometry()
  for (const name of ['position', 'normal', 'uv', 'color']) if (src.attributes[name]) geo.setAttribute(name, toFloat(src.attributes[name]))
  geo.setIndex(src.index)
  skin.updateMatrix()
  geo.applyMatrix4(skin.matrix)
  geo.morphAttributes.position = (src.morphAttributes.position ?? []).map((a) => toFloat(a, skin.scale.x))
  geo.morphTargetsRelative = src.morphTargetsRelative
  const mesh = new THREE.Mesh(geo, skin.material)
  mesh.name = 'Pumpkin'
  mesh.castShadow = true
  mesh.morphTargetDictionary = skin.morphTargetDictionary
  mesh.position.copy(node.position)
  mesh.quaternion.copy(node.quaternion)
  mesh.scale.copy(node.scale)
  for (const child of [...node.children]) if (child !== skin) mesh.add(child)
  node.parent!.add(mesh)
  node.removeFromParent()
  return mesh
}

const carver = new Carver()
carver.texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
const glow = { value: 1 }
const updateWorld = createWorld(scene, gltf.scene)
const painter = new Painter()
const nightGlow = { value: 0 }
const pumpkin = createCarvedPumpkin(adoptPumpkin(gltf.scene.getObjectByName('Pumpkin')!), carver, glow, painter.texture, nightGlow)
const surprises = createSurprises(scene)

let lastTick = 0
const colliderState = { center: new THREE.Vector3(), radius: RADIUS, height: RADIUS * 0.8 }
const seeds = createSeeds(scene, () => pumpkin.collider(colliderState), () => {
  const now = performance.now()
  if (now - lastTick > 45) {
    lastTick = now
    audio.tick()
  }
})

const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 })
const composer = new EffectComposer(renderer, target)
composer.addPass(new RenderPass(scene, camera))
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.22, 1.0)
composer.addPass(bloom)
composer.addPass(new OutputPass())
const ink = createInk(renderer, scene, camera)
composer.addPass(ink.pass)

let frameNo = 0
function render() {
  ink.renderNormals()
  // no modo leve as sombras só são refeitas quadro sim, quadro não
  renderer.shadowMap.needsUpdate = quality.level < 2 || frameNo++ % 2 === 0
  composer.render()
}

// ---------- modo leve: se o aparelho não aguenta, a qualidade baixa sozinha ----------

const quality = { level: 0, acc: 0, frames: 0, wait: 4 }
function adaptQuality(dt: number) {
  if (!document.body.classList.contains('ready') || recording || document.hidden) return
  quality.wait -= dt
  if (quality.wait > 0) return
  quality.acc += dt
  quality.frames++
  if (quality.acc < 2) return
  const fps = quality.frames / quality.acc
  quality.acc = quality.frames = 0
  // ponytail: só desce de nível; voltar a subir exigiria medir com folga para não ficar oscilando
  if (fps >= 42 || quality.level >= 3) return
  quality.level++
  quality.wait = 2
  if (quality.level >= 2) bloom.enabled = false
  const pr = [0, Math.min(devicePixelRatio, 1.25), 1, 0.8][quality.level]
  renderer.setPixelRatio(pr)
  composer.setPixelRatio(pr)
  resize()
}

const controls = new OrbitControls(camera, canvas)
controls.target.set(0, 0.95, 0)
controls.enableDamping = true
controls.enablePan = false
controls.enableRotate = false
controls.minDistance = 3.2

// ---------- escultura e giro ----------

const cursor = new THREE.Mesh(
  new THREE.RingGeometry(0.82, 1, 48),
  new THREE.MeshBasicMaterial({ color: '#f4e9ff', transparent: true, opacity: 0.8, depthTest: false, toneMapped: false }),
)
cursor.renderOrder = 10
cursor.visible = false
cursor.layers.set(FX)
scene.add(cursor)

type Tool = 'carve' | 'cut' | 'shape' | 'paint' | 'shave' | 'restore'
const CURSOR_COLOR: Record<Tool, string> = {
  carve: '#f4e9ff',
  cut: '#f4e9ff',
  shape: '#f4e9ff',
  paint: '#ffe08a',
  shave: '#ffd27a',
  restore: '#9dffb0',
}
let paintInk: Ink = 'ink'
// formas prontas: encosta no centro e arrasta; a distância é o tamanho e a direção aponta o topo da forma
let shape: Shape = SHAPES[0]
let shapeMode: 'carve' | 'shave' = 'carve'
let shaping: { id: number; center: THREE.Vector2; r: number; angle: number; moved: boolean } | null = null
const SHAPE_DEFAULT = 0.11
const raycaster = new THREE.Raycaster()
const ndc = new THREE.Vector2()
const normal = new THREE.Vector3()
const orbit = new THREE.Spherical()
const offset = new THREE.Vector3()
const active = new Set<number>()
let tool: Tool = 'carve'
let size = 0.08
let carving: number | null = null
let spinning: number | null = null
let spinVel = 0
let lastMove = 0
let pointer: PointerEvent | null = null
let lastBrush: { x: number; y: number } | null = null
let lastHit: { point: THREE.Vector3; normal: THREE.Vector3 } | null = null
const drag = { x: 0, y: 0, sx: 0, sy: 0 }

function pick(e: { clientX: number; clientY: number }) {
  const r = canvas.getBoundingClientRect()
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
  raycaster.setFromCamera(ndc, camera)
  const hit = raycaster.intersectObject(pumpkin.outer, false)[0]
  if (hit?.face) {
    normal.copy(hit.face.normal).transformDirection(pumpkin.outer.matrixWorld)
    lastHit = { point: hit.point.clone(), normal: normal.clone() }
  }
  return hit
}

function showCursor(hit: THREE.Intersection | undefined, e: PointerEvent) {
  cursor.visible = !!hit && spinning === null && (e.pointerType === 'mouse' || carving !== null)
  if (!hit?.face) return
  cursor.position.copy(hit.point).addScaledVector(normal, 0.01)
  cursor.lookAt(hit.point.clone().add(normal))
  cursor.scale.setScalar(tool === 'cut' || tool === 'shape' ? 0.025 : size)
}

function shapePts() {
  return shaping ? carver.shapePoints(shaping.center, shaping.r, shaping.angle, shape.pts) : null
}

function updateShape(hit: THREE.Intersection | undefined) {
  if (!shaping || !hit?.uv) return
  const [a, b] = carver.surfaceOffset(shaping.center, hit.uv)
  const r = Math.hypot(a, b)
  if (r > 0.035) shaping.moved = true
  if (shaping.moved) {
    shaping.r = Math.max(0.035, r)
    // topo da forma aponta para onde o dedo está; encaixa de 15 em 15° e "gruda" em pé
    const raw = Math.atan2(-a, b)
    shaping.angle = Math.abs(raw) < 0.22 ? 0 : Math.round(raw / (Math.PI / 12)) * (Math.PI / 12)
  }
  carver.previewShape(shapePts())
}

function finishShape(apply: boolean) {
  if (!shaping) return
  const pts = shapePts()
  shaping = null
  carver.previewShape(null)
  if (!apply || !pts) return
  carver.stampShape(pts, shapeMode)
  if (shapeMode === 'carve') {
    audio.slice()
    if (lastHit) seeds.spawn(lastHit.point, lastHit.normal, 10)
    scheduleLaugh()
  } else audio.pop()
  dismissHint()
}

/** pinta com a ferramenta atual; devolve quanto o cursor andou (para o som e as sementes) */
function brush(hit: THREE.Intersection | undefined, e: { clientX: number; clientY: number }) {
  if (!hit?.uv) {
    layer().lift()
    lastBrush = null
    return 0
  }
  if (tool === 'paint') painter.paint(hit.uv, size, paintInk)
  else carver.paint(hit.uv, size, tool as Brush)
  const moved = lastBrush ? Math.hypot(e.clientX - lastBrush.x, e.clientY - lastBrush.y) : 0
  lastBrush = { x: e.clientX, y: e.clientY }
  if (tool === 'carve' && lastHit && Math.random() < Math.min(0.95, 0.25 + moved / 25)) seeds.spawn(lastHit.point, lastHit.normal, 2)
  return moved
}

/** camada que o traço atual mexe: a pintura ou a escultura */
const layer = (): Carver | Painter => (tool === 'paint' ? painter : carver)

/** arrastar para cima/baixo inclina a câmera em volta da abóbora */
function tilt(d: number) {
  offset.copy(camera.position).sub(controls.target)
  orbit.setFromVector3(offset)
  orbit.phi = THREE.MathUtils.clamp(orbit.phi + d, 0.75, 1.45)
  camera.position.copy(controls.target).add(offset.setFromSpherical(orbit))
}

function stopGesture() {
  if (carving !== null) {
    layer().end()
    audio.stopScrape()
  }
  finishShape(false)
  carving = spinning = null
}

// som só pode começar depois de um gesto do usuário
addEventListener('pointerdown', () => audio.start(), { capture: true })
addEventListener('keydown', () => audio.start(), { capture: true })

canvas.addEventListener('pointerdown', (e) => {
  active.add(e.pointerId)
  if (active.size > 1) return stopGesture() // pinça: o OrbitControls cuida do zoom
  if (e.button !== 0 || recording) return
  canvas.setPointerCapture(e.pointerId)
  intro = 1
  // visitando a abóbora de alguém: só dá para girar, não esculpir
  const hit = tool === 'cut' || gallery.viewing ? undefined : pick(e)
  if (hit?.uv && tool === 'shape') {
    shaping = { id: e.pointerId, center: hit.uv.clone(), r: SHAPE_DEFAULT, angle: 0, moved: false }
    carver.previewShape(shapePts())
    showCursor(hit, e)
    dismissHint()
  } else if (hit) {
    carving = e.pointerId
    lastBrush = null
    layer().begin()
    brush(hit, e)
    showCursor(hit, e)
    dismissHint()
  } else {
    spinning = e.pointerId
    spinVel = 0
    drag.x = drag.sx = e.clientX
    drag.y = drag.sy = e.clientY
    cursor.visible = false
  }
})

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId === spinning) {
    spinVel = (e.clientX - drag.x) * 0.008
    pumpkin.outer.rotation.y += spinVel
    tilt(-(e.clientY - drag.y) * 0.004)
    drag.x = e.clientX
    drag.y = e.clientY
    lastMove = performance.now()
    return
  }
  if (carving === null || e.pointerId === carving) pointer = e
})

const release = (e: PointerEvent) => {
  active.delete(e.pointerId)
  if (shaping && e.pointerId === shaping.id) {
    if (pointer) updateShape(pick(pointer))
    pointer = null
    finishShape(e.type === 'pointerup')
    if (e.pointerType !== 'mouse') cursor.visible = false
    return
  }
  if (e.pointerId === carving) {
    if (pointer) brush(pick(pointer), pointer)
    pointer = null
    layer().end()
    carving = null
    audio.stopScrape()
    if (tool === 'carve') scheduleLaugh()
    if (e.pointerType !== 'mouse') cursor.visible = false
  }
  if (e.pointerId === spinning) {
    spinning = null
    if (performance.now() - lastMove > 80) spinVel = 0
    const tap = Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6
    if (tool === 'cut' && tap && e.type === 'pointerup') {
      spinVel = 0
      const hit = pick(e)
      if (hit?.uv) {
        if (carver.addPoint(hit.uv)) finishCut()
        updateCutbar()
      }
    }
  }
}
canvas.addEventListener('pointerup', release)
canvas.addEventListener('pointercancel', release)
canvas.addEventListener('pointerleave', () => {
  if (carving === null) cursor.visible = false
  carver.hover(null)
})
canvas.addEventListener('contextmenu', (e) => e.preventDefault())

/** recorte reto concluído: som de lâmina e o pedaço soltando sementes */
function finishCut() {
  audio.slice()
  if (lastHit) seeds.spawn(lastHit.point, lastHit.normal, 14)
  dismissHint()
  scheduleLaugh()
}

// ---------- a abóbora ri quando você termina um rosto ----------

let laughCheck = 0
let laughFrac = 0
let laughT = -1
function scheduleLaugh(delay = 2.2) {
  laughCheck = performance.now() / 1000 + delay
}

// ---------- interface ----------

const hint = $('#hint')
function dismissHint() {
  hint.classList.add('gone')
}

const cutbar = $('#cutbar')
const cutText = $('#cut-text')
const cutApply = $<HTMLButtonElement>('#cut-apply')
const cutCancel = $<HTMLButtonElement>('#cut-cancel')
const touch = matchMedia('(pointer: coarse)').matches
function updateCutbar() {
  cutbar.hidden = tool !== 'cut'
  hint.hidden = tool === 'cut'
  const n = carver.points
  cutApply.disabled = n < 3
  cutCancel.disabled = n === 0
  cutText.textContent =
    n === 0
      ? `${touch ? 'Toque' : 'Clique'} nos cantos para um corte reto`
      : n < 3
        ? 'Continue marcando os cantos'
        : `${touch ? 'Toque' : 'Clique'} no primeiro ponto ou em Cortar`
}
const applyCut = () => {
  if (carver.cutPolygon()) finishCut()
  updateCutbar()
}
cutApply.addEventListener('click', applyCut)
cutCancel.addEventListener('click', () => {
  carver.cancelPolygon()
  updateCutbar()
})

// paleta de formas e a chave recortar/raspar
const shapebar = $('#shapebar')
const shapeList = $('#shape-list')
const shapeText = $('#shape-text')
shapeText.textContent = `${touch ? 'Toque' : 'Clique'} no centro e arraste: a distância muda o tamanho e a direção gira a forma`
for (const s of SHAPES) {
  const b = document.createElement('button')
  b.innerHTML = shapeIcon(s)
  b.title = s.name
  b.setAttribute('aria-label', s.name)
  b.setAttribute('aria-pressed', String(s === shape))
  b.addEventListener('click', () => {
    shape = s
    shapeList.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)))
  })
  shapeList.append(b)
}
document.querySelectorAll<HTMLButtonElement>('[data-shape-mode]').forEach((b) =>
  b.addEventListener('click', () => {
    shapeMode = b.dataset.shapeMode as typeof shapeMode
    document.querySelectorAll('[data-shape-mode]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)))
  }),
)

const toolButtons = document.querySelectorAll<HTMLButtonElement>('[data-tool]')
function setTool(t: Tool) {
  if (t !== 'cut') carver.cancelPolygon()
  if (t !== 'shape') finishShape(false)
  tool = t
  toolButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === t)))
  ;(cursor.material as THREE.MeshBasicMaterial).color.set(CURSOR_COLOR[t])
  updateCutbar()
  shapebar.hidden = t !== 'shape'
  paintbar.hidden = t !== 'paint'
  if (t === 'shape' || t === 'paint') hint.hidden = true
}
toolButtons.forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool as Tool)))

const paintbar = $('#paintbar')
const inkButtons = document.querySelectorAll<HTMLButtonElement>('[data-ink]')
inkButtons.forEach((b) =>
  b.addEventListener('click', () => {
    paintInk = b.dataset.ink as Ink
    inkButtons.forEach((x) => x.setAttribute('aria-pressed', String(x === b)))
  }),
)

const sizeInput = $<HTMLInputElement>('#size')
const syncSize = () => {
  size = Number(sizeInput.value)
  sizeInput.style.setProperty('--fill', `${((size - 0.03) / (0.22 - 0.03)) * 100}%`)
}
sizeInput.addEventListener('input', syncSize)
syncSize()

const undo = () => {
  if (carver.points) carver.removePoint()
  else if (painter.lastStep > carver.lastStep) painter.undo()
  else carver.undo()
  updateCutbar()
}
$('#undo').addEventListener('click', undo)
$('#clear').addEventListener('click', () => {
  carver.clear()
  painter.clear()
  seeds.clear()
  laughFrac = 0
  updateCutbar()
})
addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    undo()
  } else if (tool === 'cut' && e.key === 'Enter') {
    applyCut()
  } else if (tool === 'cut' && e.key === 'Escape') {
    carver.cancelPolygon()
    updateCutbar()
  } else if (tool === 'cut' && e.key === 'Backspace' && carver.points) {
    e.preventDefault()
    undo()
  }
})

const lidButton = $<HTMLButtonElement>('#lid')
lidButton.addEventListener('click', () => {
  pumpkin.toggleLid(scene)
  lidButton.setAttribute('aria-pressed', String(pumpkin.lidOpen))
  lidButton.title = pumpkin.lidOpen ? 'Recolocar a tampa' : 'Tirar a tampa'
  audio.pop()
})

const facesButton = $<HTMLButtonElement>('#faces')
const panel = $('#stencils')
const togglePanel = (open = panel.hidden) => {
  panel.hidden = !open
  facesButton.setAttribute('aria-expanded', String(open))
}
for (const s of STENCILS) {
  const b = document.createElement('button')
  b.className = 'stencil'
  b.append(thumbnail(s), Object.assign(document.createElement('span'), { textContent: s.name }))
  b.addEventListener('click', () => {
    carver.stencil(s)
    togglePanel(false)
    dismissHint()
    updateCutbar()
    audio.slice()
    scheduleLaugh(1)
  })
  panel.append(b)
}
facesButton.addEventListener('click', () => togglePanel())
addEventListener('pointerdown', (e) => {
  if (!panel.hidden && !panel.contains(e.target as Node) && !facesButton.contains(e.target as Node)) togglePanel(false)
})

// ---------- fantasia: formato e acessório ----------

const SHAPE_ICONS: Record<string, string> = {
  Redonda: '<ellipse cx="12" cy="14" rx="9" ry="7.5"/><path d="M12 6.5V3.5M8.5 7.5c-1.4 4-1.4 9 0 13M15.5 7.5c1.4 4 1.4 9 0 13"/>',
  Alta: '<ellipse cx="12" cy="13" rx="6" ry="9.5"/><path d="M12 3.5V1.8M9.5 4.5c-1 5-1 12 0 17M14.5 4.5c1 5 1 12 0 17"/>',
  Achatada: '<ellipse cx="12" cy="15" rx="10.5" ry="5.5"/><path d="M12 9.5V6.5M7.5 10c-1.3 3-1.3 7 0 10M16.5 10c1.3 3 1.3 7 0 10"/>',
  Cabaca: '<path d="M12 4c-2.5 0-3.5 2.5-4 5.5C4.5 11 3.5 14 4 16.5 4.7 20 8 22 12 22s7.3-2 8-5.5c.5-2.5-.5-5.5-4-7C15.5 6.5 14.5 4 12 4z"/><path d="M12 4V1.8"/>',
}
const SHAPE_LABELS: Record<string, string> = { Cabaca: 'Pera' }
const ACCESSORIES: [string | null, string, string][] = [
  [null, 'Nenhum', '<circle cx="12" cy="12" r="8.5"/><path d="m6 18 12-12"/>'],
  ['AccWitch', 'Bruxa', '<path d="M2.5 18.5c3.5-1.8 15.5-1.8 19 0M7 17.6l4-11.5c.5-1.5-.5-3 1.5-4 .5 2.2 1.5 3 1.5 5l3 10.5"/><path d="M8.6 13.6c2.2.5 4.6.5 6.8 0"/>'],
  ['AccTopHat', 'Cartola', '<path d="M3 18.5c4-1.5 14-1.5 18 0M7 17.5V5.5h10v12"/><path d="M7 14h10"/>'],
  ['AccBow', 'Laço', '<path d="M12 12 4 7.5v9zM12 12l8-4.5v9z"/><circle cx="12" cy="12" r="1.8"/>'],
  ['AccHorns', 'Chifres', '<path d="M7 20c-3-3-3-9 1-14 0 4 1 7 3 9M17 20c3-3 3-9-1-14 0 4-1 7-3 9"/>'],
]

function chip(label: string, icon: string, onPick: () => void) {
  const b = document.createElement('button')
  b.className = 'chip'
  b.setAttribute('aria-pressed', 'false')
  b.innerHTML = `<svg viewBox="0 0 24 24">${icon}</svg><span></span>`
  b.querySelector('span')!.textContent = label
  b.addEventListener('click', () => {
    b.parentElement!.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c === b)))
    onPick()
  })
  return b
}
// formato e acessório atuais (a exposição guarda e restaura)
const look: { shape: string; accessory: string | null } = { shape: 'Redonda', accessory: null }
function applyLook(shape: string, accessory: string | null) {
  look.shape = shape
  look.accessory = accessory
  pumpkin.setShape(shape)
  pumpkin.setAccessory(accessory)
  shapesRow.querySelectorAll('.chip').forEach((c, i) => c.setAttribute('aria-pressed', String(pumpkin.shapes[i] === shape)))
  accsRow.querySelectorAll('.chip').forEach((c, i) => c.setAttribute('aria-pressed', String(ACCESSORIES[i][0] === accessory)))
}

const shapesRow = $('#shapes')
for (const name of pumpkin.shapes) {
  shapesRow.append(
    chip(SHAPE_LABELS[name] ?? name, SHAPE_ICONS[name] ?? SHAPE_ICONS.Redonda, () => {
      look.shape = name
      pumpkin.setShape(name)
      audio.pop()
    }),
  )
}
const accsRow = $('#accs')
for (const [name, label, icon] of ACCESSORIES) {
  accsRow.append(
    chip(label, icon, () => {
      look.accessory = name
      pumpkin.setAccessory(name)
      if (name) audio.pop()
    }),
  )
}
shapesRow.firstElementChild?.setAttribute('aria-pressed', 'true')
accsRow.firstElementChild?.setAttribute('aria-pressed', 'true')

const styleButton = $<HTMLButtonElement>('#style')
const costume = $('#costume')
const toggleCostume = (open = costume.hidden) => {
  costume.hidden = !open
  styleButton.setAttribute('aria-expanded', String(open))
  if (open) togglePanel(false)
}
styleButton.addEventListener('click', () => toggleCostume())
facesButton.addEventListener('click', () => toggleCostume(false))
addEventListener('pointerdown', (e) => {
  if (!costume.hidden && !costume.contains(e.target as Node) && !styleButton.contains(e.target as Node)) toggleCostume(false)
})

const lightsButton = $<HTMLButtonElement>('#lights')
lightsButton.addEventListener('click', () => {
  const off = lightsButton.getAttribute('aria-pressed') !== 'true'
  lightsButton.setAttribute('aria-pressed', String(off))
  document.body.classList.toggle('dark', off)
  audio.click()
  if (off) surprises.lightsOff(performance.now() / 1000)
})

const soundButton = $<HTMLButtonElement>('#sound')
const syncSound = () => {
  soundButton.setAttribute('aria-pressed', String(audio.muted))
  soundButton.title = audio.muted ? 'Ligar o som' : 'Desligar o som'
}
soundButton.addEventListener('click', () => {
  audio.setMuted(!audio.muted)
  syncSound()
})
syncSound()

$('#photo').addEventListener('click', () => {
  const wasVisible = cursor.visible
  cursor.visible = false
  render()
  const a = document.createElement('a')
  a.href = canvas.toDataURL('image/png')
  a.download = 'minha-abobora.png'
  a.click()
  cursor.visible = wasVisible
})

// ---------- exposição ----------

/** recorte 4:5 da tela enquadrando a abóbora (com chapéu) */
function pumpkinFrame(margin = 1.35) {
  const c = pumpkin.collider({ center: new THREE.Vector3(), radius: 0, height: 0 })
  const top = new THREE.Vector3(c.center.x, Math.max(pumpkin.top(), c.center.y + c.height), c.center.z).project(camera)
  const bottom = new THREE.Vector3(c.center.x, c.center.y - c.height, c.center.z).project(camera)
  const W = canvas.width
  const H = canvas.height
  const y0 = ((1 - top.y) / 2) * H
  const y1 = ((1 - bottom.y) / 2) * H
  const h = Math.min(H, (y1 - y0) * margin)
  const w = Math.min(W, h * 0.8)
  const cx = ((c.center.clone().project(camera).x + 1) / 2) * W
  const sx = THREE.MathUtils.clamp(cx - w / 2, 0, W - w)
  const sy = THREE.MathUtils.clamp((y0 + y1) / 2 - h / 2, 0, H - h)
  return { sx, sy, w, h }
}

/** miniatura 4:5 enquadrada na abóbora (com chapéu), em JPEG */
function captureThumb() {
  const wasVisible = cursor.visible
  cursor.visible = false
  render()
  cursor.visible = wasVisible
  const { sx, sy, w, h } = pumpkinFrame()
  const out = document.createElement('canvas')
  out.width = 480
  out.height = 600
  out.getContext('2d')!.drawImage(canvas, sx, sy, w, h, 0, 0, 480, 600)
  return out.toDataURL('image/jpeg', 0.82)
}

let mine: { mask: HTMLCanvasElement; paint: ReturnType<Painter['save']>; shape: string; accessory: string | null } | null = null
const gallery = createGallery({
  capture: captureThumb,
  exportMask: () => carver.exportMask(),
  exportPaint: () => painter.export(),
  current: () => ({ ...look }),
  hasCarving: () => carver.carvedFraction() > 0.002 || painter.hasPaint,
  view(entry, mask, paint) {
    if (!mine) mine = { mask: carver.saveState(), paint: painter.save(), shape: look.shape, accessory: look.accessory }
    if (tool === 'cut' || tool === 'shape' || tool === 'paint') setTool('carve')
    carver.restoreState(mask)
    painter.restore(paint ? { canvas: paint, used: true } : null)
    applyLook(entry.shape, entry.accessory)
    spinVel = 0
    pumpkin.outer.rotation.y = 0
    audio.pop()
  },
  back() {
    if (!mine) return
    carver.restoreState(mine.mask)
    painter.restore(mine.paint)
    applyLook(mine.shape, mine.accessory)
    mine = null
  },
})

// link próprio de uma obra da exposição: /a/<id>
const linked = location.pathname.match(/^\/a\/([a-f0-9]{20})\/?$/)
if (linked) gallery.openLink(linked[1])

// ---------- vídeo da abóbora girando ----------

let recording = false
let recState: { t: number; from: number; ctx: CanvasRenderingContext2D; crop: ReturnType<typeof pumpkinFrame> } | null = null
const REC_SECONDS = 4.5

async function recordSpin() {
  const types = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
  const mime = 'MediaRecorder' in window ? types.find((t) => MediaRecorder.isTypeSupported(t)) : undefined
  if (recording || !mime) {
    if (!mime) alert('Seu navegador não consegue gravar vídeo. Use o botão de foto!')
    return
  }
  const out = document.createElement('canvas')
  out.width = 720
  out.height = 900
  const ctx = out.getContext('2d')!
  const chunks: Blob[] = []
  const rec = new MediaRecorder(out.captureStream(30), { mimeType: mime, videoBitsPerSecond: 6_000_000 })
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  const done = new Promise<void>((r) => (rec.onstop = () => r()))
  recording = true
  document.body.classList.add('is-recording')
  $('#recording').hidden = false
  cursor.visible = false
  spinVel = 0
  recState = { t: 0, from: pumpkin.outer.rotation.y, ctx, crop: pumpkinFrame(2) }
  rec.start()
  await new Promise((r) => setTimeout(r, REC_SECONDS * 1000))
  rec.stop()
  await done
  recState = null
  recording = false
  document.body.classList.remove('is-recording')
  $('#recording').hidden = true

  const ext = mime.includes('mp4') ? 'mp4' : 'webm'
  const file = new File(chunks, `minha-abobora.${ext}`, { type: mime.split(';')[0] })
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Minha abóbora' })
      return
    } catch {
      /* cancelou: baixa o arquivo */
    }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(file)
  a.download = file.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}
$('#record').addEventListener('click', recordSpin)

/** chamado a cada quadro durante a gravação: gira a abóbora e copia o recorte para o vídeo */
function recordFrame(dt: number) {
  if (!recState) return
  recState.t = Math.min(REC_SECONDS, recState.t + dt)
  const k = recState.t / REC_SECONDS
  pumpkin.outer.rotation.y = recState.from + (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2) * Math.PI * 2
}

function recordCopy() {
  if (!recState) return
  const { ctx, crop } = recState
  ctx.drawImage(canvas, crop.sx, crop.sy, crop.w, crop.h, 0, 0, 720, 900)
  ctx.font = '26px "Special Elite", monospace'
  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(255, 243, 209, 0.9)'
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)'
  ctx.shadowBlur = 6
  ctx.fillText('abobora-3d.vercel.app', 360, 870)
  ctx.shadowBlur = 0
}

// ---------- loop ----------

const home = new THREE.Vector3()
const start = new THREE.Vector3()
let intro = 0
controls.addEventListener('start', () => (intro = 1))

function resize() {
  const w = innerWidth
  const h = innerHeight
  const aspect = w / h
  camera.aspect = aspect
  camera.fov = aspect < 1 ? 50 : 40
  camera.updateProjectionMatrix()
  renderer.setSize(w, h, false)
  composer.setSize(w, h)
  ink.setSize(w, h, renderer.getPixelRatio())
  const fit = Math.max(6.6, 1.55 / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect))
  controls.maxDistance = Math.min(9, fit * 1.35)
  home.set(0, aspect < 1 ? 0.3 : 0.22, 1).normalize().multiplyScalar(fit).add(controls.target)
  start.set(0, 0.55, 1).normalize().multiplyScalar(fit * 1.3).add(controls.target)
}
addEventListener('resize', resize)
resize()
camera.position.copy(start)

// chapéus altos: a câmera sobe e se afasta um pouco para tudo caber no quadro
let framed = 0
function frameTall(dt: number) {
  const want = THREE.MathUtils.clamp((pumpkin.top() - 2.35) / 1.2, 0, 1)
  const next = framed + (want - framed) * (1 - Math.exp(-dt * 3))
  const dy = (next - framed) * 0.7
  const zoom = (1 + next * 0.22) / (1 + framed * 0.22)
  framed = next
  offset.copy(camera.position).sub(controls.target).multiplyScalar(zoom)
  controls.target.y += dy
  camera.position.copy(controls.target).add(offset)
  home.y += dy
  start.y += dy
}

const warm = new THREE.Color('#ff8a2a')
const hot = new THREE.Color('#ffb860')
let mood = 0
let lean = 0
let last = 0
renderer.setAnimationLoop((ms) => {
  const t = ms / 1000
  const dt = Math.min(0.05, t - last)
  last = t

  if (intro < 1) {
    intro = Math.min(1, intro + dt / 2.6)
    camera.position.lerpVectors(start, home, 1 - Math.pow(1 - intro, 3))
  }
  controls.update()

  if (spinning === null && spinVel !== 0) {
    pumpkin.outer.rotation.y += spinVel * dt * 60
    spinVel *= Math.exp(-dt * 4)
    if (Math.abs(spinVel) < 1e-4) spinVel = 0
  }

  if (pointer) {
    const hit = pick(pointer)
    if (carving !== null) {
      const moved = brush(hit, pointer)
      if (moved > 0.5 && tool !== 'restore') audio.scrape(moved / 40, tool === 'shave')
      else audio.stopScrape()
    } else if (shaping) updateShape(hit)
    else if (tool === 'cut' && pointer.pointerType === 'mouse') carver.hover(hit?.uv ?? null)
    showCursor(hit, pointer)
    pointer = null
  } else if (carving !== null) audio.stopScrape()
  if (carver.dirty) {
    carver.texture.needsUpdate = true
    carver.dirty = false
  }
  if (carver.guideDirty) {
    carver.guideTexture.needsUpdate = true
    carver.guideDirty = false
  }
  painter.update(dt)
  if (painter.dirty) {
    painter.texture.needsUpdate = true
    painter.dirty = false
  }

  // risada: confere se o rosto mudou bastante desde a última vez
  if (laughCheck && t > laughCheck && carving === null) {
    laughCheck = 0
    const f = carver.carvedFraction()
    if (f > 0.012 && f - laughFrac > 0.006) {
      laughFrac = f
      laughT = 0
      audio.laugh()
    } else if (f < laughFrac) laughFrac = f
  }
  let boost = 1
  if (laughT >= 0) {
    laughT += dt
    const k = Math.max(0, 1 - laughT / 1.5)
    const s = Math.sin(laughT * 22) * 0.05 * k
    pumpkin.outer.scale.set(1 - s * 0.5, 1 + s, 1 - s * 0.5)
    pumpkin.outer.rotation.z = Math.sin(laughT * 14) * 0.04 * k
    boost = 1 + 0.35 * k
    if (laughT > 1.5) {
      laughT = -1
      pumpkin.outer.scale.set(1, 1, 1)
      pumpkin.outer.rotation.z = 0
    }
  }

  const dark = document.body.classList.contains('dark') ? 1 : 0
  mood += (dark - mood) * (1 - Math.exp(-dt * 3))

  // vela da abóbora: tremula, muda de tom e balança um pouco, fazendo o rosto projetado dançar
  const f = flicker(t, 1)
  pumpkin.light.intensity = (3.4 + 3.6 * mood) * f * boost
  pumpkin.light.color.copy(warm).lerp(hot, (f - 0.72) / 0.28)
  pumpkin.light.position.set(
    pumpkin.baseLight.x + (flicker(t * 1.4, 2) - 0.86) * 0.07,
    pumpkin.baseLight.y + (flicker(t * 1.1, 3) - 0.86) * 0.04,
    pumpkin.baseLight.z + (flicker(t * 1.3, 4) - 0.86) * 0.07,
  )
  glow.value = Math.min(0.95, (0.6 + 0.3 * mood) * f * boost)
  lean += (THREE.MathUtils.clamp(-spinVel * 5, -0.3, 0.3) - lean) * (1 - Math.exp(-dt * 6))
  pumpkin.flame.update(t, f * 1.1, lean)
  bloom.strength = THREE.MathUtils.lerp(0.6, 0.8, mood)

  pumpkin.update(dt)
  frameTall(dt)
  seeds.update(dt)
  surprises.update(t, dt)
  updateWorld(t, mood, dt, pumpkin.top())
  ink.update(t, mood)
  nightGlow.value = mood
  recordFrame(dt)
  render()
  recordCopy()
  adaptQuality(dt)
})

// tinta cheia → o rosto acende → íris abre a cena (com um tempo mínimo para a abertura ser vista)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
clearInterval(creep)
setLoad(1)
await sleep(Math.max(500, 1500 - (performance.now() - startedAt)))
loaderEl.classList.add('lit')
$('#load-msg').textContent = 'A vela acendeu!'
loadPct.textContent = ''
await sleep(800)
document.body.classList.add('ready')
loaderEl.setAttribute('aria-hidden', 'true')
