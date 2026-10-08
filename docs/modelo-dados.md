# Modelo de dados — CRM Lava Jato

> Dono: `tech-lead`. Toda mudança estrutural de schema passa por aqui e por `docs/decisoes.md`.
> Versão: rascunho inicial (2026-09-29), revisado no mesmo dia após respostas do usuário (baixa automática na venda de produto; opção "Fiado" e pagamento misto).

## Visão geral

```
User                                   (login; isolado do resto)

Customer 1───N Vehicle
Customer 1───N ServiceOrder N───0..1 Vehicle
ServiceOrder 1───N ServiceOrderItem ──> Service (catálogo)   [kind = SERVICE]
                                    ──> Product              [kind = PRODUCT]
ServiceOrder 1───N CashEntry (entradas IN = pagamentos da OS)

Product 1───N StockMovement N───0..1 CashEntry (compra lançada no caixa, opcional)
ServiceOrderItem [PRODUCT] 1───0..1 StockMovement [SALE] (baixa automática da venda)
CashCategory 1───N CashEntry (entradas/saídas manuais)
```

Pontos centrais:

- **Pagamento = lançamento de caixa.** Não existe tabela `Payment` separada: um pagamento é um `CashEntry` de direção `IN` com `serviceOrderId` preenchido. Assim o caixa tem uma única fonte de verdade e é impossível um pagamento existir sem entrar no caixa (ou o contrário). Ver D-12 em `decisoes.md`.
- **Estoque muda só por `StockMovement`.** Movimentações são manuais (entrada, baixa, acerto), **exceto a venda de produto no atendimento**, que gera baixa automática (`SALE`) ligada ao item. Item de **serviço nunca** mexe no estoque. Ver "Regras de estoque na venda" e D-15.
- **"Fiado" não é forma de pagamento no banco.** Na tela de pagamento aparece como opção ao lado de Dinheiro/Pix/Débito/Crédito, mas escolher Fiado apenas conclui o atendimento **sem criar `CashEntry`**; o saldo em aberto é o fiado. Ver "Pagamento na conclusão (inclui Fiado e misto)".
- **Preços são "congelados" no item** do atendimento (`unitPriceCents`, `description`), para que alterar o catálogo não mude atendimentos antigos.
- **IDs**: `Int` autoincremento em todas as tabelas (o id do atendimento vira o "nº da OS" exibido).
- **Datas**: `DateTime` em UTC. Campos `occurredAt` representam a data do fato (pode ser retroativa); `createdAt/updatedAt` são técnicos.
- **Dinheiro**: sempre `Int` em centavos, nunca negativo nos campos de valor (a direção do dinheiro é dada por `direction`).
- **Exclusão**: cadastros referenciados (cliente, veículo, produto, serviço, categoria) não são apagados, são **inativados** (`active = false`) e somem das listas/seleções. **Exceções (D-47)**: cliente sem nenhum atendimento pode ser excluído (veículos junto) e atendimento `CANCELED` sem pagamentos pode ser excluído (itens junto); com isso, serviço/produto antes bloqueados só por essa OS voltam a poder ser excluídos (D-35).

---

## Entidades

### User (usuário para login)

| Campo | Tipo | Obrig. | Observações |
|---|---|---|---|
| id | Int | sim | PK autoincremento |
| email | String | sim | único; login |
| name | String | sim | exibido no topo |
| passwordHash | String | sim | hash bcrypt (nunca a senha) |
| createdAt / updatedAt | DateTime | sim | técnicos |

Um único registro, criado por script de seed a partir de variáveis de ambiente. Sem tela de cadastro de usuário, sem papéis.

### Customer (cliente)

| Campo | Tipo | Obrig. | Observações |
|---|---|---|---|
| id | Int | sim | PK |
| name | String | sim | 2–120 caracteres |
| phone | String | não | só dígitos (normalizado); ex. `11987654321` |
| notes | String | não | observações livres |
| active | Boolean | sim | default `true` |
| createdAt / updatedAt | DateTime | sim | |

Índices: `name`, `phone` (busca no balcão). Telefone **não** é único (casal pode dividir número).

### Vehicle (veículo)

| Campo | Tipo | Obrig. | Observações |
|---|---|---|---|
| id | Int | sim | PK |
| customerId | Int | sim | FK → Customer |
| type | enum `VehicleType` | sim | `CAR` \| `MOTORCYCLE` |
| plate | String | não | normalizada: maiúsculas, sem hífen/espaço (`ABC1D23`); **única quando preenchida** |
| brand | String | não | marca |
| model | String | não | modelo |
| color | String | não | cor |
| notes | String | não | |
| active | Boolean | sim | default `true` |
| createdAt / updatedAt | DateTime | sim | |

Índices: `plate` (único — Postgres e SQLite aceitam vários `NULL` em índice único), `customerId`.
Regra: o veículo pertence a um único cliente. Transferência de dono = editar `customerId` (histórico de atendimentos continua apontando para o cliente original do atendimento).

### Service (catálogo de serviços)

| Campo | Tipo | Obrig. | Observações |
|---|---|---|---|
| id | Int | sim | PK |
| name | String | sim | único sem caixa/acento via `searchName` (D-34); ex. "Lavagem completa" |
| searchName | String | sim | `foldText(name)`, índice único |
| description | String | não | |
| carPriceCents | Int | não | preço para carro; `null` = não oferecido para carro |
| motorcyclePriceCents | Int | não | preço para moto; `null` = não oferecido para moto |
| active | Boolean | sim | default `true` |
| createdAt / updatedAt | DateTime | sim | |

Regra: pelo menos um dos dois preços deve ser preenchido (validação Zod). Dois campos em vez de tabela de preços porque só existem dois tipos de veículo.

### Product (produto)

| Campo | Tipo | Obrig. | Observações |
|---|---|---|---|
| id | Int | sim | PK |
| name | String | sim | único sem caixa/acento via `searchName` (D-34) |
| searchName | String | sim | `foldText(name)`, índice único |
| description | String | não | |
| unit | String | sim | default `"un"` (ex.: un, frasco, galão) — só rótulo |
| salePriceCents | Int | não | preço de venda avulsa; `null` = produto só de uso interno |
| stockQuantity | Int | sim | default 0; **cache** da soma das movimentações (ver abaixo); escrito só por `recomputeProductStock` |
| minStockQuantity | Int | não | limite mínimo (E8, D-56): estoque ≤ mínimo = "estoque baixo"; `null` = sem alerta |
| active | Boolean | sim | default `true` |
| createdAt / updatedAt | DateTime | sim | |

Quantidade em **unidades inteiras** (frascos, galões) — confirmado pelo usuário (D-25).

### StockMovement (movimentação de estoque)

| Campo | Tipo | Obrig. | Observações |
|---|---|---|---|
| id | Int | sim | PK |
| productId | Int | sim | FK → Product |
| type | enum `StockMovementType` | sim | `IN` (entrada/compra), `OUT` (baixa manual: uso, perda), `ADJUSTMENT` (acerto de inventário), `SALE` (baixa automática de venda no atendimento) |
| quantity | Int | sim | **delta com sinal**: `IN` > 0, `OUT` e `SALE` < 0, `ADJUSTMENT` ≠ 0 (qualquer sinal) |
| reason | String | não | ex.: "Compra fornecedor X", "Acabou o frasco"; em `SALE`: "Venda OS nº X" |
| cashEntryId | Int | não | FK → CashEntry: despesa gerada junto com a entrada (opcional) |
| serviceOrderItemId | Int | não | FK → ServiceOrderItem, **único**; preenchido só em `SALE` |
| occurredAt | DateTime | sim | data do fato |
| createdAt | DateTime | sim | |

Índices: `(productId, occurredAt)`, `cashEntryId`, único em `serviceOrderItemId`. FKs `Restrict` nas três (D-55). Implementado na E8 (migrations `..._stock` nos dois bancos, só `CREATE TABLE`/`ADD COLUMN`).
Regras:
- Criar/excluir movimentação atualiza `Product.stockQuantity` **na mesma transação**.
- O estoque não pode ficar negativo (baixa maior que o saldo é rejeitada).
- No acerto de inventário a tela pede a **quantidade contada**; o sistema grava o delta (`contada − atual`).
- Na entrada (`IN`), a tela oferece "lançar compra no caixa" com valor total → cria um `CashEntry` `OUT` (categoria "Compra de produtos") e liga via `cashEntryId`.
- Excluir uma entrada com despesa ligada exclui a despesa junto (D-57); o caixa não edita/exclui lançamentos ligados a movimentação.
- Produto inativo: sem novas entradas/baixas; acerto permitido (D-57).
- Movimentações `SALE` são criadas/alteradas/removidas **somente** pelo atendimento; a tela de estoque as mostra no histórico (com link para a OS) mas não permite editá-las nem excluí-las.

### ServiceOrder (atendimento / ordem de serviço)

| Campo | Tipo | Obrig. | Observações |
|---|---|---|---|
| id | Int | sim | PK; exibido como "OS nº" |
| customerId | Int | sim | FK → Customer |
| vehicleId | Int | não | FK → Vehicle; **obrigatório se houver item de serviço**; deve pertencer ao cliente |
| status | enum `ServiceOrderStatus` | sim | `OPEN` (em andamento), `DONE` (concluído), `CANCELED` |
| occurredAt | DateTime | sim | data do atendimento (default agora) |
| completedAt | DateTime | não | preenchido ao concluir |
| discountCents | Int | sim | default 0; 0 ≤ desconto ≤ subtotal |
| totalCents | Int | sim | **cache**: Σ itens − desconto |
| paidCents | Int | sim | **cache**: Σ pagamentos (CashEntry IN da OS) |
| notes | String | não | |
| createdAt / updatedAt | DateTime | sim | |

Índices: `customerId`, `(status, occurredAt)`.
Regras:
- Status de pagamento é **derivado**, não armazenado: `paidCents = 0` → "Não pago"; `0 < paidCents < totalCents` → "Parcial"; `paidCents = totalCents` → "Pago".
- Pagamento não pode exceder o saldo da OS (`amount ≤ totalCents − paidCents`).
- Não é possível reduzir itens/desconto a ponto de `totalCents < paidCents`.
- Cancelar só é permitido sem pagamentos (estorne-os antes). OS cancelada não conta em nada. Cancelar uma OS `DONE` remove as baixas `SALE` dos seus itens (produto volta ao estoque).
- Transições permitidas: `OPEN → DONE`, `OPEN → CANCELED`, `DONE → CANCELED`. Não há reabrir (`DONE → OPEN`).
- `totalCents` e `paidCents` só são escritos por uma função de domínio (`recalcOrder(tx, orderId)`), chamada na mesma transação de qualquer alteração de item, desconto ou pagamento.

### ServiceOrderItem (item do atendimento)

| Campo | Tipo | Obrig. | Observações |
|---|---|---|---|
| id | Int | sim | PK |
| orderId | Int | sim | FK → ServiceOrder (cascade ao excluir OS) |
| kind | enum `OrderItemKind` | sim | `SERVICE` \| `PRODUCT` |
| serviceId | Int | cond. | obrigatório se `kind = SERVICE` |
| productId | Int | cond. | obrigatório se `kind = PRODUCT` |
| description | String | sim | snapshot do nome no momento |
| quantity | Int | sim | default 1; ≥ 1 |
| unitPriceCents | Int | sim | sugerido do catálogo (preço por tipo de veículo, ou `salePriceCents`), **editável** |
| totalCents | Int | sim | `quantity × unitPriceCents` |

Índice: `orderId`.
Uma tabela só para serviço e produto (em vez de duas) porque os campos são os mesmos. Item de serviço **nunca** baixa estoque (D-05); item de produto baixa automaticamente conforme a seção abaixo (D-15).

#### Regras de estoque na venda (item `PRODUCT`) — D-15

| Situação | Efeito no estoque |
|---|---|
| Item de produto em OS `OPEN` (adicionar, alterar, remover) | Nenhum. A tela só mostra o estoque disponível como informação. |
| Concluir a OS (`OPEN → DONE`) | Para cada item `PRODUCT`, cria `StockMovement` `SALE` com `quantity = −item.quantity` e `serviceOrderItemId = item.id`. |
| Adicionar item de produto em OS `DONE` | Cria a baixa `SALE` do item na hora. |
| Alterar quantidade de item de produto em OS `DONE` | Atualiza a baixa `SALE` do item para `−novaQuantidade` (estoque ajustado pela diferença). |
| Remover item de produto de OS `DONE` | Exclui a baixa `SALE` do item (produto volta ao estoque). |
| Cancelar OS `DONE` (`DONE → CANCELED`) | Exclui todas as baixas `SALE` da OS. |
| Cancelar OS `OPEN` | Nenhum (não havia baixa). |
| Estornar (excluir) pagamento | **Nenhum.** Estorno é financeiro; o produto já foi entregue. Para devolver o produto, remova o item ou cancele a OS. |

- Reversão = **excluir a movimentação `SALE`** vinculada (a venda deixou de existir), recalculando `Product.stockQuantity` na mesma transação. Coerente com D-17 (sem trilha de auditoria).
- Estoque insuficiente: concluir a OS (ou adicionar/aumentar item em OS `DONE`) é **bloqueado** se algum produto ficaria negativo; a mensagem indica o produto e o saldo e oferece o atalho "Acertar inventário". Mantém a regra "estoque nunca negativo".
- Tudo (itens, baixas, caches da OS e do produto, pagamentos da conclusão) em **uma transação**.
- Implementado na E9 (D-59): `addProductItem`, `updateOrderItem`, `removeOrderItem`, `completeOrder` e `cancelOrder` em `src/server/orders/domain.ts`; venda só de produtos dispensa veículo.

### CashCategory (categoria de caixa)

| Campo | Tipo | Obrig. | Observações |
|---|---|---|---|
| id | Int | sim | PK |
| name | String | sim | |
| direction | enum `CashDirection` | sim | `IN` \| `OUT` |
| active | Boolean | sim | default `true` |

Único: `(name, direction)` (no domínio, também sem diferenciar acento/caixa — D-52). Categorias de sistema: "Saldo inicial / aporte" e "Compra de produtos" (D-51). Seed inicial:
- Entradas: "Saldo inicial / aporte", "Outras entradas".
- Saídas: "Compra de produtos", "Aluguel", "Água e luz", "Salários / diárias", "Manutenção de equipamentos", "Retirada do dono", "Outras despesas".

O usuário pode criar/renomear/inativar categorias. Pagamentos de atendimento **não** usam categoria (são identificados por `serviceOrderId`).

### CashEntry (lançamento de caixa — inclui pagamentos)

| Campo | Tipo | Obrig. | Observações |
|---|---|---|---|
| id | Int | sim | PK |
| direction | enum `CashDirection` | sim | `IN` \| `OUT` |
| amountCents | Int | sim | > 0 |
| method | enum `PaymentMethod` | sim | `CASH`, `PIX`, `DEBIT_CARD`, `CREDIT_CARD` |
| categoryId | Int | cond. | obrigatório quando **não** é pagamento de OS; categoria da mesma direção |
| serviceOrderId | Int | não | preenchido = é **pagamento** do atendimento (exige `direction = IN`) |
| description | String | não | |
| occurredAt | DateTime | sim | data em que o dinheiro entrou/saiu |
| createdAt / updatedAt | DateTime | sim | |

Índices: `occurredAt`, `serviceOrderId`, `categoryId`.
Regras:
- Exatamente um de `serviceOrderId` / `categoryId` preenchido.
- Criar/editar/excluir um pagamento recalcula a OS na mesma transação. "Estorno" = excluir o pagamento (com confirmação).
- Lançamentos podem ser editados/excluídos (usuário único, sem trilha de auditoria — D-17).
- `PaymentMethod` **não** tem valor "Fiado": fiado é ausência de pagamento, não dinheiro que entrou.

#### Pagamento na conclusão (inclui Fiado e misto) — D-28

A tela de conclusão/pagamento mostra as opções **Dinheiro, Pix, Débito, Crédito e Fiado**.

- **Pagamento total**: uma ou mais linhas (forma + valor) somando o total → um `CashEntry` `IN` por linha; OS `DONE`, situação "Pago".
- **Fiado**: conclui a OS (`DONE`) **sem criar nenhum `CashEntry`**; situação "Não pago"; saldo devedor do cliente aumenta no total da OS.
- **Misto** (ex.: R$ 30 no Pix e o resto fiado): o usuário informa as linhas pagas agora; a tela mostra "Restante R$ X fica no fiado" e, ao confirmar, cria um `CashEntry` por linha paga e conclui a OS. O restante **não gera registro algum** — é simplesmente `totalCents − paidCents`, situação "Parcial". Não existe linha "Fiado com valor".
- Soma das linhas pagas deve ser ≤ total (acima do total é rejeitado; sem troco/crédito — troco é resolvido fora do sistema, lança-se o valor do serviço).
- Recebimentos posteriores (tela "Receber do cliente", E6) oferecem apenas as formas reais (Dinheiro, Pix, Débito, Crédito), sem "Fiado".

---

### LoginAttempt (E5, D-43)

Infraestrutura, não dado de negócio: `key` (PK, e-mail em minúsculas), `failures` (Int), `lockedUntil` (DateTime?), `updatedAt`; índice em `updatedAt`. Guarda o limite de tentativas de login (5 erros -> bloqueio de 15 min); registros antigos são apagados automaticamente.

### Implementação da E4 (D-36 a D-40)

- Aplicado no schema: `ServiceOrder`, `ServiceOrderItem`, `CashCategory`, `CashEntry` e enums; `StockMovement` e a relação `ServiceOrderItem.stockMovement` entraram na E8 (D-55..D-58). Na E4 só havia ações para itens `SERVICE`; itens `PRODUCT` e as baixas `SALE` entraram na E9 (D-59).
- Itens/desconto/observação editáveis em `OPEN` e `DONE`; veículo só em `OPEN`; OS `DONE` não fica sem itens. Situação de pagamento só existe para `DONE`; total R$ 0 concluído = "Pago".
- Seed de `CashCategory`: `ensureDefaultCashCategories` (idempotente), executado por `npm run db:seed`.

### Mudanças planejadas na fase 2 (ainda NÃO aplicadas ao schema)

Todas aditivas (só `CREATE TABLE`/`ADD COLUMN`), migrations nos dois bancos (D-41). Detalhes em `docs/roadmap.md` (E11, E12) e D-64..D-68.

- **E10 Relatórios**: nenhuma mudança (D-63).
- **E11** — `AppSettings` (linha única `id = 1`, criada sob demanda): `debtOverdueDays Int @default(30)`, `debtReminderTemplate String?`, `pixKey String?`, `updatedAt`. `Customer.lastDebtReminderAt DateTime?` (D-65, D-66).
- **E12** — `Appointment`: `id`, `customerId` (FK Restrict), `vehicleId?` (FK Restrict, do mesmo cliente), `scheduledAt DateTime`, `durationMinutes Int @default(60)`, `status AppointmentStatus @default(SCHEDULED)` (`SCHEDULED | DONE | CANCELED | NO_SHOW`), `serviceOrderId Int? @unique` (FK Restrict), `notes?`, `createdAt/updatedAt`; índices `(status, scheduledAt)` e `customerId` (D-67).

```
Customer 1───N Appointment N───0..1 Vehicle
Appointment 0..1───0..1 ServiceOrder   (vínculo guardado no agendamento)
```

## Valores derivados

### Saldo devedor do cliente

```
saldoDevedor(cliente) = Σ (totalCents − paidCents)
                        sobre ServiceOrder do cliente com status = DONE
```

- OS `OPEN` não entra (serviço ainda não entregue); OS `CANCELED` nunca entra.
- Nunca é digitado: muda apenas quando itens/desconto/pagamentos mudam.
- "Lista de fiado" = OS `DONE` com `paidCents < totalCents`, ordenadas por `occurredAt` (mais antigas primeiro). Em Prisma: `where: { status: 'DONE', paidCents: { lt: prisma.serviceOrder.fields.totalCents } }`.
- **Receber do cliente** (valor único cobrindo várias OS; `receiveFromCustomer`, D-48..D-50): distribui o valor pelas OS em aberto, da mais antiga para a mais nova (`occurredAt` asc, `id` como desempate), gerando **um `CashEntry` por OS** afetada (sobra parcial na última), tudo em uma transação que trava as OS pendentes em ordem de id e relê os saldos. Valor > saldo total é rejeitado. `searchCustomers`/`getCustomerDetail` expõem `debtCents`.
- Conferência: um teste/rotina `recalcOrder` para todas as OS deve produzir os mesmos caches (garante que o cache nunca diverge da fonte).

### Saldo do caixa

```
saldoCaixa(até data D) = Σ amountCents (IN, occurredAt ≤ D) − Σ amountCents (OUT, occurredAt ≤ D)
movimentoPeríodo(A..B)  = mesmas somas filtrando A ≤ occurredAt < B
```

- Fiado não pago nunca aparece aqui, porque só pagamento gera `CashEntry`.
- Caixa é um livro contínuo (sem abertura/fechamento diário). O "saldo inicial" é um lançamento `IN` na categoria "Saldo inicial / aporte".
- Relatórios agrupam por `method` (quanto em dinheiro vs Pix vs cartão) e por categoria/"Atendimentos".
- Períodos ("hoje", "este mês") são calculados em `America/Sao_Paulo` e convertidos para UTC antes da consulta.

### Estoque atual

`Product.stockQuantity` = Σ `StockMovement.quantity` do produto (inclui as baixas `SALE` de vendas em atendimentos concluídos). É cache atualizado na mesma transação da movimentação; a fonte de verdade são as movimentações.

---

## Rascunho do schema Prisma

> Requer Prisma ≥ 6.2 (enums suportados em SQLite). Em produção troca-se apenas o `provider` para `postgresql`: `prisma/postgres/schema.prisma` é **gerado** do principal, com migrations próprias (D-41). O schema real vive em `prisma/schema.prisma`; este rascunho é histórico.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite" // "postgresql" em produção
  url      = env("DATABASE_URL")
}

enum VehicleType {
  CAR
  MOTORCYCLE
}

enum StockMovementType {
  IN
  OUT
  ADJUSTMENT
  SALE // baixa automática de venda no atendimento
}

enum ServiceOrderStatus {
  OPEN
  DONE
  CANCELED
}

enum OrderItemKind {
  SERVICE
  PRODUCT
}

enum CashDirection {
  IN
  OUT
}

enum PaymentMethod {
  CASH
  PIX
  DEBIT_CARD
  CREDIT_CARD
}

model User {
  id           Int      @id @default(autoincrement())
  email        String   @unique
  name         String
  passwordHash String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

model Customer {
  id        Int            @id @default(autoincrement())
  name      String
  phone     String?
  notes     String?
  active    Boolean        @default(true)
  createdAt DateTime       @default(now())
  updatedAt DateTime       @updatedAt
  vehicles  Vehicle[]
  orders    ServiceOrder[]

  @@index([name])
  @@index([phone])
}

model Vehicle {
  id         Int            @id @default(autoincrement())
  customerId Int
  customer   Customer       @relation(fields: [customerId], references: [id])
  type       VehicleType
  plate      String?        @unique
  brand      String?
  model      String?
  color      String?
  notes      String?
  active     Boolean        @default(true)
  createdAt  DateTime       @default(now())
  updatedAt  DateTime       @updatedAt
  orders     ServiceOrder[]

  @@index([customerId])
}

model Service {
  id                   Int                @id @default(autoincrement())
  name                 String
  searchName           String             @unique // D-34
  description          String?
  carPriceCents        Int?
  motorcyclePriceCents Int?
  active               Boolean            @default(true)
  createdAt            DateTime           @default(now())
  updatedAt            DateTime           @updatedAt
  orderItems           ServiceOrderItem[]
}

model Product {
  id             Int                @id @default(autoincrement())
  name           String
  searchName     String             @unique // D-34
  description    String?
  unit           String             @default("un")
  salePriceCents Int?
  stockQuantity  Int                @default(0)
  active         Boolean            @default(true)
  createdAt      DateTime           @default(now())
  updatedAt      DateTime           @updatedAt
  movements      StockMovement[]
  orderItems     ServiceOrderItem[]
}

model StockMovement {
  id          Int               @id @default(autoincrement())
  productId   Int
  product     Product           @relation(fields: [productId], references: [id], onDelete: Restrict) // D-35
  type        StockMovementType
  quantity    Int // delta com sinal
  reason      String?
  cashEntryId Int?
  cashEntry   CashEntry?        @relation(fields: [cashEntryId], references: [id], onDelete: SetNull)
  serviceOrderItemId Int?              @unique // só em SALE
  serviceOrderItem   ServiceOrderItem? @relation(fields: [serviceOrderItemId], references: [id])
  occurredAt  DateTime
  createdAt   DateTime          @default(now())

  @@index([productId, occurredAt])
}

model ServiceOrder {
  id            Int                @id @default(autoincrement())
  customerId    Int
  customer      Customer           @relation(fields: [customerId], references: [id])
  vehicleId     Int?
  vehicle       Vehicle?           @relation(fields: [vehicleId], references: [id])
  status        ServiceOrderStatus @default(OPEN)
  occurredAt    DateTime           @default(now())
  completedAt   DateTime?
  discountCents Int                @default(0)
  totalCents    Int                @default(0) // cache: Σ itens − desconto
  paidCents     Int                @default(0) // cache: Σ pagamentos
  notes         String?
  createdAt     DateTime           @default(now())
  updatedAt     DateTime           @updatedAt
  items         ServiceOrderItem[]
  payments      CashEntry[]

  @@index([customerId])
  @@index([status, occurredAt])
}

model ServiceOrderItem {
  id             Int           @id @default(autoincrement())
  orderId        Int
  order          ServiceOrder  @relation(fields: [orderId], references: [id], onDelete: Cascade)
  kind           OrderItemKind
  serviceId      Int?
  service        Service?      @relation(fields: [serviceId], references: [id], onDelete: Restrict) // D-35
  productId      Int?
  product        Product?      @relation(fields: [productId], references: [id], onDelete: Restrict) // D-35
  description    String
  quantity       Int           @default(1)
  unitPriceCents Int
  totalCents     Int
  stockMovement  StockMovement? // baixa SALE (só itens PRODUCT de OS DONE)

  @@index([orderId])
}

model CashCategory {
  id        Int           @id @default(autoincrement())
  name      String
  direction CashDirection
  active    Boolean       @default(true)
  entries   CashEntry[]

  @@unique([name, direction])
}

model CashEntry {
  id             Int             @id @default(autoincrement())
  direction      CashDirection
  amountCents    Int
  method         PaymentMethod
  categoryId     Int?
  category       CashCategory?   @relation(fields: [categoryId], references: [id])
  serviceOrderId Int? // preenchido = pagamento de atendimento
  serviceOrder   ServiceOrder?   @relation(fields: [serviceOrderId], references: [id])
  description    String?
  occurredAt     DateTime
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt
  stockMovements StockMovement[]

  @@index([occurredAt])
  @@index([serviceOrderId])
  @@index([categoryId])
}
```

### Regras que o schema não garante (validar em Zod + funções de domínio, com teste unitário)

1. Valores monetários ≥ 0; `CashEntry.amountCents` e quantidades de item > 0.
2. `Service`: ao menos um preço preenchido.
3. `Vehicle.plate` normalizada antes de gravar.
4. `ServiceOrder.vehicleId` pertence ao `customerId`; obrigatório se houver item `SERVICE`.
5. `ServiceOrderItem`: `serviceId` xor `productId` conforme `kind`; `totalCents = quantity × unitPriceCents`.
6. `CashEntry`: `serviceOrderId` xor `categoryId`; pagamento sempre `IN`; categoria com a mesma direção.
7. Pagamento ≤ saldo da OS; OS com pagamento não pode ser cancelada nem ter total < pago.
8. Estoque nunca negativo; `stockQuantity` e caches da OS atualizados na mesma transação.
9. `StockMovement.serviceOrderItemId` preenchido ⇔ `type = SALE`; item `PRODUCT` de OS `DONE` tem exatamente uma baixa `SALE` com `quantity = −item.quantity`; item `SERVICE` nunca tem.
10. Transições de status só `OPEN→DONE`, `OPEN→CANCELED`, `DONE→CANCELED`.
