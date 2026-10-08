# CRM Lava Jato

CRM web para um lava jato que presta serviços de limpeza e polimento de carros e motos. Idioma do projeto (UI, comentários de negócio, conversas): **português do Brasil**.

## Escopo
- **Produtos e serviços**: cadastro de produtos vendidos/usados e de serviços oferecidos (com preço, podendo variar entre carro e moto).
- **Estoque**: quantidade de produtos. Entradas (compras), baixas e acertos são **manuais** — um serviço realizado **não** desconta estoque, pois um produto é usado em vários serviços antes de acabar. **Exceção**: produto vendido avulso no atendimento (ex.: 1 garrafa de óleo) **baixa o estoque automaticamente** ao concluir o atendimento, e a baixa é revertida se o item for removido ou o atendimento cancelado (ver `docs/modelo-dados.md` e D-15 em `docs/decisoes.md`).
- **Caixa (entradas e saídas)**: todo dinheiro que entra (serviços/vendas pagos) e sai (compras, despesas).
- **Clientes**: clientes recorrentes; cada cliente pode ter **vários veículos** (tipo carro/moto, placa, marca, modelo, cor).
- **Pagamento posterior (fiado)**: um serviço pode ser registrado como pendente e quitado depois, total ou parcialmente; o valor só entra no caixa quando for pago. Formas de pagamento: dinheiro, Pix, débito e crédito; a tela de pagamento também oferece "Fiado" (conclui sem lançar no caixa) e permite pagamento misto (parte paga agora, o restante fica no fiado).

## Contexto de uso
- Sistema web, **um único usuário** no início (login simples). Não sobre-engenheirar multiusuário/permissões.
- Usado no dia a dia do balcão: telas rápidas, poucos cliques, funcionando bem em celular e desktop.

## Stack
- Next.js (App Router) + TypeScript
- Prisma ORM — SQLite em desenvolvimento, PostgreSQL em produção
- Tailwind CSS + shadcn/ui
- Validação com Zod; testes com Vitest (unit) e Playwright (e2e)

## Convenções
- Valores monetários sempre em **centavos (inteiro)** no banco e na lógica; formatar em BRL só na exibição.
- Datas armazenadas em UTC, exibidas em `America/Sao_Paulo`.
- Nomes de código (variáveis, tabelas) em inglês; textos de interface em português.

## Squad
Agentes do projeto em `.claude/agents/`:
- `tech-lead` — lidera o projeto: arquitetura, modelo de dados, plano de entregas, revisão de decisões.
- `backend-dev` — schema Prisma, server actions/API, regras de negócio.
- `frontend-dev` — telas, componentes, UX.
- `qa` — testes e revisão de bugs.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
