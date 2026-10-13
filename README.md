# Abóbora 🎃

Uma abóbora de Halloween em 3D, sobre uma mesa à luz da lua, para esculpir direto no navegador.

Arraste sobre a abóbora para cortar a casca, gire a cena arrastando fora dela e apague as luzes para ver a vela brilhar pelos buracos.

## Recursos

- Escultura em tempo real com espessura de parede e luz da vela vazando pelos cortes
- Faca e remendo, com tamanho de lâmina ajustável
- Desfazer (`Ctrl+Z`) e abóbora nova
- Modelos de rosto prontos: Clássica, Malvada, Fofinha e Vampiro
- Modo "apagar as luzes"
- Salvar foto da sua abóbora em PNG
- Funciona no celular (toque para esculpir, pinça para zoom)

## Tecnologias

- [Three.js](https://threejs.org/) — cena, sombras e pós-processamento (bloom)
- [Vite](https://vite.dev/) + TypeScript
- Tudo procedural: geometria da abóbora, texturas da madeira, céu e silhuetas são gerados em código, sem arquivos de modelo

## Rodando localmente

```bash
npm install
npm run dev
```

Build de produção:

```bash
npm run build
npm run preview
```
