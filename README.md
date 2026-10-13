# Abóbora 🎃

Uma abóbora de Halloween em 3D, numa sala antiga desenhada a nanquim, para esculpir direto no navegador.

O visual é inspirado nos desenhos animados dos anos 30: tudo em sépia, contornos de tinta que tremem como animação feita à mão, tinta escorrendo pelas paredes e uma luminária balançando sobre a mesa.

## Recursos

- **Faca**: esculpe à mão livre, com tamanho de lâmina ajustável — sementes e polpa saltam na mesa
- **Recorte**: marque os cantos e corte com bordas retas (ótimo para dentes e triângulos)
- **Formas**: círculo, triângulo, losango, estrela, coração, lua, raio e morcego, para recortar ou raspar; arraste para escolher o tamanho e o giro
- **Pintar**: paleta de tintas ou qualquer cor que você quiser, todas escorrendo pela casca (a rala corre mais, a grossa menos); qualquer cor pode brilhar no escuro, e tem borracha
- **Raspar**: tira só a casca, sem furar; a parte raspada brilha fraquinho com a vela
- **Remendo**: devolve a casca onde você cortou demais
- **Tampa**: corte e levante a tampa da abóbora
- **Fantasia**: troque o formato (redonda, alta, achatada, pera) e vista a abóbora com chapéu de bruxa, cartola, laço ou chifres
- Desfazer (`Ctrl+Z`), abóbora nova e modelos prontos: Clássica, Malvada, Fofinha e Vampiro
- Arraste fora da abóbora para girá-la e inclinar a vista
- Apagar as luzes para ver só a vela brilhando pelos cortes
- Sons sintetizados no navegador (vento, lareira, faca, coruja), com botão de mudo
- **Exposição**: envie sua abóbora com seu nome (sem precisar de conta) e veja as dos outros em 3D na mesa; tudo passa por aprovação antes de aparecer
- Cada obra aprovada ganha um link próprio para compartilhar, com prévia da abóbora, e pode receber curtidas
- Algumas surpresas escondidas pela casa 👀
- Salvar foto em PNG ou gravar um vídeo curto da abóbora girando
- Funciona no celular, com qualidade que se ajusta sozinha em aparelhos mais fracos

## Tecnologias

- [Three.js](https://threejs.org/) — renderização, sombras, bloom e um pós-processamento próprio de tinta (sépia, contornos por profundidade/normais, hachura e grão)
- [Blender](https://www.blender.org/) — modelagem da sala, da mesa, da abóbora e dos objetos, exportada como GLB comprimido com meshopt
- Web Audio API — todos os sons gerados em tempo real, sem arquivos de áudio
- [Vite](https://vite.dev/) + TypeScript
- Vercel Functions + Vercel Blob para a exposição

## Rodando localmente

```bash
npm install
npm run dev
```

## Editando a cena no Blender

A cena inteira (sala, abóbora e seus formatos, acessórios) é gerada pelos scripts em [`blender/`](blender/). Para regerar o modelo do site:

```bash
blender -b --factory-startup --python blender/scene.py
node scripts/compress-model.mjs
```

(ou `npm run model`, se o Blender estiver no PATH)

O script também salva `blender/abobora.blend` (fora do Git) para você abrir e explorar no Blender.

As texturas desenhadas (madeira, pedras, cartaz, tinta) são geradas no navegador e aplicadas pelo nome do material.

---

Desenvolvido por [Nadin](https://www.nadinweb.com.br/).
