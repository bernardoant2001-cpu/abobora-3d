import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { Carver, createCarvedPumpkin, pumpkinGeometry } from './pumpkin'
import { createWorld } from './world'
import { STENCILS, thumbnail } from './stencils'

const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!
const canvas = $<HTMLCanvasElement>('#scene')

const renderer = new THREE.WebGLRenderer({ canvas, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.shadowMap.enabled = true

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200)

const geo = pumpkinGeometry()
const carver = new Carver()
carver.texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
const glow = { value: 1 }
const pumpkin = createCarvedPumpkin(geo, carver.texture, glow)
scene.add(pumpkin.group)
const updateWorld = createWorld(scene, geo)

const hemi = new THREE.HemisphereLight('#7d6bc4', '#2b170c', 0.9)
const moonLight = new THREE.DirectionalLight('#a8b8ff', 1.6)
moonLight.position.set(6, 7, -6)
moonLight.castShadow = true
moonLight.shadow.mapSize.set(2048, 2048)
moonLight.shadow.camera.left = moonLight.shadow.camera.bottom = -5
moonLight.shadow.camera.right = moonLight.shadow.camera.top = 5
moonLight.shadow.bias = -0.0005
moonLight.shadow.normalBias = 0.02
const fill = new THREE.DirectionalLight('#ffcf9e', 0.6)
fill.position.set(4, 5, 6)
scene.add(hemi, moonLight, fill)

const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 })
const composer = new EffectComposer(renderer, target)
composer.addPass(new RenderPass(scene, camera))
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.55, 0.85)
composer.addPass(bloom)
composer.addPass(new OutputPass())

// ---------- escultura ----------

const cursor = new THREE.Mesh(
  new THREE.RingGeometry(0.82, 1, 48),
  new THREE.MeshBasicMaterial({ color: '#f4e9ff', transparent: true, opacity: 0.8, depthTest: false, toneMapped: false }),
)
cursor.renderOrder = 10
cursor.visible = false
scene.add(cursor)

const raycaster = new THREE.Raycaster()
const ndc = new THREE.Vector2()
const normal = new THREE.Vector3()
let tool: 'carve' | 'restore' = 'carve'
let size = 0.08
let carving: number | null = null
let pointer: PointerEvent | null = null

function pick(e: PointerEvent) {
  const r = canvas.getBoundingClientRect()
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
  raycaster.setFromCamera(ndc, camera)
  return raycaster.intersectObject(pumpkin.outer, false)[0]
}

function showCursor(hit: THREE.Intersection | undefined, e: PointerEvent) {
  cursor.visible = !!hit && (e.pointerType === 'mouse' || carving !== null)
  if (!hit?.face) return
  normal.copy(hit.face.normal).transformDirection(pumpkin.outer.matrixWorld)
  cursor.position.copy(hit.point).addScaledVector(normal, 0.01)
  cursor.lookAt(hit.point.clone().add(normal))
  cursor.scale.setScalar(size)
}

function brush(hit: THREE.Intersection | undefined) {
  if (hit?.uv) carver.paint(hit.uv, size, tool === 'carve')
  else carver.lift()
}

// registrado antes do OrbitControls para decidir primeiro: abóbora = esculpir, fora = girar
canvas.addEventListener('pointerdown', (e) => {
  if (carving !== null || e.button !== 0) return
  const hit = pick(e)
  if (!hit) return
  carving = e.pointerId
  controls.enabled = false
  canvas.setPointerCapture(e.pointerId)
  carver.begin()
  brush(hit)
  showCursor(hit, e)
  dismissHint()
})
canvas.addEventListener('pointermove', (e) => {
  if (carving === null || e.pointerId === carving) pointer = e
})
const release = (e: PointerEvent) => {
  if (e.pointerId !== carving) return
  if (pointer) brush(pick(pointer))
  pointer = null
  carver.end()
  carving = null
  controls.enabled = true
  if (e.pointerType !== 'mouse') cursor.visible = false
}
canvas.addEventListener('pointerup', release)
canvas.addEventListener('pointercancel', release)
canvas.addEventListener('pointerleave', () => carving === null && (cursor.visible = false))
canvas.addEventListener('contextmenu', (e) => e.preventDefault())

const controls = new OrbitControls(camera, canvas)
controls.target.set(0, 0.95, 0)
controls.enableDamping = true
controls.enablePan = false
controls.minDistance = 3.2
controls.minPolarAngle = 0.35
controls.maxPolarAngle = 1.45
controls.rotateSpeed = 0.7

// ---------- interface ----------

const hint = $('#hint')
function dismissHint() {
  hint.classList.add('gone')
}

const toolButtons = document.querySelectorAll<HTMLButtonElement>('[data-tool]')
function setTool(t: typeof tool) {
  tool = t
  toolButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === t)))
  ;(cursor.material as THREE.MeshBasicMaterial).color.set(t === 'carve' ? '#f4e9ff' : '#9dffb0')
}
toolButtons.forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool as typeof tool)))

const sizeInput = $<HTMLInputElement>('#size')
const syncSize = () => {
  size = Number(sizeInput.value)
  sizeInput.style.setProperty('--fill', `${((size - 0.03) / (0.22 - 0.03)) * 100}%`)
}
sizeInput.addEventListener('input', syncSize)
syncSize()

$('#undo').addEventListener('click', () => carver.undo())
$('#clear').addEventListener('click', () => carver.clear())
addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    carver.undo()
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
  })
  panel.append(b)
}
facesButton.addEventListener('click', () => togglePanel())
addEventListener('pointerdown', (e) => {
  if (!panel.hidden && !panel.contains(e.target as Node) && !facesButton.contains(e.target as Node)) togglePanel(false)
})

let mood = 0
const lightsButton = $<HTMLButtonElement>('#lights')
lightsButton.addEventListener('click', () => {
  const off = lightsButton.getAttribute('aria-pressed') !== 'true'
  lightsButton.setAttribute('aria-pressed', String(off))
  document.body.classList.toggle('dark', off)
})

$('#photo').addEventListener('click', () => {
  const wasVisible = cursor.visible
  cursor.visible = false
  composer.render()
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
  const fit = Math.max(6.6, 1.55 / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect))
  controls.maxDistance = fit * 1.6
  home.set(0, aspect < 1 ? 0.3 : 0.22, 1).normalize().multiplyScalar(fit).add(controls.target)
  start.set(-0.35, 0.5, 1).normalize().multiplyScalar(fit * 1.7).add(controls.target)
}
addEventListener('resize', resize)
resize()
camera.position.copy(start)

let last = 0
renderer.setAnimationLoop((ms) => {
  const t = ms / 1000
  const dt = Math.min(0.05, t - last)
  last = t

  if (intro < 1) {
    intro = Math.min(1, intro + dt / 2.6)
    const k = 1 - Math.pow(1 - intro, 3)
    camera.position.lerpVectors(start, home, k)
  }
  controls.update()

  if (pointer) {
    const hit = pick(pointer)
    if (carving !== null) brush(hit)
    showCursor(hit, pointer)
    pointer = null
  }
  if (carver.dirty) {
    carver.texture.needsUpdate = true
    carver.dirty = false
  }

  const dark = document.body.classList.contains('dark') ? 1 : 0
  mood += (dark - mood) * (1 - Math.exp(-dt * 3))
  const flicker = 0.84 + 0.08 * Math.sin(t * 13.1) + 0.05 * Math.sin(t * 23.7 + 1.3) + 0.03 * Math.sin(t * 7.3)
  hemi.intensity = THREE.MathUtils.lerp(0.9, 0.1, mood)
  moonLight.intensity = THREE.MathUtils.lerp(1.6, 0.35, mood)
  fill.intensity = THREE.MathUtils.lerp(0.6, 0, mood)
  pumpkin.light.intensity = (3 + 4 * mood) * flicker
  glow.value = (0.6 + 0.6 * mood) * flicker
  pumpkin.flame.scale.y = 0.085 * (0.8 + 0.25 * flicker)
  bloom.strength = THREE.MathUtils.lerp(0.5, 0.7, mood)

  updateWorld(t)
  composer.render()
})
