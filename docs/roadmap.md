# Roadmap — CRM Lava Jato

> Mantido pelo `tech-lead`. Modelo de dados em `docs/modelo-dados.md`; decisões em `docs/decisoes.md`.
> Status possíveis: `pendente`, `em andamento`, `em teste`, `concluída`.
> **MVP = Entregas 0 a 5**: ao fim da E5 o lava jato já registra atendimentos, recebe à vista ou deixa pendente e usa o sistema em produção.

## Regras válidas para todas as entregas

- Critério de "pronto": typecheck, lint e testes passando (resultado real informado), critérios de aceite validados pelo `qa`, telas funcionando em celular (≈ 375 px) e desktop.
- Dinheiro em centavos; campos de valor na tela aceitam formato BRL ("1.234,56") e convertem sem float.
- Toda escrita que toca mais de uma tabela usa transação (`prisma.$transaction`).
- Item de **serviço nunca** altera estoque (teste de regressão mantido pelo `qa` a partir da E4). Só a venda de produto no atendimento baixa estoque automaticamente (E9, D-15).
- "Fiado" aparece na UI como opção de pagamento, mas nunca gera lançamento no caixa (D-28).
- Fluxo de trabalho por entrega: `backend-dev` (schema + domínio + actions + unit tests) → `frontend-dev` (telas) → `qa` (e2e + verificação dos critérios). O `tech-lead` revisa ao final.

## Resumo

| # | Entrega | Status |
|---|---|---|
| 0 | Setup do projeto | concluída |
| 1 | Login e layout base | concluída |
| 2 | Clientes e veículos | concluída |
| 3 | Catálogo de serviços | concluída |
| 4 | Atendimentos com recebimento | concluída |
| 5 | Deploy em produção (fecha o MVP) | concluída |
| 6 | Fiado: pendências e pagamentos parciais | concluída |
| 7 | Caixa: saídas, categorias e extrato | concluída |
| 8 | Produtos e estoque | concluída |
| 9 | Venda de produtos no atendimento | concluída |
| 10 | Relatórios (faturamento, serviços/produtos mais vendidos, clientes frequentes) | concluída |
| 11 | Fiado atrasado: lembretes com mensagem de WhatsApp | pendente |
| 12 | Agendamento de atendimentos | pendente |
| 13 | Identidade visual: logo real e ícones (pode correr em paralelo à E10) | pendente |

### Ordem recomendada da fase 2 (E10–E13) — D-60

1. **E10 Relatórios** — maior interesse do dono, **sem mudança de schema** e só leitura (risco zero para os dados); usa o que já existe (OS, itens, pagamentos).
2. **E11 Fiado atrasado** — pequena (uma tabela de configurações de linha única + um campo em `Customer`); reaproveita as consultas da E6 e cria o utilitário de link `wa.me` que a E12 reutiliza.
3. **E12 Agendamento** — a maior: entidade nova, tela nova e ligação com o fluxo de atendimento. Vai por último para não atrasar as duas anteriores e já contar com o `wa.me`.
4. **E13 Identidade visual** — só assets e frontend, independente do resto. Recomenda-se o `frontend-dev` fazê-la **em paralelo à E10**, enquanto o `backend-dev` escreve as consultas dos relatórios. A troca de cor de acento (azul) depende do dono (P15).

---

## Entrega 0 — Setup do projeto

**Status:** concluída (2026-09-29)
**Objetivo:** projeto rodando localmente com a stack decidida, ferramentas de qualidade e utilitários base, pronto para receber features.

**Entidades:** nenhuma de negócio. O schema começa só com `User`; cada entrega adiciona suas próprias tabelas (não criar o modelo inteiro de uma vez).

**Telas:** página inicial placeholder.

**Tarefas**
- `backend-dev`
  - Criar app Next.js (App Router, TS estrito, `src/`), ESLint, Prettier.
  - Prisma com SQLite (`DATABASE_URL` em `.env`, `.env.example` versionado), `prisma/seed.ts`.
  - Estrutura: `src/server/` (domínio), `src/lib/` (utils), `src/app/` (rotas).
  - Utils com testes: `money.ts` (`parseBRL("1.234,56") → 123456`, `formatBRL(123456) → "R$ 1.234,56"`), `dates.ts` (início/fim de dia e mês em `America/Sao_Paulo` → UTC), `plate.ts` (normalização).
  - Scripts npm: `dev`, `build`, `lint`, `typecheck`, `test`, `test:e2e`, `db:seed`.
- `frontend-dev`
  - Tailwind + shadcn/ui inicializados; tema, fonte, componentes básicos (Button, Input, Form, Dialog, Table, Toast).
  - Componente `MoneyInput` (digita em BRL, entrega centavos) e `Money` (exibição).
- `qa`
  - Vitest configurado e rodando os testes de utils.
  - Playwright configurado com banco SQLite de teste isolado e um smoke test (página carrega).

**Critérios de aceite**
1. `npm run dev` sobe a aplicação; `npm run build` passa.
2. `lint`, `typecheck`, `test` e `test:e2e` rodam e passam.
3. `parseBRL`/`formatBRL` cobrem: "0,01", "10", "1.234,56", entrada vazia/inválida (erro), sem uso de float na conversão.
4. `.env.example` documenta todas as variáveis.

**Riscos:** migrations do Prisma são específicas por provider (SQLite ≠ Postgres) — tratado na E5; até lá usar `prisma migrate dev` em SQLite normalmente.

---

## Entrega 1 — Login e layout base

**Status:** concluída (2026-09-29)
**Objetivo:** só o dono acessa o sistema; navegação principal pronta para celular e desktop.

**Entidades:** `User`.

**Telas:** `/login`; layout autenticado com menu (Atendimentos, Clientes, Serviços, Caixa, Estoque — itens futuros ocultos ou desabilitados), botão Sair.

**Tarefas**
- `backend-dev`: seed cria o usuário a partir de `SEED_USER_EMAIL`/`SEED_USER_PASSWORD` (bcrypt); actions `login`/`logout`; sessão em cookie httpOnly, `secure`, `sameSite=lax`, assinado com `jose` (`AUTH_SECRET`), expiração 30 dias; `proxy.ts` (Next 16) redireciona não autenticados para `/login`. Limite simples de tentativas (5 erros = bloqueio de 15 min, em memória; limitação para serverless a tratar na E5).
- `frontend-dev`: tela de login; layout responsivo (menu inferior ou hambúrguer no celular, lateral no desktop).
- `qa`: e2e de login válido, senha errada, acesso direto a rota protegida sem sessão, logout.

**Critérios de aceite**
1. Sem sessão, qualquer rota exceto `/login` redireciona para `/login`.
2. Credenciais corretas levam à página inicial; incorretas mostram "E-mail ou senha inválidos" (sem indicar qual).
3. Senha nunca é armazenada nem logada em texto puro.
4. Sessão persiste ao fechar e reabrir o navegador; "Sair" encerra.

---

## Entrega 2 — Clientes e veículos

**Status:** concluída (2026-09-29)
**Objetivo:** cadastrar e encontrar rapidamente clientes e seus veículos.

**Entidades:** `Customer`, `Vehicle`.

**Telas:** lista/busca de clientes (`/clientes`), novo/editar cliente, detalhe do cliente com lista de veículos (adicionar/editar/inativar veículo).

**Tarefas**
- `backend-dev`: models + migration; schemas Zod; actions de CRUD; busca única por nome (contém, sem diferenciar maiúsculas/acentos se viável), telefone (dígitos) e placa (normalizada); inativação.
- `frontend-dev`: telas acima; campo de busca único no topo da lista; formulário de veículo com tipo (Carro/Moto) em destaque; máscara de telefone e placa.
- `qa`: unit das validações; e2e: criar cliente com 2 veículos (um carro, uma moto), buscar por nome, telefone e placa, placa duplicada rejeitada, inativar veículo.

**Critérios de aceite**
1. Cliente exige nome; telefone e observações opcionais; telefone salvo só com dígitos.
2. Cliente pode ter N veículos; veículo exige tipo; placa opcional, salva normalizada (`abc-1d23` → `ABC1D23`).
3. Placa já cadastrada em outro veículo é rejeitada com mensagem clara indicando o cliente dono.
4. Busca por "abc1d23", "ABC-1D23", parte do nome ou parte do telefone encontra o cliente.
5. Inativados não aparecem na busca padrão (filtro "mostrar inativos" disponível).

---

## Entrega 3 — Catálogo de serviços

**Status:** concluída (2026-09-29) — inclui cadastro básico de produtos (CRUD), antecipado da E8 a pedido do usuário; estoque continua na E8
**Objetivo:** manter a tabela de serviços com preço de carro e de moto.

**Entidades:** `Service`.

**Telas:** `/servicos` — lista com preços carro/moto, novo/editar, inativar.

**Tarefas**
- `backend-dev`: model + migration; Zod (ao menos um preço); CRUD; inativação.
- `frontend-dev`: lista e formulário com dois `MoneyInput` (Carro / Moto) e indicação "não oferecido" quando vazio.
- `qa`: unit da validação; e2e de cadastro, edição de preço e inativação.

**Critérios de aceite**
1. Serviço exige nome único e pelo menos um preço.
2. Preço vazio para um tipo = serviço não aparece para esse tipo de veículo no atendimento.
3. Serviço inativo não aparece para novos atendimentos.

---

## Entrega 4 — Atendimentos com recebimento

**Status:** concluída (2026-09-29)
**Objetivo:** registrar o atendimento do balcão (cliente, veículo, serviços), concluir e receber à vista **ou** deixar pendente. É o coração do MVP.

**Entidades:** `ServiceOrder`, `ServiceOrderItem` (só `kind = SERVICE` nesta entrega), `CashEntry` (apenas pagamentos de OS). `CashCategory` já criada no schema (seed), usada na E7.

**Telas**
- `/atendimentos` — lista do dia (filtro por data e status), com situação do pagamento (Não pago / Parcial / Pago).
- Novo atendimento — buscar cliente/placa **ou** cadastro rápido (nome + telefone + veículo); escolher veículo; adicionar serviços (preço sugerido pelo tipo do veículo, editável); desconto; observação.
- Detalhe do atendimento — itens, total, pago, saldo; ações: Concluir, Registrar pagamento, Excluir pagamento (estorno), Cancelar.
- Diálogo de pagamento na conclusão — opções **Dinheiro, Pix, Débito, Crédito e Fiado**; permite uma ou mais linhas pagas (forma + valor) e mostra "Restante R$ X fica no fiado" quando a soma é menor que o total.
- Tela "Caixa do dia" simplificada: pagamentos recebidos hoje, total por forma de pagamento.

**Tarefas**
- `backend-dev`: models + migration; `recalcOrder(tx, orderId)`; actions: criar/editar OS, adicionar/remover item, `completeOrder(orderId, payments[])` (conclui e grava 0..N pagamentos na mesma transação; lista vazia = Fiado), cancelar, registrar/excluir pagamento; todas as regras de `modelo-dados.md` (itens, desconto, pagamento ≤ saldo, transições de status, cancelar sem pagamento, veículo do cliente). `PaymentMethod` sem valor "Fiado". Unit tests de cada regra.
- `frontend-dev`: telas acima, otimizadas para poucos cliques: ao concluir, diálogo com as 5 opções (Dinheiro, Pix, Débito, Crédito, Fiado); escolher uma forma pré-preenche o total; "+ outra forma" adiciona linha; escolher Fiado conclui sem valores.
- `qa`: unit de `recalcOrder` e regras; e2e: (a) novo cliente → atendimento com 2 serviços → concluir em Pix → aparece no caixa do dia; (b) concluir com **Fiado** → nada no caixa, situação "Não pago"; (c) **misto**: total R$ 80, R$ 30 no Pix → caixa +R$ 30, situação "Parcial", saldo R$ 50; (d) misto com duas formas (R$ 50 dinheiro + R$ 30 Pix) = "Pago"; teste de regressão "estoque inalterado".

**Critérios de aceite**
1. Preço sugerido corresponde ao tipo do veículo (carro/moto) e pode ser alterado no item.
2. `total = Σ(qtd × preço) − desconto`; desconto não pode ser maior que o subtotal.
3. A tela de pagamento oferece **Dinheiro, Pix, Débito, Crédito e Fiado**. Cada linha paga cria um lançamento de entrada com a forma e a data; **Fiado conclui o atendimento sem criar nenhum lançamento** no caixa.
4. **Misto**: linhas pagas somando menos que o total concluem o atendimento como "Parcial"; a tela mostra antes de confirmar "Restante R$ X fica no fiado"; só as linhas pagas entram no caixa. Soma acima do total é rejeitada.
5. Pagamento maior que o saldo é rejeitado; excluir pagamento volta o saldo e remove do caixa.
6. Não é possível cancelar atendimento com pagamento.
7. Nenhum item de serviço altera `Product.stockQuantity`.
8. Fluxo completo (cliente já cadastrado, 1 serviço, pago à vista ou Fiado) em no máximo ~6 toques no celular.

**Riscos:** consistência dos caches `totalCents`/`paidCents` — mitigado por função única + testes.

---

## Entrega 5 — Deploy em produção (fecha o MVP)

**Status:** concluída (2026-10-05) — no ar (Vercel + Neon), e2e passando em Postgres, rate limit de login no banco, backup diário no GitHub rodando e restauração da Neon testada (repetir com dados reais após a primeira semana de uso)
**Objetivo:** sistema acessível pela internet com Postgres, dados persistentes e backup.
**Pendência herdada da E1:** o limite de tentativas de login fica em memória do processo (src/server/auth/rate-limit.ts); em produção serverless não é compartilhado entre instâncias — mover para armazenamento externo (ex.: tabela no Postgres).

**Entidades:** todas até aqui (sem mudança de modelo).

**Telas:** nenhuma nova.

**Tarefas**
- `backend-dev`: estratégia de migrations para Postgres (proposta: migrations versionadas geradas para Postgres — `prisma migrate diff`/pasta própria — e `prisma db push` em SQLite no dev; validar com o `tech-lead` antes); configurar hospedagem (Vercel + Neon, D-27), variáveis de ambiente, seed do usuário em produção; backup automático do banco (recurso do provedor) e procedimento documentado de restauração.
- `frontend-dev`: ícone/manifest para "Adicionar à tela inicial" no celular; revisão visual em aparelho real.
- `qa`: rodar a suíte e2e contra um banco Postgres (local ou branch de teste); smoke test em produção (login, criar atendimento de teste e excluí-lo/cancelá-lo).

**Critérios de aceite**
1. Aplicação acessível por HTTPS; login funciona em produção.
2. Migrations aplicam do zero em um Postgres vazio sem erro.
3. Suíte e2e passa contra Postgres.
4. Backup configurado e restauração testada uma vez.

**Riscos:** diferenças SQLite × Postgres (busca case-insensitive, migrations). Por isso testar em Postgres antes de liberar.

---

## Entrega 6 — Fiado: pendências e pagamentos parciais

**Status:** concluída (2026-10-01)
**Objetivo:** controlar quem deve, quanto e desde quando; receber parcial ou total, inclusive várias visitas de uma vez.

**Entidades:** `ServiceOrder`, `CashEntry` (pagamentos), `Customer` (saldo derivado).

**Telas**
- `/fiado` — lista de clientes com saldo devedor (total, atendimento mais antigo pendente), total geral em aberto.
- Detalhe do cliente: card "Saldo devedor" + lista de atendimentos pendentes + botão "Receber".
- Diálogo "Receber do cliente": valor (pré-preenchido com o saldo total), forma de pagamento (Dinheiro, Pix, Débito, Crédito — **sem** "Fiado"), data; mostra como será distribuído.
- Detalhe do atendimento: histórico de pagamentos parciais.

**Tarefas**
- `backend-dev`: consulta de pendências (`status = DONE` e `paidCents < totalCents`); `saldoDevedor(customerId)`; action `receiveFromCustomer(customerId, amount, method, date)` distribuindo do mais antigo para o mais novo em uma transação (um `CashEntry` por OS). Unit tests: parcial, quitação exata, valor maior que a dívida (rejeitado), valor cobrindo várias OS com sobra parcial na última.
- `frontend-dev`: telas acima; destaque visual de saldo devedor ao iniciar novo atendimento para esse cliente.
- `qa`: unit das distribuições; e2e: dois atendimentos pendentes (R$ 50 e R$ 80) → receber R$ 100 → primeiro quitado, segundo com saldo R$ 30 → caixa recebeu R$ 100 em dois lançamentos → receber R$ 30 → saldo zero, cliente some de `/fiado`.

**Critérios de aceite**
1. Saldo devedor do cliente = Σ(total − pago) dos atendimentos concluídos; nunca editável manualmente.
2. Pagamento parcial reduz o saldo e entra no caixa na data informada, com a forma de pagamento.
3. Recebimento acima do saldo é rejeitado.
4. Distribuição sempre do atendimento mais antigo para o mais novo.
5. Excluir um pagamento parcial restaura o saldo e remove o valor do caixa.
6. Atendimento pendente não soma no caixa em nenhuma visão.
7. Atendimentos concluídos como **Fiado** (total em aberto) ou **misto** (parte paga na conclusão) aparecem em `/fiado` com o saldo restante correto; o valor pago na conclusão já consta no caixa e não é contado de novo.
8. "Fiado" não é oferecido como forma no recebimento posterior.

---

## Entrega 7 — Caixa: saídas, categorias e extrato

**Status:** concluída (2026-10-01)
**Objetivo:** registrar toda saída (compras, despesas) e outras entradas, e ver o saldo e o extrato por período.

**Entidades:** `CashEntry`, `CashCategory`.

**Telas**
- `/caixa` — período (hoje / semana / mês / personalizado), cards: entradas, saídas, resultado do período, saldo acumulado; totais por forma de pagamento; extrato com filtro por tipo e categoria.
- Novo lançamento (entrada ou saída): valor, categoria, forma de pagamento, data, descrição.
- `/caixa/categorias` — criar, renomear, inativar.

**Tarefas**
- `backend-dev`: seed das categorias; CRUD de lançamentos manuais (bloquear edição por essa tela de lançamentos que são pagamentos de OS — esses se editam pelo atendimento); consultas de saldo e agregações por período (limites em `America/Sao_Paulo`). Unit tests de agregação, inclusive lançamentos às 23h30 e 00h30 (fronteira de dia em UTC).
- `frontend-dev`: telas acima; atalho "+ Despesa" visível no celular; link do lançamento de pagamento para o atendimento.
- `qa`: e2e: registrar saldo inicial, 2 despesas e 1 pagamento de atendimento → saldo confere; lançamento perto da meia-noite cai no dia correto.

**Critérios de aceite**
1. Saldo do caixa = Σ entradas − Σ saídas até a data; resultado do período = mesmas somas no intervalo.
2. Lançamento manual exige categoria da mesma direção; pagamento de atendimento aparece como "Atendimento nº X".
3. Totais por forma de pagamento batem com o extrato.
4. Datas agrupadas pelo fuso de São Paulo.
5. Categoria inativa não aparece para novos lançamentos, mas continua no histórico.

---

## Entrega 8 — Produtos e estoque

**Status:** concluída (2026-10-02)
**Objetivo:** saber quanto há de cada produto, com entradas, baixas e acertos manuais.

**Entidades:** `Product`, `StockMovement`, `CashEntry` (opcional, na compra).

**Telas**
- `/estoque` — lista de produtos com quantidade atual; novo/editar/inativar produto.
- Detalhe do produto: histórico de movimentações; ações "Entrada", "Baixa", "Acertar inventário".
- Entrada com opção "Lançar compra no caixa" (valor total, forma de pagamento) → saída na categoria "Compra de produtos".

**Tarefas**
- `backend-dev`: models + migration; actions de movimentação atualizando `stockQuantity` em transação; bloqueio de estoque negativo; acerto grava o delta; entrada com despesa opcional (mesma transação). Unit tests.
- `frontend-dev`: telas acima; botões grandes de +/−.
- `qa`: e2e: cadastrar produto → entrada 10 com compra no caixa → baixa 3 → acerto para 5 → histórico e saldo corretos, despesa no caixa; baixa maior que o estoque rejeitada; regressão: concluir atendimento só com serviços não altera estoque.

**Critérios de aceite**
1. Quantidade atual = soma das movimentações, sempre.
2. Baixa acima do disponível é rejeitada.
3. Acerto de inventário recebe a quantidade contada e registra a diferença.
4. Entrada com "lançar no caixa" cria a saída vinculada; sem a opção, o caixa não muda.
5. Nenhum item de serviço altera estoque.
6. O enum/tela já prevê o tipo `SALE` (usado na E9); movimentações `SALE` aparecem no histórico, mas não podem ser editadas nem excluídas pela tela de estoque.

---


## Entrega 9 — Venda de produtos no atendimento (com baixa automática)

**Status:** concluída (2026-10-02)
**Objetivo:** vender produtos avulsos (ex.: 1 garrafa de óleo, aromatizante) junto com o atendimento ou sozinhos, entrando no total e no caixa/fiado normalmente, e **baixando o estoque automaticamente** (D-15).

**Entidades:** `ServiceOrderItem` (`kind = PRODUCT`), `Product`, `StockMovement` (`type = SALE`, `serviceOrderItemId`).

**Telas**
- No atendimento, botão "Adicionar produto" (produtos ativos com preço de venda; mostra estoque disponível; quantidade editável). Atendimento só com produtos não exige veículo.
- Aviso de estoque insuficiente na conclusão, com atalho para "Acertar inventário".
- Histórico do produto mostra as vendas ("Venda — OS nº X", com link).

**Tarefas**
- `backend-dev`: suportar itens `PRODUCT` (preço sugerido = `salePriceCents`, editável); veículo obrigatório só se houver serviço; implementar as regras de baixa/reversão de `modelo-dados.md` ("Regras de estoque na venda") em `completeOrder`, adicionar/alterar/remover item e `cancelOrder`, tudo em transação com `recalcOrder` e atualização de `stockQuantity`. Unit tests para cada linha da tabela de regras.
- `frontend-dev`: UI de produto no atendimento; exibição do estoque disponível; mensagens de bloqueio por estoque insuficiente; vendas no histórico do produto.
- `qa`: unit das regras; e2e dos cenários dos critérios abaixo; regressão "serviço não baixa estoque".

**Critérios de aceite**
1. Produto sem preço de venda não aparece para venda.
2. Item de produto soma no total e segue as mesmas regras de pagamento, Fiado e misto.
3. Com a OS **em andamento** (`OPEN`), adicionar/alterar/remover produto **não** altera o estoque.
4. Ao **concluir** a OS, cada item de produto gera uma baixa `SALE` igual à quantidade vendida (estoque 10, venda de 2 → 8), vinculada ao item; itens de serviço não geram movimentação.
5. Em OS **concluída**: adicionar produto baixa na hora; alterar a quantidade ajusta a baixa pela diferença (2 → 3 ⇒ estoque −1); remover o item devolve a quantidade ao estoque.
6. **Cancelar** OS concluída (sem pagamentos) devolve ao estoque tudo o que ela baixou; cancelar OS em andamento não mexe no estoque.
7. **Estornar pagamento** não altera o estoque.
8. Concluir (ou aumentar item em OS concluída) com estoque insuficiente é **bloqueado** com mensagem indicando produto e saldo; nada é gravado (transação inteira desfeita).
9. Baixas `SALE` não podem ser editadas/excluídas pela tela de estoque; `stockQuantity` = Σ movimentações após qualquer sequência dos cenários acima.

---

## Entrega 10 — Relatórios

**Status:** concluída (2026-10-05) — critério 7 (5 mil OS em < 2 s) não medido; 1 flakiness de e2e em customers.spec.ts:190 sem relação
**Objetivo:** responder, para qualquer período, "quanto vendi, quanto recebi, o que mais vendo e quem mais volta", sem planilha. Só leitura; nenhuma regra de escrita muda.

**Entidades:** nenhuma nova, **sem migration**. Lê `ServiceOrder`, `ServiceOrderItem`, `CashEntry`, `Customer`, `Vehicle`, `Service`, `Product`.

**Definições (D-61, D-62)**
- **Vendido (competência)** = Σ `ServiceOrder.totalCents` (líquido de desconto) das OS **`DONE`** com `occurredAt` no período. Inclui o que ficou no fiado.
- **Recebido de atendimentos (caixa)** = Σ `CashEntry.amountCents` com `serviceOrderId` preenchido e `occurredAt` no período, qualquer que seja a data da OS. Mostra também "dos quais R$ X são fiado de atendimentos anteriores ao período" (OS com `occurredAt` antes do início).
- **Ficou no fiado (do período)** = Σ (`totalCents − paidCents`) das OS do Vendido, na situação **atual** (se já foram pagas depois, não aparecem).
- **Atendimentos** = nº de OS `DONE` no período; **ticket médio** = Vendido ÷ atendimentos (arredondado ao centavo; "—" se zero).
- **Excluídos de tudo:** OS `CANCELED` (inclusive canceladas depois de concluídas) e OS `OPEN` (ainda não concluídas). Pagamento estornado não existe mais (D-17), então some naturalmente.
- Lançamentos manuais de entrada ("Saldo inicial / aporte", "Outras entradas") **não** são faturamento; despesas, resultado e saldo continuam no `/caixa` (o relatório linka para lá, não duplica).
- **Ranking de serviços / produtos**: itens `SERVICE` (ou `PRODUCT`) de OS `DONE` no período, agrupados por `serviceId`/`productId`, exibidos com o nome **atual** do catálogo; colunas: quantidade, nº de atendimentos, valor bruto (Σ `item.totalCents`, **sem ratear o desconto da OS** — rodapé avisa e mostra o desconto total do período); serviços com quebra **carro / moto** (tipo do veículo da OS). Ordenação por quantidade (padrão) ou valor.
- **Clientes mais frequentes**: por cliente, nº de OS `DONE` no período (visitas), valor (Σ `totalCents`), última visita e saldo devedor atual; ordenação por visitas (desempate valor); top 20; link para o cliente. Inclui inativos.

**Telas**
- `/relatorios` (novo item de menu) — seletor de período reaproveitando o do caixa (hoje / semana / mês / personalizado) + atalho "mês passado"; cards: Vendido, Recebido (com a nota de fiado antigo), Ficou no fiado, Atendimentos, Ticket médio.
- Tabela "Por dia" (ou "Por mês" quando o período passa de 62 dias): data, atendimentos, vendido, recebido. Barras simples em CSS; **sem biblioteca de gráficos**.
- Abas/seções: "Serviços mais vendidos", "Produtos mais vendidos", "Clientes mais frequentes".

**Tarefas**
- `backend-dev`: `src/server/reports/` com `getSalesReport(period)`, `getTopItems(period, kind, sort)`, `getTopCustomers(period)`; períodos via `resolvePeriod` (D-53) + preset `lastMonth`; personalizado limitado a 366 dias; agrupamento por dia/mês **em `America/Sao_Paulo` feito em TypeScript** (sem funções de data do SQL, que diferem entre SQLite e Postgres); `requireSession()`. Unit tests com o mesmo cenário montado à mão (ver critérios), inclusive OS às 23h30 e 00h30 locais e OS cancelada após concluída. Rodar também em `test:pg`.
- `frontend-dev`: tela acima, mobile primeiro (cards empilhados, tabelas com rolagem horizontal); item de menu sem quebrar o menu inferior do celular (se faltar espaço, agrupar em "Mais").
- `qa`: e2e com cenário conhecido: 3 OS no mês (R$ 100 pago Pix; R$ 80 fiado; R$ 50 misto com R$ 20 pago), 1 OS cancelada, 1 OS aberta, 1 recebimento hoje de fiado do mês anterior (R$ 40) → Vendido R$ 230, Recebido R$ 160 (R$ 40 de fiado anterior), Ficou no fiado R$ 110, 3 atendimentos, ticket R$ 76,67; rankings e clientes conferem.

**Critérios de aceite**
1. Os números do cenário do `qa` batem exatamente (em centavos) em SQLite e Postgres.
2. OS `CANCELED` e `OPEN` não aparecem em nenhum número nem ranking.
3. Recebido do relatório = soma dos lançamentos "Atendimento nº X" do `/caixa` no mesmo período.
4. Receber um fiado hoje aumenta o Recebido de hoje e reduz o "Ficou no fiado" do período da OS original, sem mudar o Vendido de nenhum período.
5. OS concluída às 23h30 (horário de São Paulo) conta no dia local, não no dia UTC.
6. Ranking usa o nome atual do serviço/produto mesmo que o item tenha descrição antiga; desconto não é rateado e o rodapé informa o total de descontos.
7. Tela utilizável em 375 px; período de 1 ano carrega em menos de ~2 s com volume realista (ex.: 5 mil OS no seed de teste).

**Riscos:** confusão entre "vendido" e "recebido" — mitigar com rótulos e uma linha de ajuda em cada card. Desempenho de agregação em memória — volume do negócio é pequeno; se pesar, trocar por `groupBy` do Prisma (índice `(status, occurredAt)` já existe). Menu inferior lotado no celular.

---

## Entrega 11 — Fiado atrasado: lembretes com WhatsApp

**Status:** pendente
**Objetivo:** mostrar quem está devendo há tempo demais e cobrar com um toque, abrindo o WhatsApp com a mensagem pronta (link `wa.me`, sem API paga e sem envio automático).

**Definições (D-64, D-65, D-66)**
- Continua valendo D-30: fiado **não tem vencimento** por OS. "Atrasado" é **calculado**: cliente cujo atendimento pendente **mais antigo** tem `occurredAt` há **N dias ou mais** (dias corridos em `America/Sao_Paulo`). N é configurável, padrão **30** (confirmar: P12).
- O valor cobrado na mensagem é o **saldo devedor total** do cliente (D-48), não só a parte "atrasada".
- "Lembrete" = **lista + destaque na tela inicial**. Não há push, e-mail nem envio em segundo plano; quem envia é o dono, tocando no botão.
- Ao tocar em "Cobrar no WhatsApp" o sistema registra a data em `Customer.lastDebtReminderAt` (o sistema não sabe se a mensagem foi de fato enviada; o registro é "cobrança aberta em").

**Entidades (migration aditiva nos dois bancos)**
- **`AppSettings`** (nova, linha única `id = 1`, criada sob demanda como em D-54 — sem seed): `debtOverdueDays Int` (padrão 30, 1..365), `debtReminderTemplate String?` (null = texto padrão), `pixKey String?` (opcional, aparece na mensagem se preenchida — P13), `updatedAt`.
- **`Customer.lastDebtReminderAt DateTime?`** (novo campo).

**Telas**
- `/fiado`: filtro "Atrasados" (com contagem) e selo "Atrasado há X dias" em cada cliente; botão "Cobrar no WhatsApp" e "Última cobrança: dd/mm" por cliente.
- Detalhe do cliente: mesmo botão no card "Saldo devedor".
- Início: card "Fiado atrasado: N clientes, R$ Y" → `/fiado?atrasados=1`.
- `/configuracoes` (nova, simples): prazo em dias, modelo da mensagem com variáveis `{nome}` (primeiro nome), `{valor}`, `{desde}` (data do atendimento mais antigo), `{dias}`, `{pix}`, pré-visualização com um cliente real e botão "Restaurar texto padrão"; chave Pix.
- Texto padrão (sugestão): "Olá {nome}, tudo bem? Aqui é da TZ Auto Estética. Passando para lembrar que ficou em aberto {valor} referente ao(s) serviço(s) desde {desde}. {pix}Qualquer dúvida estou à disposição. Obrigado!" (`{pix}` vira "Chave Pix: X. " ou some).

**Tarefas**
- `backend-dev`: migration aditiva (SQLite + Postgres); `getSettings`/`updateSettings` (Zod); `listDebtors` ganha `overdueOnly`, `overdueDays` e `oldestPendingAt` por cliente (já existe a ordenação por mais antigo, D-50); `getOverdueSummary()` para o card; `markDebtReminder(customerId)`; função pura `buildWhatsAppLink(phone, text)` em `src/lib/whatsapp.ts`: telefone só dígitos, remove zeros à esquerda, 10–11 dígitos → prefixa `55`, 12–13 começando com `55` → mantém, outro formato → `null` (sem link); `renderReminder(template, vars)` pura. Unit tests de ambos e da fronteira de N dias (OS com exatamente N dias conta como atrasada).
- `frontend-dev`: telas acima; o botão é um `<a href=wa.me… target=_blank>` (não `window.open` depois de `await`, que o celular bloqueia) e dispara `markDebtReminder` sem bloquear a navegação; cliente sem telefone válido → botão desabilitado com "Cadastre o telefone".
- `qa`: e2e: cliente com OS fiado de 31 dias e outro com 10 dias (N = 30) → só o primeiro em "Atrasados" e no card; link gerado contém `wa.me/55…` e o texto com nome, valor e data em BRL/dd/mm/aaaa; mudar N para 5 → ambos atrasados; cliente sem telefone → botão desabilitado; quitar o fiado → some dos atrasados.

**Critérios de aceite**
1. Atrasado ⇔ OS pendente mais antiga com idade ≥ N dias locais; quitar ou estornar muda a lista imediatamente.
2. Alterar N em `/configuracoes` vale na hora para lista e card; N fora de 1..365 é rejeitado.
3. O link abre o WhatsApp (app no celular, WhatsApp Web no desktop) com a mensagem completa, valores em BRL e acentos corretos (texto codificado com `encodeURIComponent`).
4. "Última cobrança" registra a data ao tocar no botão e aparece na lista e no cliente.
5. Nenhum dado de caixa, OS ou saldo é alterado por esta entrega.
6. Sem telefone ou telefone inválido: sem link, mensagem clara.

**Riscos:** telefones antigos cadastrados sem DDD (o link sai errado) — a tela mostra o número que será usado; mensagem de cobrança com tom inadequado — por isso o modelo é editável. Abertura do WhatsApp bloqueada como pop-up — usar link direto.

---

## Entrega 12 — Agendamento de atendimentos

**Status:** pendente
**Objetivo:** marcar horário para um cliente/veículo, ver a agenda do dia e transformar o agendamento em atendimento quando o cliente chega.

**Modelo (D-67, D-68)**
- **Nova entidade `Appointment`** (não é um status da OS: agendamento não tem itens, valor nem pagamento, e misturar mudaria todas as consultas de OS/fiado/relatórios):
  `id`, `customerId` (obrigatório, FK Restrict — mesma regra de D-23; cadastro rápido reaproveitado, D-36), `vehicleId?` (FK Restrict, deve ser do cliente), `scheduledAt DateTime` (início, UTC), `durationMinutes Int` (padrão 60; 15..720), `status` enum `AppointmentStatus` = `SCHEDULED` \| `DONE` \| `CANCELED` \| `NO_SHOW`, `serviceOrderId Int? @unique` (FK Restrict → OS gerada), `notes?` (o que o cliente pediu, texto livre), `createdAt/updatedAt`. Índices: `(status, scheduledAt)`, `customerId`.
- **Relação com `ServiceOrder`**: 1 agendamento → 0..1 OS. A OS não ganha campo novo; o vínculo fica no agendamento.
- **Transições**: `SCHEDULED → DONE` (só ao criar a OS), `SCHEDULED → CANCELED`, `SCHEDULED → NO_SHOW`, `CANCELED/NO_SHOW → SCHEDULED` (remarcar). `DONE` é final. Editar só em `SCHEDULED`. Excluir permitido em qualquer status exceto `DONE`.
- **Virar atendimento ("Iniciar atendimento")**: um toque abre "Novo atendimento" **pré-preenchido** com cliente, veículo e observação; ao salvar, `createOrder` recebe `appointmentId` e, na mesma transação, trava o agendamento, confere `SCHEDULED` e grava `DONE` + `serviceOrderId`. A OS nasce `OPEN` com `occurredAt` = agora (não o horário marcado). Não se cria OS vazia automaticamente (OS sem serviço exige escolher itens de qualquer forma). Agendamento já `DONE` → erro "Já virou o atendimento nº X" com link.
- **OS gerada**: cancelar a OS não mexe no agendamento; excluir a OS (D-47, só cancelada) desfaz o vínculo e devolve o agendamento para `SCHEDULED` na mesma transação.
- **Conflito de horário**: **só aviso, nunca bloqueio**. Ao salvar, se o intervalo `[scheduledAt, scheduledAt + duração)` cruzar outro agendamento `SCHEDULED`, a tela mostra "Já existe 1 agendamento nesse horário (Fulano, 14h)" e permite confirmar. Sem cadastro de boxes/capacidade (P14).
- Agendamento **não** entra em caixa, fiado, estoque nem relatórios.

**Telas (mínimo viável)**
- `/agenda` (novo item de menu): lista por dia (padrão hoje; setas dia anterior/próximo e seletor de data) e atalho "Próximos 7 dias"; cada linha: hora–fim, cliente, veículo (tipo/placa), observação, status; ações: Iniciar atendimento, Editar, Faltou, Cancelar, "Confirmar no WhatsApp" (texto fixo com data e hora, usa `buildWhatsAppLink` da E11).
- Novo/editar agendamento: buscar cliente/placa ou cadastro rápido; veículo; data; hora (passos de 15 min); duração (atalhos 30 min / 1 h / 2 h / 4 h / dia todo = 8 h); observação.
- Início: card "Agenda de hoje" (próximos horários, contagem).
- Detalhe do cliente: próximos agendamentos.

**Fora do MVP (evolução, se o dono pedir):** serviços previstos no agendamento pré-preenchendo itens; visão de calendário em grade; lembrete automático na véspera; horário de funcionamento/capacidade.

**Tarefas**
- `backend-dev`: model + enum + migration aditiva (SQLite + Postgres); `src/server/appointments/` (CRUD, transições, `findOverlaps`, `listAppointments({from,to})` com limites de dia em São Paulo); `createOrder` aceita `appointmentId` (lock do agendamento por `UPDATE`, como `lockOrder`/D-45); `deleteOrder` desfaz o vínculo. Unit tests: transições válidas/inválidas, sobreposição (encostado não conflita: 9h–10h e 10h–11h), conversão dupla simultânea (só uma passa), veículo de outro cliente rejeitado, cliente inativo rejeitado.
- `frontend-dev`: telas acima, mobile primeiro (lista, não grade); aviso de conflito como confirmação; pré-preenchimento do novo atendimento via `?agendamento=ID`.
- `qa`: e2e: agendar cliente existente amanhã 9h (1 h) → agendar outro 9h30 → aviso de conflito, confirma → os dois aparecem → "Iniciar atendimento" no primeiro → OS criada com cliente/veículo, agendamento "Atendido" com link → tentar converter de novo é recusado; marcar "Faltou" e remarcar; agendamento às 23h30 aparece no dia local correto.

**Critérios de aceite**
1. Agendamento exige cliente ativo, data/hora e duração válida; veículo, se informado, é do cliente.
2. Sobreposição com outro agendamento ativo gera aviso, não bloqueio; intervalos que só se encostam não avisam.
3. "Iniciar atendimento" leva ao novo atendimento já preenchido; ao salvar, a OS fica vinculada e o agendamento vira "Atendido"; nunca gera duas OS para o mesmo agendamento.
4. Cancelar/faltou/remarcar seguem as transições definidas; `DONE` não é editável.
5. Nenhum agendamento altera caixa, fiado, estoque ou relatórios.
6. Datas e horas exibidas e agrupadas em `America/Sao_Paulo`.

**Riscos:** campo de hora em celular (usar `input type="time"`/seletor nativo); confusão entre data marcada e data do atendimento (a OS usa a data real). Escopo crescer para "agenda completa" — manter o MVP acima.

---

## Entrega 13 — Identidade visual: logo real e ícones

**Status:** pendente (pode ser executada em paralelo à E10)
**Objetivo:** o sistema com a cara da TZ Auto Estética: logo real no lugar da marca em texto e ícones do celular a partir dela.

**Entidades:** nenhuma.

**Origem:** `public/brand/logo-original.png` (1600×896, **fundo grafite opaco**, tudo prata) e `public/brand/banner-referencia.png` (foto da fachada; versão nova da marca com "ESTÉTICA" em azul) — D-69.

**Telas:** login (logo grande), menu/topo (logo pequena), ícones PWA, favicon e apple-icon.

**Tarefas**
- `frontend-dev`
  - Obter versão **com fundo transparente** (preferência: arquivo vetorial do designer — P15; senão, recorte cuidadoso do PNG) em WebP/PNG otimizado; trocar o corpo de `BrandMark` (`src/components/brand-mark.tsx`) por `next/image`, mantendo a prop `size` (alturas aprox. sm 32, md 48, lg 96 px) e `alt="TZ Auto Estética"`. Se no tamanho `sm` o texto ficar ilegível, usar só a silhueta/“TZ” recortada.
  - Regerar `public/icons/*` (192, 512, maskable 512), `src/app/icon.png`, `apple-icon.png` e `favicon.ico` a partir do símbolo da logo.
  - Mover `banner-referencia.png` para fora de `public/` (ex.: `docs/brand/`) — é foto de referência, não precisa ser publicada.
  - **Não** alterar a paleta (grafite/prata) até a resposta da P15 sobre o azul.
- `qa`: smoke visual em 375 px e desktop (login, menu); conferir ícone instalado na tela inicial do celular; e2e existentes continuam passando (rótulo acessível "TZ Auto Estética" mantido).

**Critérios de aceite**
1. Logo aparece no login e no menu sem retângulo de fundo visível sobre o grafite do app, nítida em tela retina.
2. Ícone de "Adicionar à tela inicial" e favicon mostram a marca nova.
3. Imagens otimizadas (logo servida < ~100 KB) e sem quebra de layout no celular.
4. Nenhuma mudança de cor de tema sem decisão do dono.

**Riscos:** recorte de bordas cromadas sobre fundo escuro pode ficar serrilhado — por isso a preferência pelo arquivo original do designer. Logo larga (16:9) fica pequena em altura 32 px.

---

## Perguntas em aberto

P1–P11 foram respondidas em 2026-09-29 (P1 → D-15, P2 → D-14, P3 → D-19, P4 → D-29, P5 → D-20, P6 → D-30, P7 → D-23, P8 → D-25, P9 → D-28, P10 → D-27, P11 → D-31).

P12–P17 foram respondidas pelo dono em 2026-10-05, todas conforme a recomendação do tech-lead:

| # | Resposta | Afeta |
|---|---|---|
| P12 | Atrasado = 30 dias (ajustável nas configurações). | E11 |
| P13 | Incluir a chave Pix na cobrança: (chave removida) (chave de telefone; valor inicial do campo opcional em `AppSettings`). | E11 |
| P14 | Não bloquear horário: só avisar sobreposição. | E12 |
| P15 | Manter prata como destaque; azul só na logo por enquanto. Arquivo original (SVG/PDF/PNG transparente) a pedir ao designer — enquanto não vem, recorte cuidadoso do PNG atual. | E13 |
| P16 | Sem serviços previstos no agendamento: só observação em texto. | E12 |
| P17 | Duração padrão 1 hora, com atalhos 30 min / 2 h / 4 h / dia todo. | E12 |

Nenhuma pergunta em aberto no momento.
