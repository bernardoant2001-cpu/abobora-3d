import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { Carver, createCarvedPumpkin } from './pumpkin'
import { createWorld, FX } from './world'
import { createInk } from './ink'
import { STENCILS, thumbnail } from './stencils'

const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!
const canvas = $<HTMLCanvasElement>('#scene')

const renderer = new THREE.WebGLRenderer({ canvas, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75))
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.2
renderer.shadowMap.enabled = true
renderer.shadowMap.autoUpdate = false

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120)
camera.layers.enable(FX)

const draco = new DRACOLoader().setDecoderPath('/draco/')
const [gltf] = await Promise.all([
  new GLTFLoader().setDRACOLoader(draco).loadAsync('/models/scene.glb'),
  document.fonts.load('92px Creepster'),
  document.fonts.load('30px "Special Elite"'),
])
draco.dispose()

const carver = new Carver()
carver.texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
const glow = { value: 1 }
const updateWorld = createWorld(scene, gltf.scene)
const pumpkin = createCarvedPumpkin(gltf.scene.getObjectByName('Pumpkin') as THREE.Mesh, carver, glow)

const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 })
const composer = new EffectComposer(renderer, target)
composer.addPass(new RenderPass(scene, camera))
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.55, 0.85)
composer.addPass(bloom)
composer.addPass(new OutputPass())
const ink = createInk(renderer, scene, camera)
composer.addPass(ink.pass)

function render() {
  ink.renderNormals()
  renderer.shadowMap.needsUpdate = true
  composer.render()
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

type Tool = 'carve' | 'cut' | 'restore'
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
const drag = { x: 0, y: 0, sx: 0, sy: 0 }

function pick(e: { clientX: number; clientY: number }) {
  const r = canvas.getBoundingClientRect()
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
  raycaster.setFromCamera(ndc, camera)
  return raycaster.intersectObject(pumpkin.outer, false)[0]
}

function showCursor(hit: THREE.Intersection | undefined, e: PointerEvent) {
  cursor.visible = !!hit && spinning === null && (e.pointerType === 'mouse' || carving !== null)
  if (!hit?.face) return
  normal.copy(hit.face.normal).transformDirection(pumpkin.outer.matrixWorld)
  cursor.position.copy(hit.point).addScaledVector(normal, 0.01)
  cursor.lookAt(hit.point.clone().add(normal))
  cursor.scale.setScalar(tool === 'cut' ? 0.025 : size)
}

function brush(hit: THREE.Intersection | undefined) {
  if (hit?.uv) carver.paint(hit.uv, size, tool === 'carve')
  else carver.lift()
}

/** arrastar para cima/baixo inclina a câmera em volta da abóbora */
function tilt(d: number) {
  offset.copy(camera.position).sub(controls.target)
  orbit.setFromVector3(offset)
  orbit.phi = THREE.MathUtils.clamp(orbit.phi + d, 0.75, 1.45)
  camera.position.copy(controls.target).add(offset.setFromSpherical(orbit))
}

function stopGesture() {
  if (carving !== null) carver.end()
  carving = spinning = null
}

canvas.addEventListener('pointerdown', (e) => {
  active.add(e.pointerId)
  if (active.size > 1) return stopGesture() // pinça: o OrbitControls cuida do zoom
  if (e.button !== 0) return
  canvas.setPointerCapture(e.pointerId)
  intro = 1
  const hit = tool === 'cut' ? undefined : pick(e)
  if (hit) {
    carving = e.pointerId
    carver.begin()
    brush(hit)
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
  if (e.pointerId === carving) {
    if (pointer) brush(pick(pointer))
    pointer = null
    carver.end()
    carving = null
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
        if (carver.addPoint(hit.uv)) dismissHint()
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
cutApply.addEventListener('click', () => {
  if (carver.cutPolygon()) dismissHint()
  updateCutbar()
})
cutCancel.addEventListener('click', () => {
  carver.cancelPolygon()
  updateCutbar()
})

const toolButtons = document.querySelectorAll<HTMLButtonElement>('[data-tool]')
function setTool(t: Tool) {
  if (t !== 'cut') carver.cancelPolygon()
  tool = t
  toolButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === t)))
  ;(cursor.material as THREE.MeshBasicMaterial).color.set(t === 'restore' ? '#9dffb0' : '#f4e9ff')
  updateCutbar()
}
toolButtons.forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool as Tool)))

const sizeInput = $<HTMLInputElement>('#size')
const syncSize = () => {
  size = Number(sizeInput.value)
  sizeInput.style.setProperty('--fill', `${((size - 0.03) / (0.22 - 0.03)) * 100}%`)
}
sizeInput.addEventListener('input', syncSize)
syncSize()

const undo = () => {
  if (carver.points) carver.removePoint()
  else carver.undo()
  updateCutbar()
}
$('#undo').addEventListener('click', undo)
$('#clear').addEventListener('click', () => {
  carver.clear()
  updateCutbar()
})
addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    undo()
  } else if (tool === 'cut' && e.key === 'Enter') {
    carver.cutPolygon()
    updateCutbar()
  } else if (tool === 'cut' && e.key === 'Escape') {
    carver.cancelPolygon()
    updateCutbar()
  } else if (tool === 'cut' && e.key === 'Backspace' && carver.points) {
    e.preventDefault()
    undo()
  }
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
  })
  panel.append(b)
}
facesButton.addEventListener('click', () => togglePanel())
addEventListener('pointerdown', (e) => {
  if (!panel.hidden && !panel.contains(e.target as Node) && !facesButton.contains(e.target as Node)) togglePanel(false)
})

const lightsButton = $<HTMLButtonElement>('#lights')
lightsButton.addEventListener('click', () => {
  const off = lightsButton.getAttribute('aria-pressed') !== 'true'
  lightsButton.setAttribute('aria-pressed', String(off))
  document.body.classList.toggle('dark', off)
})

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

let mood = 0
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
    if (carving !== null) brush(hit)
    else if (tool === 'cut' && pointer.pointerType === 'mouse') carver.hover(hit?.uv ?? null)
    showCursor(hit, pointer)
    pointer = null
  }
  if (carver.dirty) {
    carver.texture.needsUpdate = true
    carver.dirty = false
  }
  if (carver.guideDirty) {
    carver.guideTexture.needsUpdate = true
    carver.guideDirty = false
  }

  const dark = document.body.classList.contains('dark') ? 1 : 0
  mood += (dark - mood) * (1 - Math.exp(-dt * 3))
  const flicker = 0.84 + 0.08 * Math.sin(t * 13.1) + 0.05 * Math.sin(t * 23.7 + 1.3) + 0.03 * Math.sin(t * 7.3)
  pumpkin.light.intensity = (3 + 4 * mood) * flicker
  glow.value = (0.6 + 0.6 * mood) * flicker
  pumpkin.flame.scale.y = 0.085 * (0.8 + 0.25 * flicker)
  bloom.strength = THREE.MathUtils.lerp(0.5, 0.7, mood)

  updateWorld(t, mood)
  ink.update(t, mood)
  render()
})

document.body.classList.add('ready')
