// comprime o GLB exportado pelo Blender com meshopt (comprime também os morph targets dos formatos)
//   node scripts/compress-model.mjs [entrada] [saída]
import { NodeIO, PropertyType } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions'
import { dedup, prune, quantize, reorder } from '@gltf-transform/functions'
import { MeshoptEncoder } from 'meshoptimizer'

const [input = 'blender/scene.raw.glb', output = 'public/models/scene.glb'] = process.argv.slice(2)

await MeshoptEncoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
const doc = await io.read(input)
await doc.transform(
  // materiais ficam de fora: o site acha vários pelo nome, mesmo quando são iguais
  dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH] }),
  // nós vazios marcam posições (velas, lareira, morcegos) e os UVs da abóbora guardam a escultura
  prune({ keepLeaves: true, keepAttributes: true }),
  reorder({ encoder: MeshoptEncoder }),
  quantize({ quantizeTexcoord: 14 }),
)
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE })
await io.write(output, doc)
console.log(`${input} → ${output}`)
