# AV Builder — AI Web Engineering Platform

Uma extensão Chrome (Manifest V3) que funciona como **AI Web App Builder + Visual
Builder + Code Generator + Runtime + Design System**, tudo rodando localmente no
navegador, sem backend obrigatório e com custo operacional próximo de zero.

> Descreva o app em português natural → a plataforma planeja, gera componentes,
> renderiza um preview funcional, permite edição visual e por código, valida,
> corrige e exporta um projeto estático real (`index.html` / `styles.css` /
> `app.js`).

Este diretório é autocontido: não depende de nada do resto do repositório
(`csos/`, `desktop/`, o PWA da C&S). É um produto novo, vivendo lado a lado.

## Como testar (modo desenvolvedor)

1. `chrome://extensions` → ative "Modo do desenvolvedor".
2. "Carregar sem compactação" → selecione a pasta `ai-builder/`.
3. Clique no ícone da extensão para abrir o **Side Panel**.
4. Digite um pedido, ex: *"Sistema de controle de estoque para uma loja de
   materiais de construção, com produtos, fornecedores, entradas, saídas e
   estoque mínimo"* → **Gerar aplicação**.

Não é necessário configurar nenhuma API de IA: o **Local Planner** (determinístico,
100% offline) já produz uma aplicação funcional. Configurar um provedor de IA
(Anthropic/OpenAI-compatível) em *Configurações* apenas refina nomes, textos e
copy — nunca é obrigatório para o loop principal funcionar.

## Testes automatizados

```
node ai-builder/tests/run-tests.mjs
```

Cobre os módulos determinísticos e sem dependência de `chrome.*`: planner,
gerador de código, sanitização, validador e o writer de ZIP nativo.

## Documentação

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — arquitetura completa (16 subsistemas),
  decisões técnicas e trade-offs.
- [`VISION.md`](./VISION.md) — visão de produto, diferenciais e o que fica para
  as próximas fases.

## Status por fase (ver `VISION.md` §"Fases" para detalhes)

| Fase | Escopo | Status |
|---|---|---|
| 1–6 | Visão, arquitetura, UX, modelo de dados, engine, camada de IA | ✅ concluídas |
| 7 | Builder visual (canvas, seleção, drag&drop, layers, undo/redo) | ✅ MVP funcional |
| 8 | Runtime / preview multi-dispositivo | ✅ MVP funcional |
| 9 | Validação + auto-repair | ✅ regras essenciais |
| 10 | Exportação (ZIP nativo, projeto estático) | ✅ funcional |
| 11–13 | Hardening / performance / QA adversarial | 🟡 parcial — ver `VISION.md` |
