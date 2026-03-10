# Sophia Hub

Central de orquestração de agentes IA.

## Deploy na Vercel

### Opção 1 — Via GitHub (recomendado)

1. Crie um repositório no GitHub e faça push desta pasta
2. Acesse [vercel.com](https://vercel.com) e clique em **Add New Project**
3. Importe o repositório
4. A Vercel detecta automaticamente o Create React App
5. Clique em **Deploy** ✅

### Opção 2 — Via CLI

```bash
npm install -g vercel
vercel login
vercel --prod
```

## ⚠️ IMPORTANTE: API Key

Este projeto chama `api.anthropic.com` direto do browser.

**Para produção**, crie uma API Route na Vercel para proteger sua chave:

1. Crie `/api/chat.js` na raiz do projeto
2. Mova a chamada à API para lá
3. Adicione `ANTHROPIC_API_KEY` nas variáveis de ambiente da Vercel

## Scripts

```bash
npm start    # desenvolvimento local
npm run build # build de produção
```
