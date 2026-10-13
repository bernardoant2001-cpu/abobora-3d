import * as THREE from 'three'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { FX } from './world'

/** rampa sépia: do preto-tinta ao creme */
function rampTexture() {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 1
  const g = c.getContext('2d')!
  const grd = g.createLinearGradient(0, 0, 256, 0)
  const stops: [number, string][] = [
    [0, '#0b0603'],
    [0.16, '#2a180a'],
    [0.38, '#6b4318'],
    [0.6, '#b47a2c'],
    [0.78, '#e2b45a'],
    [0.9, '#f6dc98'],
    [1, '#fff6dc'],
  ]
  for (const [o, col] of stops) grd.addColorStop(o, col)
  g.fillStyle = grd
  g.fillRect(0, 0, 256, 1)
  const t = new THREE.CanvasTexture(c)
  t.generateMipmaps = false
  t.minFilter = THREE.LinearFilter
  return t
}

const fragmentShader = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tNormal;
uniform sampler2D tDepth;
uniform sampler2D tRamp;
uniform vec2 resolution;
uniform float px;
uniform float near;
uniform float far;
uniform float time;
uniform float keep;
uniform float dark;
varying vec2 vUv;

float hash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float noise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( hash( i ), hash( i + vec2( 1, 0 ) ), f.x ), mix( hash( i + vec2( 0, 1 ) ), hash( i + vec2( 1, 1 ) ), f.x ), f.y );
}
// 1 / profundidade linear: é afim na tela para superfícies planas, então o laplaciano só acusa quinas
float invDepth( vec2 uv ) {
  float z = texture2D( tDepth, uv ).x * 2.0 - 1.0;
  return ( far + near - z * ( far - near ) ) / ( 2.0 * near * far );
}

void main() {
  float frame = floor( time * 8.0 );
  vec2 cell = vUv * resolution / ( px * 30.0 );
  vec2 wob = vec2( noise( cell + frame * 1.7 ), noise( cell + 17.0 - frame * 1.3 ) ) - 0.5;
  vec2 uv = vUv + wob * px * 2.0 / resolution;
  vec2 o = px / resolution;

  float c0 = invDepth( uv );
  float lap = abs( invDepth( uv - vec2( o.x, 0.0 ) ) + invDepth( uv + vec2( o.x, 0.0 ) ) - 2.0 * c0 )
            + abs( invDepth( uv - vec2( 0.0, o.y ) ) + invDepth( uv + vec2( 0.0, o.y ) ) - 2.0 * c0 );
  float nd = length( texture2D( tNormal, uv - vec2( o.x, 0.0 ) ).rgb - texture2D( tNormal, uv + vec2( o.x, 0.0 ) ).rgb )
           + length( texture2D( tNormal, uv - vec2( 0.0, o.y ) ).rgb - texture2D( tNormal, uv + vec2( 0.0, o.y ) ).rgb );
  float edge = max( smoothstep( 0.015, 0.05, lap / c0 ), smoothstep( 0.22, 0.5, nd ) );

  // tudo vira sépia; só o que é bem saturado (abóbora, chamas) guarda um pouco da cor
  vec3 src = texture2D( tDiffuse, vUv ).rgb;
  float lum = dot( src, vec3( 0.299, 0.587, 0.114 ) );
  float sat = max( src.r, max( src.g, src.b ) ) - min( src.r, min( src.g, src.b ) );
  vec3 col = mix( texture2D( tRamp, vec2( clamp( lum, 0.0, 1.0 ), 0.5 ) ).rgb, src, keep + smoothstep( 0.25, 0.6, sat ) * 0.3 );

  // hachura de nanquim nas sombras
  float hatch = smoothstep( 0.72, 0.9, fract( ( gl_FragCoord.x + gl_FragCoord.y ) / ( 7.0 * px ) + noise( gl_FragCoord.xy / ( 60.0 * px ) ) * 0.6 ) );
  col *= 1.0 - hatch * 0.35 * ( 1.0 - smoothstep( 0.05, 0.25, lum ) );

  // vinheta e grão de filme antigo
  vec2 q = ( vUv - 0.5 ) * vec2( 1.1, 1.0 );
  col *= mix( 0.42 - dark * 0.15, 1.0, smoothstep( 0.85, 0.25, length( q ) ) );
  col += ( hash( gl_FragCoord.xy + frame ) - 0.5 ) * 0.06;

  col = mix( col, vec3( 0.05, 0.03, 0.012 ), edge * 0.92 );
  gl_FragColor = vec4( col, 1.0 );
}
`

export function createInk(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
  const normals = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType })
  normals.depthTexture = new THREE.DepthTexture(1, 1)
  const normalMat = new THREE.MeshNormalMaterial()
  const material = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      tNormal: { value: normals.texture },
      tDepth: { value: normals.depthTexture },
      tRamp: { value: rampTexture() },
      resolution: { value: new THREE.Vector2(1, 1) },
      px: { value: 1 },
      near: { value: camera.near },
      far: { value: camera.far },
      time: { value: 0 },
      keep: { value: 0.16 },
      dark: { value: 0 },
    },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
    fragmentShader,
  })
  const pass = new ShaderPass(material)
  const clear = new THREE.Color()

  return {
    pass,
    setSize(w: number, h: number, pr: number) {
      normals.setSize(Math.round(w * pr), Math.round(h * pr))
      material.uniforms.resolution.value.set(w * pr, h * pr)
      material.uniforms.px.value = pr
    },
    update(t: number, dark: number) {
      material.uniforms.time.value = t
      material.uniforms.dark.value = dark
    },
    /** passada de normais + profundidade usada para achar os contornos */
    renderNormals() {
      const bg = scene.background
      const alpha = renderer.getClearAlpha()
      renderer.getClearColor(clear)
      scene.background = null
      scene.overrideMaterial = normalMat
      camera.layers.disable(FX)
      renderer.setRenderTarget(normals)
      renderer.setClearColor(0x8080ff, 1)
      renderer.clear()
      renderer.render(scene, camera)
      renderer.setRenderTarget(null)
      renderer.setClearColor(clear, alpha)
      camera.layers.enable(FX)
      scene.overrideMaterial = null
      scene.background = bg
    },
  }
}
