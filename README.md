# Video-Higgsfiels — Estúdio de Geração de Imagens e Vídeos com IA

> **Estúdio open-source para geração de imagens e vídeos** com 38 modelos de IA em uma única barra de prompt — sem ecossistema fechado, sem assinatura de estúdio.

Baseado no [OpenHiggsfield AI](https://github.com/wide-trace/open-higgsfield.git).

---

## 🚀 Como Usar

```bash
pnpm install
pnpm dev            # http://localhost:3000
```

Abra o estúdio, pressione **Add key**, e cole sua platform key no formato `id:secret`.

### Variáveis de Ambiente

```bash
HF_API_BASE_URL=                      # URL base da API de geração (server only)
OPEN_HIGGSFIELD_READ_WRITE_TOKEN=     # Token de leitura/escrita do Vercel Blob
```

---

## ✨ Funcionalidades

### Geração

- **Um único compositor para Imagem e Vídeo.** Uma barra de prompt controla ambos; o modelo escolhido decide se é imagem ou vídeo. `⌘/Ctrl + Enter` para enviar.
- **38 modelos no catálogo** — 8 de imagem, 30 de vídeo: Soul 2, Soul Cinema, Seedance 2.5 (Edit / Extend), Seedance 2.0 (Fast / Mini), Kling 3 (Turbo / Std / Pro / 4K / Motion), Wan, Flux, Ideogram, Recraft, LTX, MiniMax, PixVerse, Grok, Qwen e mais.
- **Configurações por modelo.** Aspect ratio, resolução, duração, formato de saída, áudio, batch size, melhoria de prompt — cada modelo define suas próprias opções.
- **Inputs de mídia por papel.** Frame inicial, frame final, referências, vídeo e áudio, cada um com o limite definido pelo modelo.
- **Asset picker.** Anexe de sua biblioteca de uploads ou de qualquer execução finalizada no histórico.
- **Batch.** Até 4 resultados por envio.
- **Ciclo de vida em tempo real.** Skeletons abrem na grid ao enviar, o request é verificado a cada 4s até status terminal (deadline de 10 minutos).

### Galeria

- **Quatro escopos** — Imagem, Vídeo, Assets (todas as execuções) e Favoritos.
- **Grid masonry** com aspect ratio real, mais recentes primeiro.
- **Ações por item**: reutilizar, favoritar, deletar, selecionar.
- **Reutilizar restaura modelo, configurações e prompt**.
- **Viewer.** Mídia em tamanho completo com prompt (copiar em um clique), modelo, configurações, timestamp, download, favoritar e Recriar.
- **Modo seleção.** Shift-click para seleção em intervalo. Download em lote, favoritar/desfavoritar em lote, deletar em lote.
- **Undo.** Deletar é reversível por 6 segundos.

### Estado e Erros

- **Histórico persiste** no IndexedDB do navegador (60 registros). Favoritos nunca expiram.
- **Falhas, NSFW e execuções canceladas** são registradas como tiles failed com motivo e retry.
- **Sua própria platform key.** Armazenada em cookie httpOnly via server action.

---

## 🏗️ Arquitetura

Cada geração é um objeto: `{ model, prompt, media, settings }`.

- **A UI constrói esse objeto** e passa para uma server action.
- **Server actions são o único caller.** O navegador nunca fala diretamente com a API de geração.
- **O catálogo é a fonte da verdade** (`src/generation/catalog/`).
- **Cinco pequenos Zustand stores** — prompt de imagem/vídeo, mídia, settings, e um store `active`.
- **Uploads** vão direto para Vercel Blob através de `/api/blob`.

---

## 📁 Estrutura

```
src/
  app/          /  é o estúdio full-viewport e a única página
                /api/blob emite tokens de upload
                base.css controla o canvas do documento
  generation/   generate requests, server actions, API mapping, catalog, stores
  openhiggsfield/
                superfície do estúdio: composer, gallery, viewer, model picker,
                settings, asset picker, selection bar — e openhiggsfield.css
```

---

## 🎨 Design

Dark studio ground, accent lime `#d1fe17`, Inter em toda parte. O chrome é neutro para que o trabalho gerado seja a única cor na superfície.

Next.js 16 App Router · React 19 · CSS puro · Zustand · pnpm
