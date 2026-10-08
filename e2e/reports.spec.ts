import type { Locator, Page, TestInfo } from "@playwright/test";
import {
  brl,
  centsIn,
  dbRun,
  dialog,
  expect,
  login,
  methodBtn,
  noHScroll,
  readCents,
  test,
  token,
} from "./orders-helpers";

// Entrega 10: relatórios. O banco é compartilhado entre testes/projetos em paralelo: cada teste (e cada
// projeto) usa um ANO próprio (2010..2040) e semeia tudo por SQL com occurredAt controlado; os números
// são conferidos num período personalizado desse ano, onde só existem os dados do próprio teste.

const iso = (d: Date) => d.toISOString();
/** Instante em America/Sao_Paulo (UTC-3) -> ISO UTC. */
const at = (ymd: string, hm = "12:00") => iso(new Date(`${ymd}T${hm}:00.000-03:00`));

/** Ano exclusivo do teste (idx) e do projeto (mobile = +1). */
const year = (info: TestInfo, idx: number) =>
  2010 + idx * 2 + (info.project.name === "mobile" ? 1 : 0) - info.repeatEachIndex * 30;

const qs = (from: string, to: string) => `?periodo=personalizado&de=${from}&ate=${to}`;

// ---------------------------------------------------------------- seeds

function seedCustomer(name: string, vehicle?: "CAR" | "MOTORCYCLE") {
  const now = iso(new Date());
  const id = Number(
    dbRun(
      "insert into Customer (name, searchName, active, createdAt, updatedAt) values (?, ?, true, ?, ?)",
      name,
      name.toLowerCase(),
      now,
      now,
    ),
  );
  let vehicleId: number | null = null;
  if (vehicle) {
    vehicleId = Number(
      dbRun(
        `insert into Vehicle (customerId, type, active, createdAt, updatedAt) values (?, '${vehicle}', true, ?, ?)`,
        id,
        now,
        now,
      ),
    );
  }
  return { id, vehicleId };
}

function seedService(name: string): number {
  const now = iso(new Date());
  return Number(
    dbRun(
      "insert into Service (name, searchName, carPriceCents, active, createdAt, updatedAt) values (?, ?, 5000, true, ?, ?)",
      name,
      name.toLowerCase(),
      now,
      now,
    ),
  );
}

function seedProduct(name: string): number {
  const now = iso(new Date());
  return Number(
    dbRun(
      "insert into Product (name, searchName, unit, salePriceCents, stockQuantity, active, createdAt, updatedAt) values (?, ?, 'un', 1000, 0, true, ?, ?)",
      name,
      name.toLowerCase(),
      now,
      now,
    ),
  );
}

type Item = { service?: number; product?: number; qty?: number; unit: number };

function seedOrder(o: {
  customer: { id: number; vehicleId: number | null };
  status?: "DONE" | "OPEN" | "CANCELED";
  at: string;
  items: Item[];
  discount?: number;
  /** pagamentos (CashEntry IN com serviceOrderId) */
  payments?: { cents: number; at: string }[];
}): number {
  const now = iso(new Date());
  const status = o.status ?? "DONE";
  const gross = o.items.reduce((s, i) => s + (i.qty ?? 1) * i.unit, 0);
  const total = gross - (o.discount ?? 0);
  const paid = (o.payments ?? []).reduce((s, p) => s + p.cents, 0);
  const id = Number(
    dbRun(
      `insert into ServiceOrder (customerId, vehicleId, status, occurredAt, completedAt, discountCents, totalCents, paidCents, createdAt, updatedAt)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      o.customer.id,
      o.customer.vehicleId,
      status,
      o.at,
      status === "DONE" ? o.at : null,
      o.discount ?? 0,
      total,
      paid,
      now,
      now,
    ),
  );
  for (const it of o.items) {
    const qty = it.qty ?? 1;
    dbRun(
      `insert into ServiceOrderItem (orderId, kind, serviceId, productId, description, quantity, unitPriceCents, totalCents)
       values (?, ?, ?, ?, 'Descricao antiga do item', ?, ?, ?)`,
      id,
      it.product ? "PRODUCT" : "SERVICE",
      it.service ?? null,
      it.product ?? null,
      qty,
      it.unit,
      qty * it.unit,
    );
  }
  for (const p of o.payments ?? []) addPayment(id, p.cents, p.at);
  return id;
}

function addPayment(orderId: number, cents: number, when: string) {
  const now = iso(new Date());
  dbRun(
    `insert into CashEntry (direction, amountCents, method, serviceOrderId, occurredAt, createdAt, updatedAt)
     values ('IN', ?, 'PIX', ?, ?, ?, ?)`,
    cents,
    orderId,
    when,
    now,
    now,
  );
}

// ---------------------------------------------------------------- leitura da tela

async function gotoReport(page: Page, query = "") {
  await page.goto(`/relatorios${query}`);
  await expect(page.getByRole("heading", { level: 1, name: "Relatórios" })).toBeVisible();
  await page.waitForLoadState("networkidle"); // hidratação (dev)
}

const card = (page: Page, id: string) => readCents(page.getByTestId(id));
const cellsOf = async (row: Locator) => (await row.locator("td").allInnerTexts()).map((t) => t.trim());

type Scenario = ReturnType<typeof seedScenario>;

/**
 * Cenário do roadmap no mês y-05: 3 OS (R$100 pago Pix; R$80 fiado; R$50 misto com R$20 pago), 1 OS
 * cancelada, 1 aberta e 1 recebimento de R$40 (dia y-05-20) de fiado de abril.
 */
function seedScenario(y: number, tk: string) {
  const lav = seedService(`${tk} Lavagem`);
  const pol = seedService(`${tk} Polimento`);
  const cera = seedProduct(`${tk} Cera`);
  const ana = { name: `${tk} Ana`, ...seedCustomer(`${tk} Ana`, "CAR") };
  const bia = { name: `${tk} Bia`, ...seedCustomer(`${tk} Bia`, "MOTORCYCLE") };
  const caio = { name: `${tk} Caio`, ...seedCustomer(`${tk} Caio`, "CAR") };
  const dani = { name: `${tk} Dani`, ...seedCustomer(`${tk} Dani`, "CAR") };
  const eva = { name: `${tk} Eva`, ...seedCustomer(`${tk} Eva`, "CAR") };

  // R$110 bruto − R$10 de desconto = R$100, pago em Pix
  const o1 = seedOrder({
    customer: ana,
    at: at(`${y}-05-10`),
    items: [{ service: lav, unit: 11000 }],
    discount: 1000,
    payments: [{ cents: 10000, at: at(`${y}-05-10`) }],
  });
  // R$80 no fiado (moto): Lavagem 30 + Polimento 50
  const o2 = seedOrder({
    customer: bia,
    at: at(`${y}-05-11`),
    items: [
      { service: lav, unit: 3000 },
      { service: pol, unit: 5000 },
    ],
  });
  // R$50 misto (R$20 pago): Lavagem 40 + Cera 10
  const o3 = seedOrder({
    customer: ana,
    at: at(`${y}-05-15`),
    items: [{ service: lav, unit: 4000 }, { product: cera, unit: 1000 }],
    payments: [{ cents: 2000, at: at(`${y}-05-15`) }],
  });
  // fiado de abril (R$40) quitado "hoje" (no dia y-05-20)
  const prior = seedOrder({
    customer: caio,
    at: at(`${y}-04-10`),
    items: [{ service: lav, unit: 4000 }],
    payments: [{ cents: 4000, at: at(`${y}-05-20`) }],
  });
  // cancelada e aberta: não podem aparecer em nada
  seedOrder({
    customer: dani,
    status: "CANCELED",
    at: at(`${y}-05-12`),
    items: [{ service: pol, unit: 7000 }],
  });
  seedOrder({
    customer: eva,
    status: "OPEN",
    at: at(`${y}-05-13`),
    items: [{ service: lav, unit: 6000 }],
  });
  return { lav, pol, cera, ana, bia, caio, dani, eva, o1, o2, o3, prior };
}

// ================================================================= cenário do roadmap

test("cenário do roadmap: cards, tabela por dia, rankings, clientes e exclusões", async ({
  page,
}, info) => {
  const y = year(info, 0);
  const tk = token();
  await login(page);
  const s: Scenario = seedScenario(y, tk);

  await gotoReport(page, qs(`${y}-05-01`, `${y}-05-31`));

  // cards (centavos exatos)
  expect(await card(page, "report-sold")).toBe(23000);
  expect(await card(page, "report-received")).toBe(16000);
  expect(await card(page, "report-received-prior")).toBe(4000);
  expect(await card(page, "report-pending")).toBe(11000);
  await expect(page.getByTestId("report-orders")).toHaveText("3");
  await expect(page.getByTestId("report-ticket")).toContainText(brl(7667));
  await expect(page.getByTestId("report-received-prior")).toContainText("fiado de atendimentos anteriores");
  // rótulos de ajuda existem (confusão vendido x recebido)
  await expect(page.getByTestId("report-sold").locator("xpath=..")).toContainText(
    "mesmo os que ficaram no fiado",
  );

  // tabela por dia (31 dias => por dia): 10, 11, 15 e 20 de maio
  expect(await page.getByTestId("report-by-period").getByRole("columnheader", { name: "Data" }).count()).toBe(1);
  const rows = page.getByTestId("report-row");
  await expect(rows).toHaveCount(4);
  const byDay = await Promise.all([0, 1, 2, 3].map((i) => cellsOf(rows.nth(i))));
  const pick = (c: string[]) => [c[0], c[1], centsIn(c[2])[0], centsIn(c[3])[0]];
  expect(byDay.map(pick)).toEqual([
    [`10/05/${y}`, "1", 10000, 10000],
    [`11/05/${y}`, "1", 8000, 0],
    [`15/05/${y}`, "1", 5000, 2000],
    [`20/05/${y}`, "0", 0, 4000],
  ]);

  // serviços: Lavagem (3 OS: 2 carro, 1 moto; bruto 110+30+40) e Polimento (só a OS de moto; a cancelada fora)
  const services = page.getByTestId("report-services").locator("tbody tr");
  await expect(services).toHaveCount(2);
  const lavRow = await cellsOf(services.nth(0));
  expect(lavRow[0]).toBe(`${tk} Lavagem`); // nome ATUAL do catálogo, não a descrição antiga do item
  expect(lavRow.slice(1, 5)).toEqual(["3", "3", "2", "1"]); // qtd, atend., carro, moto
  expect(centsIn(lavRow[5])).toEqual([18000]);
  const polRow = await cellsOf(services.nth(1));
  expect(polRow[0]).toBe(`${tk} Polimento`);
  expect(polRow.slice(1, 5)).toEqual(["1", "1", "0", "1"]);
  expect(centsIn(polRow[5])).toEqual([5000]);
  await expect(page.getByTestId("report-services")).not.toContainText("Descricao antiga");

  // produtos
  const products = page.getByTestId("report-products").locator("tbody tr");
  await expect(products).toHaveCount(1);
  const ceraRow = await cellsOf(products.nth(0));
  expect(ceraRow[0]).toBe(`${tk} Cera`);
  expect(ceraRow.slice(1, 3)).toEqual(["1", "1"]);
  expect(centsIn(ceraRow[3])).toEqual([1000]);

  // desconto não é rateado; o rodapé informa o total (R$ 10)
  await expect(page.getByTestId("report-discount-note")).toContainText("Total de descontos no período");
  await expect(page.getByTestId("report-discount-note")).toContainText(brl(1000));

  // clientes: Ana (2 visitas, R$ 150, deve R$ 30) e Bia (1 visita, R$ 80, deve R$ 80)
  const cust = page.getByTestId("report-customers").locator("tbody tr");
  await expect(cust).toHaveCount(2);
  const ana = await cellsOf(cust.nth(0));
  expect(ana[0]).toContain(`${tk} Ana`);
  expect(ana[1]).toBe("2");
  expect(centsIn(ana[2])).toEqual([15000]);
  expect(ana[3]).toContain(`15/05/${y}`);
  expect(centsIn(ana[4])).toEqual([3000]);
  const bia = await cellsOf(cust.nth(1));
  expect(bia[0]).toContain(`${tk} Bia`);
  expect(bia[1]).toBe("1");
  expect(centsIn(bia[2])).toEqual([8000]);
  expect(centsIn(bia[4])).toEqual([8000]);
  await expect(cust.nth(0).getByRole("link", { name: `${tk} Ana` })).toHaveAttribute(
    "href",
    `/clientes/${s.ana.id}`,
  );

  // OS cancelada e aberta (e o cliente só com fiado antigo) não aparecem em lugar nenhum
  for (const n of [s.dani.name, s.eva.name, s.caio.name]) {
    await expect(page.getByRole("main")).not.toContainText(n);
  }

  // período sem o mês: nada
  await gotoReport(page, qs(`${y}-06-01`, `${y}-06-30`));
  expect(await card(page, "report-sold")).toBe(0);
  await expect(page.getByTestId("report-ticket")).toHaveText("—");
  await expect(page.getByTestId("report-received-prior")).toHaveCount(0);
  await expect(page.getByText("Nenhum atendimento concluído neste período")).toBeVisible();
  await expect(page.getByText("Nenhum serviço vendido neste período")).toBeVisible();
  await expect(page.getByText("Nenhum produto vendido neste período")).toBeVisible();
  await expect(page.getByText("Nenhum cliente atendido neste período")).toBeVisible();

  // abril: a OS do fiado antigo é vendida em abril, já quitada (Ficou no fiado = 0)
  await gotoReport(page, qs(`${y}-04-01`, `${y}-04-30`));
  expect(await card(page, "report-sold")).toBe(4000);
  expect(await card(page, "report-pending")).toBe(0);
  expect(await card(page, "report-received")).toBe(0);
});

test("ordenar serviços por valor", async ({ page }, info) => {
  const y = year(info, 5);
  const tk = token();
  await login(page);
  seedScenario(y, tk);
  // Lavagem tem mais qtd e mais valor; cria um serviço caro de 1 un para inverter as posições
  const luxo = seedService(`${tk} Luxo`);
  const c = seedCustomer(`${tk} Zed`, "CAR");
  seedOrder({
    customer: c,
    at: at(`${y}-05-16`),
    items: [{ service: luxo, unit: 90000 }],
    payments: [{ cents: 90000, at: at(`${y}-05-16`) }],
  });
  await gotoReport(page, qs(`${y}-05-01`, `${y}-05-31`));
  const names = async () =>
    (await page.getByTestId("report-services").locator("tbody tr td:first-child").allInnerTexts()).map(
      (t) => t.trim(),
    );
  expect(await names()).toEqual([`${tk} Lavagem`, `${tk} Luxo`, `${tk} Polimento`]); // por quantidade (desempate: valor)
  await page.getByRole("link", { name: "Por valor" }).first().click();
  await expect(page).toHaveURL(/servicos=valor/);
  await expect.poll(names).toEqual([`${tk} Luxo`, `${tk} Lavagem`, `${tk} Polimento`]);
});

// ================================================================= critério 3: Recebido == caixa

test("Recebido do relatório = soma dos lançamentos 'Atendimento nº' do /caixa no mesmo período", async ({
  page,
}, info) => {
  const y = year(info, 1);
  const tk = token();
  await login(page);
  const s = seedScenario(y, tk);

  await gotoReport(page, qs(`${y}-05-01`, `${y}-05-31`));
  const received = await card(page, "report-received");
  expect(received).toBe(16000);

  await page.goto(`/caixa${qs(`${y}-05-01`, `${y}-05-31`)}`);
  await page.waitForLoadState("networkidle");
  const region = page.getByRole("region", { name: "Extrato" });
  const rows = region.locator("li:visible, tbody tr:visible").filter({ hasText: "Atendimento nº" });
  const n = await rows.count();
  expect(n).toBe(3); // R$ 100 + R$ 20 + R$ 40 (fiado de abril)
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const cs = centsIn(await rows.nth(i).innerText());
    sum += cs[cs.length - 1];
  }
  expect(sum).toBe(received);
  expect(s.o1).toBeGreaterThan(0);
});

// ================================================================= critério 4: receber fiado hoje

test("receber fiado hoje aumenta o Recebido de hoje e reduz Ficou no fiado do período da OS, sem mudar o Vendido", async ({
  page,
}, info) => {
  const y = year(info, 2);
  const tk = token();
  await login(page);
  const name = `${tk} Devedor`;
  const c = seedCustomer(name, "CAR");
  const svc = seedService(`${tk} Lavagem`);
  seedOrder({ customer: c, at: at(`${y}-05-11`), items: [{ service: svc, unit: 8000 }] });
  const period = qs(`${y}-05-01`, `${y}-05-31`);

  await gotoReport(page, period);
  expect(await card(page, "report-sold")).toBe(8000);
  expect(await card(page, "report-pending")).toBe(8000);
  expect(await card(page, "report-received")).toBe(0);

  await gotoReport(page); // hoje
  const todayBefore = await card(page, "report-received");

  // recebe R$ 30 pelo /fiado (lançamento com data de agora)
  await page.goto(`/fiado?q=${encodeURIComponent(name)}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: `Receber de ${name}` }).click();
  await expect(dialog(page).getByRole("heading", { name: "Receber do cliente" })).toBeVisible();
  await dialog(page).getByLabel("Valor a receber").fill("30");
  await methodBtn(page, "Pix").click();
  await dialog(page).getByRole("button", { name: /^Receber/ }).click();
  await expect(dialog(page)).toBeHidden();

  // hoje: Recebido subiu >= R$ 30 (outros testes em paralelo só podem somar) e há fiado anterior
  await expect(async () => {
    await gotoReport(page);
    expect(await card(page, "report-received")).toBeGreaterThanOrEqual(todayBefore + 3000);
    expect(await card(page, "report-received-prior")).toBeGreaterThanOrEqual(3000);
  }).toPass({ timeout: 20_000 });

  // mês da OS: Vendido igual; Ficou no fiado caiu para R$ 50; Recebido do mês não muda
  await gotoReport(page, period);
  expect(await card(page, "report-sold")).toBe(8000);
  expect(await card(page, "report-pending")).toBe(5000);
  expect(await card(page, "report-received")).toBe(0);
});

// ================================================================= critério 5: fuso

test("OS às 23h30 locais conta no dia local, não no dia UTC", async ({ page }, info) => {
  const y = year(info, 3);
  const tk = token();
  await login(page);
  const svc = seedService(`${tk} Lavagem`);
  const c = seedCustomer(`${tk} Noturno`, "CAR");
  // 23:30 de 30/06 (= 02:30Z de 01/07) e 00:30 de 01/07 (= 03:30Z)
  seedOrder({
    customer: c,
    at: at(`${y}-06-30`, "23:30"),
    items: [{ service: svc, unit: 1000 }],
    payments: [{ cents: 1000, at: at(`${y}-06-30`, "23:30") }],
  });
  seedOrder({
    customer: c,
    at: at(`${y}-07-01`, "00:30"),
    items: [{ service: svc, unit: 2000 }],
    payments: [{ cents: 2000, at: at(`${y}-07-01`, "00:30") }],
  });

  await gotoReport(page, qs(`${y}-06-30`, `${y}-06-30`));
  expect(await card(page, "report-sold")).toBe(1000);
  expect(await card(page, "report-received")).toBe(1000);
  await expect(page.getByTestId("report-orders")).toHaveText("1");
  await expect(page.getByTestId("report-row")).toHaveCount(1);
  await expect(page.getByTestId("report-row")).toContainText(`30/06/${y}`);

  await gotoReport(page, qs(`${y}-07-01`, `${y}-07-01`));
  expect(await card(page, "report-sold")).toBe(2000);
  await expect(page.getByTestId("report-row")).toContainText(`01/07/${y}`);

  // mês de junho inteiro: só a das 23:30; julho: só a das 00:30
  await gotoReport(page, qs(`${y}-06-01`, `${y}-06-30`));
  expect(await card(page, "report-sold")).toBe(1000);
  await gotoReport(page, qs(`${y}-07-01`, `${y}-07-31`));
  expect(await card(page, "report-sold")).toBe(2000);
});

// ================================================================= períodos longos

test("período de 1 ano agrupa por mês; acima de 366 dias é encurtado com aviso", async ({
  page,
}, info) => {
  const y = year(info, 4);
  const tk = token();
  await login(page);
  const svc = seedService(`${tk} Lavagem`);
  const c = seedCustomer(`${tk} Anual`, "CAR");
  for (const [m, cents] of [
    ["02", 1000],
    ["02", 500],
    ["09", 2500],
  ] as const) {
    seedOrder({
      customer: c,
      at: at(`${y}-${m}-10`),
      items: [{ service: svc, unit: cents }],
      payments: [{ cents, at: at(`${y}-${m}-10`) }],
    });
  }
  await gotoReport(page, qs(`${y}-01-01`, `${y}-12-31`));
  await expect(page.getByRole("heading", { level: 2, name: "Por mês" })).toBeVisible();
  const rows = page.getByTestId("report-row");
  await expect(rows).toHaveCount(2);
  const cells = await Promise.all([0, 1].map((i) => cellsOf(rows.nth(i))));
  expect(cells.map((c) => [c[0], c[1], centsIn(c[2])[0], centsIn(c[3])[0]])).toEqual([
    [`02/${y}`, "2", 1500, 1500],
    [`09/${y}`, "1", 2500, 2500],
  ]);
  await expect(page.getByTestId("report-truncated")).toHaveCount(0);

  // 3 anos: encurtado para os últimos 366 dias
  await gotoReport(page, qs(`${y - 2}-01-01`, `${y}-12-31`));
  await expect(page.getByTestId("report-truncated")).toBeVisible();
  await expect(page.getByTestId("report-truncated")).toContainText("366 dias");
  await expect(page.getByTestId("report-truncated")).toContainText(`31/12/${y}`);
});

// ================================================================= menu e layout

test("menu mostra Relatórios (desktop: lateral; celular: dentro de Mais)", async ({ page }) => {
  await login(page);
  const mobile = (page.viewportSize()?.width ?? 1280) < 768;
  const nav = page.getByRole("navigation", { name: "Navegação principal" });
  if (mobile) {
    await expect(nav.getByRole("link", { name: "Relatórios" })).toBeHidden(); // fora da barra inferior
    await nav.getByRole("button", { name: "Mais" }).click();
    const link = dialog(page).getByRole("link", { name: "Relatórios" });
    await expect(link).toBeVisible();
    await link.click();
  } else {
    await expect(nav.getByRole("link", { name: "Relatórios" })).toBeVisible();
    await nav.getByRole("link", { name: "Relatórios" }).click();
  }
  await expect(page).toHaveURL(/\/relatorios$/);
  await expect(page.getByRole("heading", { level: 1, name: "Relatórios" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Relatórios" }).or(nav.getByRole("button", { name: "Mais" }))).toBeVisible();
});

test("sem sessão, /relatorios redireciona para /login", async ({ page }) => {
  await page.goto("/relatorios");
  await expect(page).toHaveURL(/\/login/);
});

test("sem rolagem horizontal da página (nomes longos, valores grandes)", async ({ page }, info) => {
  const y = year(info, 6);
  const tk = token();
  await login(page);
  const svc = seedService(`${tk}${"S".repeat(80)}`);
  const c = seedCustomer(`${tk}${"N".repeat(100)}`, "MOTORCYCLE");
  seedOrder({
    customer: c,
    at: at(`${y}-05-10`),
    items: [{ service: svc, unit: 123456789 }],
  });
  await gotoReport(page, qs(`${y}-05-01`, `${y}-05-31`));
  await expect(page.getByTestId("report-services")).toContainText(`${tk}SSS`);
  expect(await noHScroll(page)).toBe(true);
  // também em dia sem dados e no período de hoje
  await gotoReport(page);
  expect(await noHScroll(page)).toBe(true);
  // e o cenário completo (cards, tabela por dia, rankings)
  const s = seedScenario(year(info, 7), token());
  expect(s.o1).toBeGreaterThan(0);
  await gotoReport(page, qs(`${year(info, 7)}-05-01`, `${year(info, 7)}-05-31`));
  expect(await noHScroll(page)).toBe(true);
});
