# Abóbora 🎃

Uma abóbora de Halloween em 3D, numa sala antiga desenhada a nanquim, para esculpir direto no navegador.

O visual é inspirado nos desenhos animados dos anos 30: tudo em sépia, contornos de tinta que tremem como animação feita à mão, tinta escorrendo pelas paredes e uma luminária balançando sobre a mesa.

## Recursos

- **Faca**: esculpe à mão livre, com tamanho de lâmina ajustável
- **Recorte**: marque os cantos e corte com bordas retas (ótimo para dentes e triângulos)
- **Remendo**: devolve a casca onde você cortou demais
- Desfazer (`Ctrl+Z`), abóbora nova e modelos prontos: Clássica, Malvada, Fofinha e Vampiro
- Arraste fora da abóbora para girá-la e inclinar a vista
- Apagar as luzes para ver só a vela brilhando pelos cortes
- Salvar foto em PNG
- Funciona no celular

## Tecnologias

- [Three.js](https://threejs.org/) — renderização, sombras, bloom e um pós-processamento próprio de tinta (sépia, contornos por profundidade/normais, hachura e grão)
- [Blender](https://www.blender.org/) — modelagem da sala, da mesa, da abóbora e dos objetos, exportada como GLB com compressão Draco
- [Vite](https://vite.dev/) + TypeScript

## Rodando localmente

```bash
npm install
npm run dev
```

## Editando a cena no Blender

A cena inteira é gerada pelo script [`blender/scene.py`](blender/scene.py), que também exporta `public/models/scene.glb`:

```bash
blender -b --factory-startup --python blender/scene.py
```

O script também salva `blender/abobora.blend` (fora do Git) para você abrir e explorar no Blender.

As texturas desenhadas (madeira, pedras, cartaz, tinta) são geradas no navegador e aplicadas pelo nome do material.
