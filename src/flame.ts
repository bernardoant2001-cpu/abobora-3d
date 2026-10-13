import * as THREE from 'three'

/** ruído suave 1D para tremulação orgânica (cada fonte com sua semente) */
export function flicker(t: number, seed: number) {
  const hash = (n: number) => {
    const s = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453
    return s - Math.floor(s)
  }
  const noise = (x: number) => {
    const i = Math.floor(x)
    const f = x - i
    const k = f * f * (3 - 2 * f)
    return hash(i) * (1 - k) + hash(i + 1) * k
  }
  return 0.72 + 0.2 * noise(t * 5.5) + 0.08 * noise(t * 17)
}

const geometry = new THREE.PlaneGeometry(1, 1, 1, 10).translate(0, 0.5, 0)

const vertexShader = /* glsl */ `
uniform float uTime;
uniform float uSeed;
uniform float uLean;
varying vec2 vUv;
void main() {
  vUv = uv;
  float h = uv.y;
  float sway = ( sin( uTime * 6.3 + uSeed * 13.0 ) * 0.6 + sin( uTime * 10.7 + uSeed * 7.0 ) * 0.4 ) * 0.07 * h * h + uLean * h * h;
  vec4 mv = modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
  vec2 size = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
  mv.xy += vec2( position.x + sway, position.y ) * size;
  gl_Position = projectionMatrix * mv;
}
`

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uSeed;
uniform float uPower;
varying vec2 vUv;
void main() {
  float y = vUv.y;
  float w = 0.4 * pow( sin( 3.14159 * clamp( y * 0.82 + 0.1, 0.0, 1.0 ) ), 0.85 ) * ( 1.0 - y * 0.3 );
  float d = abs( vUv.x - 0.5 ) / max( w, 1e-3 );
  float body = smoothstep( 1.0, 0.5, d ) * smoothstep( 1.0, 0.7, y );
  float core = smoothstep( 0.6, 0.0, d ) * smoothstep( 0.62, 0.12, y ) * smoothstep( 0.0, 0.1, y );
  float base = smoothstep( 0.2, 0.0, y ) * smoothstep( 1.0, 0.3, d );
  float pulse = 0.85 + 0.15 * sin( uTime * 21.0 + uSeed * 5.0 );
  vec3 col = mix( vec3( 1.0, 0.32, 0.04 ), vec3( 1.0, 0.72, 0.28 ), smoothstep( 0.95, 0.3, d ) ) * body;
  col += vec3( 1.0, 0.96, 0.82 ) * core * 1.6;
  col += vec3( 0.25, 0.4, 1.0 ) * base * 0.35;
  gl_FragColor = vec4( col * uPower * pulse * 2.4, 1.0 );
}
`

let haloTexture: THREE.CanvasTexture | null = null
function halo() {
  if (haloTexture) return haloTexture
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grd.addColorStop(0, 'rgba(255,200,120,0.55)')
  grd.addColorStop(0.35, 'rgba(255,150,60,0.18)')
  grd.addColorStop(1, 'rgba(255,120,40,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 128, 128)
  haloTexture = new THREE.CanvasTexture(c)
  return haloTexture
}

/** chama em billboard (sempre de frente para a câmera) com halo; base no ponto de origem */
export function createFlame(seed: number, height: number, layer: number) {
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uSeed: { value: seed }, uPower: { value: 1 }, uLean: { value: 0 } },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const flame = new THREE.Mesh(geometry, material)
  flame.scale.set(height * 0.5, height, 1)
  flame.frustumCulled = false
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: halo(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
  )
  glow.scale.setScalar(height * 5)
  glow.position.y = height * 0.4
  const group = new THREE.Group()
  group.add(flame, glow)
  group.traverse((o) => o.layers.set(layer))
  return {
    group,
    update(t: number, power: number, lean = 0) {
      material.uniforms.uTime.value = t
      material.uniforms.uPower.value = power
      material.uniforms.uLean.value = lean
      glow.material.opacity = Math.min(1, power)
    },
  }
}
