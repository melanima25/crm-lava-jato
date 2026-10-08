import type { Page } from "@playwright/test";
import {
  badge,
  brl,
  cashRows,
  centsIn,
  completeFiado,
  createOrderQuick,
  createService,
  dbAll,
  dbNum,
  dbRun,
  dialog,
  expect,
  login,
  methodBtn,
  noHScroll,
  openComplete,
  confirmPayment,
  pickServices,
  test,
  token,
} from "./orders-helpers";

// Entrega 6: fiado (saldo devedor, recebimento do cliente). Cada teste cria clientes/atendimentos
// próprios direto no banco (SQL) e assere por cliente/linha, nunca por totais globais.

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString();

/** yyyy-mm-dd em America/Sao_Paulo, `daysAgo` dias atrás. */
function ymd(daysAgo = 0): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(
    new Date(Date.now() - daysAgo * DAY),
  );
}

type SeedOrder = {
  total: number;
  paid?: number;
  status?: "DONE" | "OPEN" | "CANCELED";
  daysAgo?: number;
  minutesAgo?: number;
  at?: string;
};

function seedCustomer(
  name: string,
  o: { phone?: string; active?: boolean; plate?: string; searchName?: string } = {},
) {
  const now = iso(new Date());
  const id = Number(
    dbRun(
      `insert into Customer (name, searchName, phone, active, createdAt, updatedAt) values (?, ?, ?, ${o.active === false ? "false" : "true"}, ?, ?)`,
      name,
      o.searchName ?? name.toLowerCase(),
      o.phone ?? null,
      now,
      now,
    ),
  );
  let vehicleId: number | undefined;
  if (o.plate) {
    vehicleId = Number(
      dbRun(
        "insert into Vehicle (customerId, type, plate, active, createdAt, updatedAt) values (?, 'CAR', ?, true, ?, ?)",
        id,
        o.plate,
        now,
        now,
      ),
    );
  }
  return { id, vehicleId };
}

function seedOrder(customerId: number, o: SeedOrder, vehicleId?: number) {
  const now = iso(new Date());
  const at =
    o.at ?? iso(new Date(Date.now() - (o.daysAgo ?? 0) * DAY - (o.minutesAgo ?? 0) * 60_000));
  const status = o.status ?? "DONE";
  const paid = o.paid ?? 0;
  const id = Number(
    dbRun(
      `insert into ServiceOrder (customerId, vehicleId, status, occurredAt, completedAt, discountCents, totalCents, paidCents, createdAt, updatedAt)
       values (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      customerId,
      vehicleId ?? null,
      status,
      at,
      status === "DONE" ? at : null,
      o.total,
      paid,
      now,
      now,
    ),
  );
  // recalcOrder reconstrói o total a partir dos itens: toda OS semeada precisa de um item.
  dbRun(
    `insert into ServiceOrderItem (orderId, kind, description, quantity, unitPriceCents, totalCents)
     values (?, 'SERVICE', 'Servico semeado', 1, ?, ?)`,
    id,
    o.total,
    o.total,
  );
  if (paid > 0) {
    dbRun(
      `insert into CashEntry (direction, amountCents, method, serviceOrderId, occurredAt, createdAt, updatedAt)
       values ('IN', ?, 'PIX', ?, ?, ?, ?)`,
      paid,
      id,
      at,
      now,
      now,
    );
  }
  return id;
}

const entriesOf = (orderId: number) =>
  dbAll(
    "select amountCents, method from CashEntry where serviceOrderId = ? order by id",
    orderId,
  ) as { amountCents: number; method: string }[];
const paidOf = (orderId: number) =>
  dbNum("select paidCents from ServiceOrder where id = ?", orderId);
const countEntries = (orderId: number) =>
  dbNum("select count(*) from CashEntry where serviceOrderId = ?", orderId);

// ---------------------------------------------------------------- UI helpers

// Celular: "2 atendimentos" no cartão; desktop: 3ª coluna só com o número.
async function expectPending(page: Page, name: string, n: number) {
  const row = debtorRow(page, name);
  const mobile = (page.viewportSize()?.width ?? 1280) < 768;
  if (mobile) await expect(row).toContainText(`${n} atendimento${n === 1 ? "" : "s"}`);
  else await expect(row.locator("td").nth(2)).toHaveText(String(n));
}
const debtorRows = (page: Page) => page.locator("[data-testid=debtor]:visible");
const debtorRow = (page: Page, name: string) => debtorRows(page).filter({ hasText: name });

async function gotoFiado(page: Page, q?: string, extra = "") {
  await page.goto(`/fiado${q ? `?q=${encodeURIComponent(q)}${extra}` : extra ? `?${extra}` : ""}`);
  await expect(page.getByRole("heading", { level: 1, name: "Fiado" })).toBeVisible();
  await page.waitForLoadState("networkidle"); // hidratação (dev)
}

/** Abre o diálogo "Receber do cliente" pela linha do cliente em /fiado. */
async function openReceive(page: Page, name: string) {
  await gotoFiado(page, name);
  await page.getByRole("button", { name: `Receber de ${name}` }).click();
  await expect(dialog(page).getByRole("heading", { name: "Receber do cliente" })).toBeVisible();
}

const amountField = (page: Page) => dialog(page).getByLabel("Valor a receber");
const receiveBtn = (page: Page) => dialog(page).getByRole("button", { name: /^Receber/ });

async function receive(
  page: Page,
  d: { amount?: string; method: "Dinheiro" | "Pix" | "Débito" | "Crédito"; date?: string },
) {
  if (d.amount !== undefined) await amountField(page).fill(d.amount);
  await methodBtn(page, d.method).click();
  if (d.date) await dialog(page).getByLabel("Data do recebimento").fill(d.date);
  await receiveBtn(page).click();
}

const looseBrl = (c: number) => new RegExp(brl(c).source.replace(/\(\?!\\d\)$/, ""));

async function expectDebtor(page: Page, name: string, cents: number) {
  await gotoFiado(page, name);
  await expect(debtorRow(page, name)).toHaveCount(1);
  // textContent do cartão cola o valor no texto seguinte: sem o (?!d) final de brl().
  await expect(debtorRow(page, name)).toContainText(looseBrl(cents));
}

async function expectNoDebtor(page: Page, name: string) {
  await gotoFiado(page, name);
  await expect(page.getByText(`Nenhum devedor para “${name}”`)).toBeVisible();
  await expect(debtorRows(page)).toHaveCount(0);
}

const cashRowsOf = async (page: Page, day: string, name: string) => {
  await page.goto(`/caixa?data=${day}`);
  await expect(page.getByRole("heading", { name: "Extrato" })).toBeVisible();
  return (await cashRows(page)).filter((r) => r.text.includes(name));
};

// ================================================================== cenário do roadmap

test.describe("cenário do roadmap (R$ 50 e R$ 80 no fiado)", () => {
  test("receber R$ 100 quita o 1º, deixa R$ 30 no 2º, em 2 lançamentos; receber R$ 30 zera", async ({
    page,
  }) => {
    await login(page);
    const tk = token();
    const name = `${tk} Roadmap`;
    const { id } = seedCustomer(name, { phone: "31988887777" });
    const o1 = seedOrder(id, { total: 5000, daysAgo: 2 });
    const o2 = seedOrder(id, { total: 8000, daysAgo: 1 });

    await expectDebtor(page, name, 13000);
    await expectPending(page, name, 2);

    await page.getByRole("button", { name: `Receber de ${name}` }).click();
    await expect(dialog(page)).toContainText(`${name} deve`);
    await expect(dialog(page)).toContainText(brl(13000));
    await expect(amountField(page)).toHaveValue("130,00"); // pré-preenchido com o saldo total
    await receive(page, { amount: "100", method: "Pix" });
    await expect(
      page.getByText(/R\$\s*100,00 recebido de .* \(2 atendimentos, 1 quitado\)/),
    ).toBeVisible();
    await expect(page.getByText(/Saldo restante: R\$\s*30,00/)).toBeVisible();
    await expect(dialog(page)).toBeHidden();

    expect(paidOf(o1)).toBe(5000);
    expect(paidOf(o2)).toBe(5000);
    expect(entriesOf(o1)).toEqual([{ amountCents: 5000, method: "PIX" }]);
    expect(entriesOf(o2)).toEqual([{ amountCents: 5000, method: "PIX" }]);

    // caixa do dia: R$ 100 em DOIS lançamentos do cliente
    const rows = await cashRowsOf(page, ymd(), name);
    expect(rows.map((r) => r.cents)).toEqual([5000, 5000]);

    await expectDebtor(page, name, 3000);
    await expectPending(page, name, 1);

    await page.getByRole("button", { name: `Receber de ${name}` }).click();
    await expect(amountField(page)).toHaveValue("30,00");
    await receive(page, { method: "Dinheiro" });
    await expect(page.getByText(/Sem saldo devedor/)).toBeVisible();
    await expect(dialog(page)).toBeHidden();

    expect(paidOf(o2)).toBe(8000);
    await expectNoDebtor(page, name);
    expect((await cashRowsOf(page, ymd(), name)).map((r) => r.cents).sort()).toEqual([
      3000, 5000, 5000,
    ]);
  });
});

// ================================================================== recebimento: bordas

test.describe("recebimento: valores", () => {
  test("parcial simples; prévia mostra a distribuição; Total volta ao saldo", async ({ page }) => {
    await login(page);
    const name = `${token()} Parcial`;
    const { id } = seedCustomer(name);
    const o = seedOrder(id, { total: 9000 });
    await openReceive(page, name);

    await amountField(page).fill("25");
    const prev = dialog(page).getByTestId("receive-preview");
    await expect(prev).toContainText(`Atendimento #${o}`);
    await expect(prev).toContainText("recebe");
    await expect(prev).toContainText(brl(2500));
    await expect(prev).toContainText(`restam`);
    await expect(prev).toContainText(brl(6500));
    await expect(receiveBtn(page)).toHaveText(/Receber R\$\s*25,00/);

    await dialog(page).getByRole("button", { name: "Total", exact: true }).click();
    await expect(amountField(page)).toHaveValue("90,00");
    await expect(prev).toContainText("quita");
    await amountField(page).fill("25");
    await receive(page, { method: "Crédito" });
    await expect(dialog(page)).toBeHidden();

    expect(paidOf(o)).toBe(2500);
    expect(entriesOf(o)).toEqual([{ amountCents: 2500, method: "CREDIT_CARD" }]);
    await expectDebtor(page, name, 6500);
  });

  test("quitação exata (botão Total) tira o cliente da lista", async ({ page }) => {
    await login(page);
    const name = `${token()} Exata`;
    const { id } = seedCustomer(name);
    const o = seedOrder(id, { total: 4990 });
    await openReceive(page, name);
    await expect(dialog(page).getByRole("button", { name: "Total", exact: true })).toBeDisabled(); // já é o total
    await receive(page, { method: "Débito" });
    await expect(dialog(page)).toBeHidden();
    expect(paidOf(o)).toBe(4990);
    expect(entriesOf(o)).toEqual([{ amountCents: 4990, method: "DEBIT_CARD" }]);
    await expectNoDebtor(page, name);
  });

  test("valor acima do saldo é rejeitado na UI (sem gravar); centavo a mais também", async ({
    page,
  }) => {
    await login(page);
    const name = `${token()} Acima`;
    const { id } = seedCustomer(name);
    const o = seedOrder(id, { total: 5000 });
    await openReceive(page, name);
    await methodBtn(page, "Pix").click();
    await amountField(page).fill("50,01");
    await expect(dialog(page)).toContainText("O valor é maior que o saldo devedor (R$ 50,00)");
    await expect(receiveBtn(page)).toBeDisabled();
    await amountField(page).fill("500");
    await expect(receiveBtn(page)).toBeDisabled();
    expect(countEntries(o)).toBe(0);
    expect(paidOf(o)).toBe(0);
  });

  test("valor 0, vazio e inválido bloqueiam o botão", async ({ page }) => {
    await login(page);
    const name = `${token()} Invalido`;
    const { id } = seedCustomer(name);
    const o = seedOrder(id, { total: 5000 });
    await openReceive(page, name);
    await methodBtn(page, "Pix").click();

    await amountField(page).fill("0");
    await expect(dialog(page)).toContainText("Informe um valor maior que zero");
    await expect(receiveBtn(page)).toBeDisabled();
    await amountField(page).fill("");
    await expect(dialog(page)).toContainText("Informe o valor");
    await expect(receiveBtn(page)).toBeDisabled();
    for (const bad of ["abc", "-5", "1,2,3"]) {
      await amountField(page).fill(bad);
      await expect(receiveBtn(page)).toBeDisabled();
    }
    expect(countEntries(o)).toBe(0);
  });

  test("sem forma de pagamento escolhida não confirma; Fiado não existe como forma", async ({
    page,
  }) => {
    await login(page);
    const name = `${token()} Forma`;
    const { id } = seedCustomer(name);
    seedOrder(id, { total: 5000 });
    await openReceive(page, name);
    const group = dialog(page).getByRole("group", { name: "Forma de pagamento" });
    await expect(group.getByRole("button")).toHaveText(["Dinheiro", "Pix", "Débito", "Crédito"]);
    for (const b of await group.getByRole("button").all()) {
      await expect(b).toHaveAttribute("aria-pressed", "false"); // sem pré-seleção
    }
    await expect(dialog(page).getByRole("button", { name: /fiado/i })).toHaveCount(0);
    await expect(receiveBtn(page)).toBeDisabled();
    await methodBtn(page, "Pix").click();
    await expect(receiveBtn(page)).toBeEnabled();
  });

  test("valor com centavos e arredondamento (R$ 33,33 de 100,00) fica exato em centavos", async ({
    page,
  }) => {
    await login(page);
    const name = `${token()} Centavos`;
    const { id } = seedCustomer(name);
    const o = seedOrder(id, { total: 10000 });
    await openReceive(page, name);
    await receive(page, { amount: "33,33", method: "Dinheiro" });
    await expect(dialog(page)).toBeHidden();
    expect(paidOf(o)).toBe(3333);
    await expectDebtor(page, name, 6667);
  });
});

test.describe("recebimento: data", () => {
  test("data retroativa entra no caixa do dia escolhido, não no de hoje", async ({ page }) => {
    await login(page);
    const name = `${token()} Retro`;
    const { id } = seedCustomer(name);
    const o = seedOrder(id, { total: 7000, daysAgo: 6 });
    const day = ymd(3);
    await openReceive(page, name);
    await receive(page, { amount: "70", method: "Pix", date: day });
    await expect(dialog(page)).toBeHidden();
    expect(entriesOf(o)).toHaveLength(1);

    const past = await cashRowsOf(page, day, name);
    expect(past.map((r) => r.cents)).toEqual([7000]);
    expect(await cashRowsOf(page, ymd(), name)).toEqual([]);
  });

  test("data futura não é aceita", async ({ page }) => {
    await login(page);
    const name = `${token()} Futuro`;
    const { id } = seedCustomer(name);
    const o = seedOrder(id, { total: 7000 });
    await openReceive(page, name);
    await methodBtn(page, "Pix").click();
    await dialog(page).getByLabel("Data do recebimento").fill(ymd(-2));
    await expect(dialog(page)).toContainText("não pode ser futura");
    await expect(receiveBtn(page)).toBeDisabled();
    expect(countEntries(o)).toBe(0);
  });
});

test.describe("recebimento: concorrência e sessão", () => {
  test("estado velho: saldo caiu em outra aba; recebimento acima do saldo é rejeitado pelo servidor", async ({
    page,
    context,
  }) => {
    await login(page);
    const name = `${token()} Velho`;
    const { id } = seedCustomer(name);
    const o = seedOrder(id, { total: 10000 });
    await openReceive(page, name); // saldo 100,00 carregado

    const other = await context.newPage();
    await openReceive(other, name);
    await receive(other, { amount: "80", method: "Pix" });
    await expect(dialog(other)).toBeHidden();
    expect(paidOf(o)).toBe(8000);
    await other.close();

    // a aba velha ainda acredita em R$ 100,00
    await receive(page, { method: "Dinheiro" }); // 100,00
    await expect(dialog(page).getByRole("alert").last()).toBeVisible();
    await expect(dialog(page)).toContainText(/saldo|maior/i);
    expect(paidOf(o)).toBe(8000);
    expect(countEntries(o)).toBe(1);
  });

  test("duplo clique em Receber não gera lançamento duplicado", async ({ page }) => {
    await login(page);
    const name = `${token()} Duplo`;
    const { id } = seedCustomer(name);
    const o = seedOrder(id, { total: 6000 });
    await openReceive(page, name);
    await amountField(page).fill("20");
    await methodBtn(page, "Pix").click();
    await receiveBtn(page).dblclick();
    await expect(dialog(page)).toBeHidden();
    await page.waitForTimeout(500);
    expect(countEntries(o)).toBe(1);
    expect(paidOf(o)).toBe(2000);
  });

  test("sessão expirada no diálogo leva ao /login sem erro do Next", async ({ page, context }) => {
    await login(page);
    const name = `${token()} Sessao`;
    const { id } = seedCustomer(name);
    const o = seedOrder(id, { total: 6000 });
    await openReceive(page, name);
    await context.clearCookies();
    await receive(page, { amount: "20", method: "Pix" });
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(/Application error|Unhandled/i)).toHaveCount(0);
    expect(countEntries(o)).toBe(0);
  });

  test("sem sessão, /fiado e /fiado?receber=1 redirecionam para /login", async ({ page }) => {
    for (const r of ["/fiado", "/fiado?receber=1", "/fiado?q=x&ordem=balance"]) {
      await page.goto(r);
      await expect(page).toHaveURL(/\/login$/);
    }
  });

  test("?receber= inexistente, inválido ou sem dívida não quebra a página", async ({ page }) => {
    await login(page);
    const { id: semDivida } = seedCustomer(`${token()} Quitado`);
    seedOrder(semDivida, { total: 3000, paid: 3000 });
    for (const v of ["999999", "abc", "-1", "0", "1.5", "", "9".repeat(30), String(semDivida)]) {
      const res = await page.goto(`/fiado?receber=${encodeURIComponent(v)}`);
      expect(res?.status(), v).toBeLessThan(500);
      await expect(page.getByRole("heading", { level: 1, name: "Fiado" })).toBeVisible();
      await expect(dialog(page)).toHaveCount(0);
      await expect(page.getByText(/Application error|Unhandled|Prisma/i)).toHaveCount(0);
    }
  });
});

// ================================================================== o que entra no fiado

test.describe("o que entra em /fiado (critérios 1, 6, 7)", () => {
  test("OS cancelada, em andamento e quitada NÃO entram; só a concluída pendente", async ({
    page,
  }) => {
    await login(page);
    const tk = token();
    const aberto = seedCustomer(`${tk} Aberto`);
    seedOrder(aberto.id, { total: 5000, status: "OPEN" });
    const canc = seedCustomer(`${tk} Cancelado`);
    seedOrder(canc.id, { total: 5000, status: "CANCELED" });
    const quit = seedCustomer(`${tk} Quitado`);
    seedOrder(quit.id, { total: 5000, paid: 5000 });
    const misto = seedCustomer(`${tk} Misto`);
    seedOrder(misto.id, { total: 5000, paid: 2000 });

    await gotoFiado(page, tk);
    await expect(debtorRows(page)).toHaveCount(1);
    await expect(debtorRow(page, `${tk} Misto`)).toContainText(looseBrl(3000));
    await expect(page.getByTestId("fiado-total-filtrado")).toContainText(looseBrl(3000));
  });

  test("saldo = soma de (total - pago) de várias OS; OS quitada do mesmo cliente não conta", async ({
    page,
  }) => {
    await login(page);
    const name = `${token()} Soma`;
    const { id } = seedCustomer(name);
    seedOrder(id, { total: 5000, paid: 5000, daysAgo: 5 });
    seedOrder(id, { total: 8000, paid: 1000, daysAgo: 3 });
    seedOrder(id, { total: 1234, daysAgo: 1 });
    seedOrder(id, { total: 9999, status: "OPEN" });
    await expectDebtor(page, name, 7000 + 1234);
    await expectPending(page, name, 2);
  });

  test("pendente não soma no caixa (dia isolado) e não aparece em /caixa", async ({
    page,
  }, testInfo) => {
    await login(page);
    const year = testInfo.project.name === "mobile" ? 2006 : 2005;
    const name = `${token()} Pendente`;
    const { id } = seedCustomer(name);
    const now = iso(new Date());
    dbRun(
      `insert into ServiceOrder (customerId, status, occurredAt, completedAt, discountCents, totalCents, paidCents, createdAt, updatedAt)
       values (?, 'DONE', ?, ?, 0, 12000, 0, ?, ?)`,
      id,
      `${year}-03-10T15:00:00.000Z`,
      `${year}-03-10T15:00:00.000Z`,
      now,
      now,
    );
    await page.goto(`/caixa?data=${year}-03-10`);
    await expect(page.getByTestId("cash-total")).toHaveText(brl(0));
    await expect(page.getByText(name)).toHaveCount(0);
    await page.goto(`/caixa`);
    await expect(page.getByText(name)).toHaveCount(0);
  });

  test("concluído como misto (R$ 80 com R$ 30 Pix) aparece com saldo R$ 50 e o pago não é contado de novo", async ({
    page,
  }) => {
    await login(page);
    const tk = token();
    const s = `${tk} Lavagem`;
    await createService(page, { name: s, car: "80" });
    const cliente = `${tk} Cliente`;
    const orderId = await createOrderQuick(page, { name: cliente, services: [s] });
    await openComplete(page);
    await methodBtn(page, "Pix").click();
    await dialog(page)
      .getByLabel(/^Valor em Pix/)
      .fill("30");
    await confirmPayment(page, "Concluir e receber");
    await expect(badge(page)).toHaveText("Parcial");

    await expectDebtor(page, cliente, 5000);
    expect(paidOf(orderId)).toBe(3000);
    expect(countEntries(orderId)).toBe(1);

    // caixa de hoje: só os R$ 30 da conclusão, uma vez
    expect((await cashRowsOf(page, ymd(), cliente)).map((r) => r.cents)).toEqual([3000]);

    // receber os R$ 50 restantes: caixa passa a ter 30 + 50, saldo zera
    await openReceive(page, cliente);
    await expect(dialog(page)).toContainText(brl(5000));
    await receive(page, { method: "Dinheiro" });
    await expect(dialog(page)).toBeHidden();
    expect((await cashRowsOf(page, ymd(), cliente)).map((r) => r.cents).sort()).toEqual([
      3000, 5000,
    ]);
    await expectNoDebtor(page, cliente);
  });

  test("concluído como Fiado (pela UI) aparece em /fiado com o total e não entra no caixa", async ({
    page,
  }) => {
    await login(page);
    const tk = token();
    const s = `${tk} Polimento`;
    await createService(page, { name: s, car: "50" });
    const cliente = `${tk} Cliente`;
    const orderId = await createOrderQuick(page, { name: cliente, services: [s] });
    await completeFiado(page);
    expect(countEntries(orderId)).toBe(0);
    await expectDebtor(page, cliente, 5000);
    expect(await cashRowsOf(page, ymd(), cliente)).toEqual([]);
  });

  test("estorno de pagamento parcial: saldo volta, sai do caixa, cliente reaparece em /fiado", async ({
    page,
  }) => {
    await login(page);
    const name = `${token()} Estorno`;
    const { id } = seedCustomer(name);
    const o = seedOrder(id, { total: 5000 });
    await openReceive(page, name);
    await receive(page, { amount: "50", method: "Pix" });
    await expect(dialog(page)).toBeHidden();
    await expectNoDebtor(page, name);
    expect((await cashRowsOf(page, ymd(), name)).map((r) => r.cents)).toEqual([5000]);

    await page.goto(`/atendimentos/${o}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Estornar pagamento de R$ 50,00 em Pix" }).click();
    await dialog(page).getByRole("button", { name: "Estornar", exact: true }).click();
    await expect(dialog(page)).toBeHidden();

    expect(paidOf(o)).toBe(0);
    expect(countEntries(o)).toBe(0);
    expect(await cashRowsOf(page, ymd(), name)).toEqual([]);
    await expectDebtor(page, name, 5000);
  });

  test("cliente inativo com dívida aparece (com selo) e pode pagar", async ({ page }) => {
    await login(page);
    const name = `${token()} Inativo`;
    const { id } = seedCustomer(name, { active: false });
    const o = seedOrder(id, { total: 4000 });
    await expectDebtor(page, name, 4000);
    await expect(debtorRow(page, name)).toContainText(/inativo/i);
    await openReceive(page, name);
    await receive(page, { method: "Pix" });
    await expect(dialog(page)).toBeHidden();
    expect(paidOf(o)).toBe(4000);
    await expectNoDebtor(page, name);
  });
});

// ================================================================== distribuição

test.describe("distribuição (critério 4)", () => {
  test("pela DATA do atendimento, não pelo id: OS de id maior porém mais antiga é paga primeiro", async ({
    page,
  }) => {
    await login(page);
    const name = `${token()} Ordem`;
    const { id } = seedCustomer(name);
    const nova = seedOrder(id, { total: 6000, daysAgo: 1 }); // id menor, data mais nova
    const antiga = seedOrder(id, { total: 4000, daysAgo: 20 }); // id maior, data mais antiga
    expect(antiga).toBeGreaterThan(nova);

    await openReceive(page, name);
    await amountField(page).fill("70");
    const prev = dialog(page).getByTestId("receive-preview");
    const lines = prev.locator("li");
    await expect(lines).toHaveCount(2);
    await expect(lines.nth(0)).toContainText(`#${antiga}`);
    await expect(lines.nth(0)).toContainText("quita");
    await expect(lines.nth(1)).toContainText(`#${nova}`);
    await expect(lines.nth(1)).toContainText("restam");
    await receive(page, { method: "Pix" });
    await expect(dialog(page)).toBeHidden();

    expect(paidOf(antiga)).toBe(4000);
    expect(paidOf(nova)).toBe(3000);
  });

  test("mesma data: desempate por id (a de menor id primeiro)", async ({ page }) => {
    await login(page);
    const name = `${token()} Empate`;
    const { id } = seedCustomer(name);
    const at = iso(new Date(Date.now() - 3 * DAY));
    const a = seedOrder(id, { total: 3000, at });
    const b = seedOrder(id, { total: 3000, at });
    await openReceive(page, name);
    await receive(page, { amount: "40", method: "Pix" });
    await expect(dialog(page)).toBeHidden();
    expect(paidOf(a)).toBe(3000);
    expect(paidOf(b)).toBe(1000);
  });
});

// ================================================================== lista: busca e ordenação

test.describe("/fiado: busca, ordenação e totais", () => {
  test("busca por nome (com/sem acento), telefone parcial e placa; total geral não muda com a busca", async ({
    page,
  }) => {
    await login(page);
    const tk = token();
    const phone = `3197${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
    const plate = `${tk.slice(2, 5).toUpperCase()}${Math.floor(1000 + Math.random() * 9000)}`;
    const joao = `${tk} João`;
    const a = seedCustomer(joao, {
      phone,
      plate,
      searchName: `${tk.toLowerCase()} joao`,
    });
    seedOrder(a.id, { total: 5000 }, a.vehicleId);
    const b = seedCustomer(`${tk} Maria`);
    seedOrder(b.id, { total: 7000 });

    for (const q of [tk, `${tk} joao`, `${tk} João`, tk.toUpperCase()]) {
      await gotoFiado(page, q);
      await expect(debtorRow(page, tk)).not.toHaveCount(0);
    }
    await gotoFiado(page, `${tk} joao`);
    await expect(debtorRows(page)).toHaveCount(1);
    await expect(debtorRows(page)).toContainText("João");

    await gotoFiado(page, phone.slice(2, 9)); // parcial
    await expect(debtorRow(page, joao)).toHaveCount(1);
    await gotoFiado(page, plate);
    await expect(debtorRow(page, joao)).toHaveCount(1);
    await gotoFiado(page, plate.toLowerCase());
    await expect(debtorRow(page, joao)).toHaveCount(1);

    // totais: filtrado = soma dos listados; geral inclui todos (>= filtrado) e aparece sem busca
    await gotoFiado(page, tk);
    await expect(page.getByTestId("fiado-total-filtrado")).toContainText(brl(12000));
    const grand = centsIn(await page.getByTestId("fiado-total").innerText())[0];
    expect(grand).toBeGreaterThanOrEqual(12000);
    await gotoFiado(page, `${tk} joao`);
    await expect(page.getByTestId("fiado-total-filtrado")).toContainText(brl(5000));
    const grand2 = centsIn(await page.getByTestId("fiado-total").innerText())[0];
    expect(grand2).toBeGreaterThanOrEqual(12000); // não encolhe para o filtrado
    await gotoFiado(page);
    await expect(page.getByTestId("fiado-total-filtrado")).toHaveCount(0);
    expect(centsIn(await page.getByTestId("fiado-total").innerText())[0]).toBeGreaterThanOrEqual(
      12000,
    );

    await gotoFiado(page, `${tk}zzzz`);
    await expect(page.getByText(`Nenhum devedor para “${tk}zzzz”`)).toBeVisible();
  });

  test("ordenação: mais antigo (padrão) e maior saldo", async ({ page }) => {
    await login(page);
    const tk = token();
    const antigo = `${tk} Antigo`;
    const grande = `${tk} Grande`;
    const a = seedCustomer(antigo);
    seedOrder(a.id, { total: 3000, daysAgo: 30 });
    const g = seedCustomer(grande);
    seedOrder(g.id, { total: 90000, daysAgo: 1 });

    await gotoFiado(page, tk);
    const order = async () => debtorRows(page).allInnerTexts();
    let t = await order();
    expect(t[0]).toContain("Antigo");
    expect(t[1]).toContain("Grande");
    const nav = page.getByRole("navigation", { name: "Ordenar por" });
    await expect(nav.getByRole("link", { name: "Mais antigo" })).toHaveAttribute(
      "aria-current",
      "true",
    );

    await nav.getByRole("link", { name: "Maior saldo" }).click();
    await expect(page).toHaveURL(/ordem=balance/);
    await expect(nav.getByRole("link", { name: "Maior saldo" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect.poll(async () => (await order())[0]).toContain("Grande");
    t = await order();
    expect(t[1]).toContain("Antigo");
    expect(page.url()).toContain(`q=${tk}`); // a busca é mantida
  });

  test("nome longo sem espaços não gera scroll horizontal", async ({ page }) => {
    await login(page);
    const tk = token();
    const name = `${tk}${"Abcdefghij".repeat(8)}`;
    const { id } = seedCustomer(name);
    seedOrder(id, { total: 123456 });
    await gotoFiado(page, tk);
    await expect(debtorRows(page)).toHaveCount(1);
    expect(await noHScroll(page)).toBe(true);
    await page.getByRole("button", { name: `Receber de ${name}` }).click();
    await expect(dialog(page)).toBeVisible();
    expect(await noHScroll(page)).toBe(true);
  });
});

// ================================================================== outras telas

test.describe("detalhe do cliente, novo atendimento, início, menu", () => {
  test("card de saldo no detalhe: valores, pendências, receber por ali, some com saldo 0", async ({
    page,
  }) => {
    await login(page);
    const name = `${token()} Detalhe`;
    const { id } = seedCustomer(name);
    const o1 = seedOrder(id, { total: 5000, daysAgo: 4 });
    const o2 = seedOrder(id, { total: 8000, paid: 3000, daysAgo: 2 });
    seedOrder(id, { total: 2000, paid: 2000, daysAgo: 1 }); // quitada: fora da lista

    await page.goto(`/clientes/${id}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("customer-debt")).toBeVisible();
    await expect(page.getByTestId("customer-debt-total")).toHaveText(brl(10000));
    const list = page.getByRole("list", { name: "Atendimentos pendentes" });
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await expect(list).toContainText(`Atendimento #${o1}`);
    await expect(list).toContainText(`Atendimento #${o2}`);

    await page.getByRole("button", { name: `Receber de ${name}` }).click();
    await expect(dialog(page)).toContainText(brl(10000));
    await receive(page, { method: "Pix" });
    await expect(dialog(page)).toBeHidden();
    await expect(page.getByTestId("customer-debt")).toHaveCount(0);
    await expect(page.getByTestId("customer-debt-total")).toHaveCount(0);
  });

  test("cliente sem dívida: sem card de saldo", async ({ page }) => {
    await login(page);
    const name = `${token()} Limpo`;
    const { id } = seedCustomer(name);
    seedOrder(id, { total: 5000, paid: 5000 });
    await page.goto(`/clientes/${id}`);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByTestId("customer-debt")).toHaveCount(0);
  });

  test("novo atendimento: selo na busca, faixa 'Cliente deve' e NÃO bloqueia criar", async ({
    page,
  }) => {
    await login(page);
    const tk = token();
    const s = `${tk} Lavagem`;
    await createService(page, { name: s, car: "20" });
    const name = `${tk} Devedor`;
    const { id } = seedCustomer(name, { plate: `${tk.slice(2, 5).toUpperCase()}1234` });
    // veículo: seedCustomer só cria com plate; já tem 1 veículo ativo
    seedOrder(id, { total: 5000, paid: 1000 });

    await page.goto(`/atendimentos/novo?q=${encodeURIComponent(name)}`);
    await expect(page.getByTestId("debt-badge")).toHaveText(/Deve\s*R\$\s*40,00/);

    await page.goto(`/atendimentos/novo?cliente=${id}`);
    await page.waitForLoadState("networkidle");
    const banner = page.getByTestId("customer-debt-banner");
    await expect(banner).toContainText("Cliente deve");
    await expect(banner).toContainText(brl(4000));
    await expect(banner.getByRole("link", { name: "Receber" })).toHaveAttribute(
      "href",
      `/fiado?receber=${id}`,
    );
    await expect(banner.getByRole("link", { name: "Ver fiado" })).toHaveAttribute(
      "href",
      `/clientes/${id}`,
    );

    await pickServices(page, [s]);
    await page.getByRole("button", { name: "Criar atendimento", exact: true }).click();
    await expect(page).toHaveURL(/\/atendimentos\/\d+$/);
    expect(dbNum("select count(*) from ServiceOrder where customerId = ?", id)).toBe(2);

    // sem dívida: sem faixa nem selo
    const limpo = seedCustomer(`${tk} Limpo`);
    await page.goto(`/atendimentos/novo?cliente=${limpo.id}`);
    await expect(page.getByTestId("customer-debt-banner")).toHaveCount(0);
  });

  test("Início mostra 'Fiado em aberto' e o link leva a /fiado", async ({ page }) => {
    await login(page);
    const { id } = seedCustomer(`${token()} Home`);
    seedOrder(id, { total: 4321 });
    await page.goto("/");
    await expect(page.getByTestId("home-fiado")).toBeVisible();
    expect(centsIn(await page.getByTestId("home-fiado").innerText())[0]).toBeGreaterThanOrEqual(
      4321,
    );
    await page.getByTestId("home-fiado").getByRole("link").click();
    await expect(page).toHaveURL(/\/fiado$/);
  });

  test("menu: Fiado alcançável (desktop direto; celular via Mais)", async ({ page }, testInfo) => {
    await login(page);
    const nav = page.getByRole("navigation", { name: "Navegação principal" });
    if (testInfo.project.name === "mobile") {
      await expect(nav.getByRole("link", { name: "Fiado" })).toHaveCount(0);
      await nav.getByRole("button", { name: "Mais" }).click();
      await dialog(page).getByRole("link", { name: "Fiado" }).click();
    } else {
      await nav.getByRole("link", { name: "Fiado" }).click();
    }
    await expect(page).toHaveURL(/\/fiado$/);
    await expect(page.getByRole("heading", { level: 1, name: "Fiado" })).toBeVisible();
    if (testInfo.project.name === "desktop") {
      await expect(nav.getByRole("link", { name: "Fiado" })).toHaveAttribute(
        "aria-current",
        "page",
      );
    }
  });

  test("/fiado sem devedor próprio: busca vazia mostra estado vazio amigável", async ({ page }) => {
    await login(page);
    await gotoFiado(page, `${token()}nada`);
    await expect(page.getByRole("status").filter({ hasText: "Nenhum devedor para" })).toBeVisible();
  });
});
