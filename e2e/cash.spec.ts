import type { Locator, Page, TestInfo } from "@playwright/test";
import {
  centsIn,
  dbAll,
  dbNum,
  dbRun,
  dbRunMany,
  dialog,
  expect,
  listRow,
  login,
  noHScroll,
  test,
  token,
} from "./orders-helpers";

// Entrega 7: caixa (saldo, resultado do período, extrato, lançamentos manuais, categorias).
// O banco é compartilhado entre testes/projetos em paralelo: cada teste (e cada projeto) usa um ANO
// próprio e distante (1980..2025) e semeia lançamentos por SQL com occurredAt controlado; os totais
// são conferidos nesse intervalo isolado e o saldo acumulado só de forma relativa (opening + resultado).

type Dir = "IN" | "OUT";
const iso = (d: Date) => d.toISOString();
const nowIso = () => iso(new Date());
/** Instante em America/Sao_Paulo (UTC-3, sem horário de verão) -> ISO UTC. */
const at = (ymd: string, hm = "12:00") => iso(new Date(`${ymd}T${hm}:00.000-03:00`));

/** Ano exclusivo do teste (idx) e do projeto (mobile = +1). */
const year = (info: TestInfo, idx: number) =>
  1980 + idx * 2 + (info.project.name === "mobile" ? 1 : 0) - info.repeatEachIndex * 30; // repeat-each não repete o ano
const range = (y: number) => `?periodo=personalizado&de=${y}-01-01&ate=${y}-12-31`;

function catId(name: string, dir: Dir): number {
  const id = dbNum("select id from CashCategory where name = ? and direction = ?", name, dir);
  if (!id) throw new Error(`categoria padrão ausente: ${name}`);
  return id;
}

function seedCategory(name: string, dir: Dir, active = true): number {
  return Number(
    dbRun(
      `insert into CashCategory (name, direction, active) values (?, ?, ${active ? "true" : "false"})`,
      name,
      dir,
    ),
  );
}

function seedEntry(o: {
  dir: Dir;
  cents: number;
  at: string;
  method?: string;
  cat?: number | null;
  desc?: string | null;
  orderId?: number | null;
}): number {
  const now = nowIso();
  return Number(
    dbRun(
      `insert into CashEntry (direction, amountCents, method, categoryId, serviceOrderId, description, occurredAt, createdAt, updatedAt)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      o.dir,
      o.cents,
      o.method ?? "CASH",
      o.cat ?? null,
      o.orderId ?? null,
      o.desc ?? null,
      o.at,
      now,
      now,
    ),
  );
}

const ENTRY_SQL = `insert into CashEntry (direction, amountCents, method, categoryId, serviceOrderId, description, occurredAt, createdAt, updatedAt)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
type EntrySeed = Parameters<typeof seedEntry>[0];
const entryRow = (o: EntrySeed) => {
  const now = nowIso();
  return [
    o.dir,
    o.cents,
    o.method ?? "CASH",
    o.cat ?? null,
    o.orderId ?? null,
    o.desc ?? null,
    o.at,
    now,
    now,
  ];
};
/** Semeia muitos lançamentos numa única transação. */
const seedEntries = (list: EntrySeed[]) => dbRunMany(ENTRY_SQL, list.map(entryRow));

/** Cliente + atendimento concluído; `payments` viram CashEntry IN com serviceOrderId. */
function seedOrder(
  customer: string,
  total: number,
  payments: { cents: number; at: string; method?: string }[],
): number {
  const now = nowIso();
  const cid = Number(
    dbRun(
      "insert into Customer (name, searchName, active, createdAt, updatedAt) values (?, ?, true, ?, ?)",
      customer,
      customer.toLowerCase(),
      now,
      now,
    ),
  );
  const paid = payments.reduce((s, p) => s + p.cents, 0);
  const when = payments[0]?.at ?? now;
  const oid = Number(
    dbRun(
      `insert into ServiceOrder (customerId, status, occurredAt, completedAt, discountCents, totalCents, paidCents, createdAt, updatedAt)
       values (?, 'DONE', ?, ?, 0, ?, ?, ?, ?)`,
      cid,
      when,
      when,
      total,
      paid,
      now,
      now,
    ),
  );
  dbRun(
    `insert into ServiceOrderItem (orderId, kind, description, quantity, unitPriceCents, totalCents)
     values (?, 'SERVICE', 'Servico semeado', 1, ?, ?)`,
    oid,
    total,
    total,
  );
  for (const p of payments)
    seedEntry({ dir: "IN", cents: p.cents, method: p.method ?? "PIX", at: p.at, orderId: oid });
  return oid;
}

async function gotoCash(page: Page, qs = "") {
  await page.goto(`/caixa${qs}`);
  await page.waitForLoadState("networkidle"); // hidratação (dev)
}

const money = async (loc: Locator) => {
  const t = await loc.innerText();
  const c = centsIn(t)[0];
  return /[-−]/.test(t) ? -c : c;
};
const tid = (page: Page, id: string) => money(page.getByTestId(id));
const opening = async (page: Page) => {
  const l = page.getByTestId("cash-opening");
  return (await l.count()) ? money(l) : 0;
};
const count = async (page: Page) =>
  Number((await page.getByTestId("cash-count").innerText()).match(/\d+/)?.[0]);

const METHOD_LABEL: Record<string, string> = {
  CASH: "Dinheiro",
  PIX: "Pix",
  DEBIT_CARD: "Débito",
  CREDIT_CARD: "Crédito",
};

type Row = { text: string; dir: Dir; cents: number };
async function rows(page: Page): Promise<Row[]> {
  const loc = page.getByRole("region", { name: "Extrato" }).locator("li:visible, tbody tr:visible");
  const n = await loc.count();
  const out: Row[] = [];
  for (let i = 0; i < n; i++) {
    const r = loc.nth(i);
    const text = await r.innerText();
    const dir = (await r.locator("[data-direction]").first().getAttribute("data-direction")) as Dir;
    const cs = centsIn(text);
    out.push({ text, dir, cents: cs[cs.length - 1] });
  }
  return out;
}

/** Percorre todas as páginas do extrato (?pagina=N) do URL atual. */
async function allRows(page: Page): Promise<Row[]> {
  const base = new URL(page.url());
  const all: Row[] = [];
  const m = (await page.getByText(/Página \d+ de \d+/).count())
    ? Number((await page.getByText(/Página \d+ de \d+/).innerText()).match(/de (\d+)/)![1])
    : 1;
  for (let p = 1; p <= m; p++) {
    const u = new URL(base);
    if (p > 1) u.searchParams.set("pagina", String(p));
    else u.searchParams.delete("pagina");
    await page.goto(u.pathname + u.search);
    await page.waitForLoadState("networkidle");
    all.push(...(await rows(page)));
  }
  return all;
}

async function fillEntry(
  page: Page,
  d: { value?: string; category?: string; method?: string; when?: string; desc?: string },
) {
  const dlg = dialog(page);
  if (d.value !== undefined) await dlg.getByLabel("Valor", { exact: true }).fill(d.value);
  if (d.category) await dlg.getByLabel("Categoria").selectOption({ label: d.category });
  if (d.method) await dlg.getByRole("button", { name: d.method, exact: true }).click();
  if (d.when) await dlg.getByLabel("Data e hora").fill(d.when);
  if (d.desc !== undefined) await dlg.getByLabel("Descrição (opcional)").fill(d.desc);
}

/** Select "Categoria" do filtro do extrato (no formulário o select está dentro do dialog). */
const filterCategory = (page: Page) =>
  page
    .locator("select")
    .filter({ has: page.locator("option", { hasText: "Todas as categorias" }) });

const openNew = async (page: Page, name: "+ Despesa" | "+ Entrada" | "Saldo inicial") => {
  await page.getByRole("button", { name, exact: true }).click();
};
const save = (page: Page, label = "Salvar lançamento") =>
  dialog(page).getByRole("button", { name: label, exact: true }).click();

const SUM = `coalesce(sum(case when direction = 'IN' then amountCents else -amountCents end), 0)`;
/** Σ IN − Σ OUT no banco até o fim do dia (instante em BRT). */
const dbUntil = (ymd: string) =>
  dbNum(
    `select ${SUM} from CashEntry where occurredAt <= ?`,
    iso(new Date(`${ymd}T23:59:59.999-03:00`)),
  );
/** Σ IN − Σ OUT no banco antes do início do dia. */
const dbBefore = (ymd: string) =>
  dbNum(`select ${SUM} from CashEntry where occurredAt < ?`, at(ymd, "00:00"));

/**
 * Saldo acumulado e saldo de abertura do período == soma dos lançamentos no banco. Outros projetos
 * gravam em anos anteriores em paralelo: relê (reload) até as duas leituras coincidirem.
 */
async function expectBalances(page: Page, fromYmd: string, toYmd: string) {
  await expect(async () => {
    await page.reload();
    await page.waitForLoadState("networkidle");
    expect(await opening(page)).toBe(dbBefore(fromYmd));
    expect(await tid(page, "cash-balance")).toBe(dbUntil(toYmd));
  }).toPass({ timeout: 20_000 });
}

/** Valor de um card (data-testid) esperado após o router.refresh() do salvamento. */
const expectCents = (page: Page, id: string, cents: number) =>
  expect.poll(() => tid(page, id), { timeout: 10_000 }).toBe(cents);

// ================================================================= saldo, resultado e pagamento de OS

test.describe("saldo, resultado e pagamento de atendimento", () => {
  test("saldo inicial + 2 despesas + 1 pagamento de atendimento: saldo = Σ entradas − Σ saídas", async ({
    page,
  }, info) => {
    const y = year(info, 0);
    const tk = token();
    await login(page);
    await gotoCash(page, range(y));

    await openNew(page, "Saldo inicial");
    await expect(dialog(page).getByRole("heading", { name: "Saldo inicial" })).toBeVisible();
    // categoria já escolhida
    await expect(dialog(page).getByLabel("Categoria")).toHaveValue(
      String(catId("Saldo inicial / aporte", "IN")),
    );
    await fillEntry(page, { value: "500", when: `${y}-01-02T08:00`, desc: `${tk} abertura` });
    await save(page);
    await expect(page.getByText("Lançamento registrado")).toBeVisible();
    await expect(dialog(page)).toBeHidden();

    await openNew(page, "+ Despesa");
    await expect(dialog(page).getByRole("heading", { name: "Nova despesa" })).toBeVisible();
    await fillEntry(page, {
      value: "30",
      category: "Aluguel",
      method: "Pix",
      when: `${y}-01-02T09:00`,
      desc: `${tk} despesa1`,
    });
    await save(page);
    await expect(dialog(page)).toBeHidden();

    await openNew(page, "+ Despesa");
    await fillEntry(page, {
      value: "12,50",
      category: "Água e luz",
      method: "Débito",
      when: `${y}-01-02T10:00`,
      desc: `${tk} despesa2`,
    });
    await save(page);
    await expect(dialog(page)).toBeHidden();

    const oid = seedOrder(`${tk} Cliente`, 8000, [{ cents: 8000, at: at(`${y}-01-03`, "10:00") }]);
    await page.reload();
    await page.waitForLoadState("networkidle");

    // período = ano inteiro: entradas 500 + 80; saídas 30 + 12,50
    await expect(page.getByTestId("cash-total")).toContainText("580,00");
    expect(await tid(page, "cash-out")).toBe(4250);
    expect(await tid(page, "cash-result")).toBe(58000 - 4250);
    // saldo = abertura + resultado (mesma renderização) e == Σ entradas − Σ saídas no banco
    await expect(async () => {
      await page.reload();
      await page.waitForLoadState("networkidle");
      expect(await tid(page, "cash-balance")).toBe((await opening(page)) + 58000 - 4250);
    }).toPass({ timeout: 20_000 });
    await expectBalances(page, `${y}-01-01`, `${y}-12-31`);

    // por forma: Pix = 80 (OS) − 30 (despesa); Débito = −12,50; Dinheiro = +500
    expect(await tid(page, "cash-net-DEBIT_CARD")).toBe(-1250);
    expect(await tid(page, "cash-out-PIX")).toBe(3000);
    expect(await tid(page, "cash-PIX")).toBe(8000);
    expect(await tid(page, "cash-CASH")).toBe(50000);

    // pagamento do atendimento: título "Atendimento nº X", link, sem Editar/Excluir, com o motivo
    const row = listRow(page, `Atendimento nº ${oid}`);
    await expect(row).toBeVisible();
    await expect(row.getByRole("link", { name: `Atendimento nº ${oid}` })).toHaveAttribute(
      "href",
      `/atendimentos/${oid}`,
    );
    await expect(row.getByRole("button", { name: "Editar" })).toHaveCount(0);
    await expect(row.getByRole("button", { name: "Excluir" })).toHaveCount(0);
    await expect(row).toContainText(/pelo atendimento/);
    await expect(row).toContainText("Atendimentos");

    // resultado do período só do intervalo: dia 03 = só o pagamento; o saldo carrega o dia 02
    await gotoCash(page, `?data=${y}-01-03`);
    expect(await tid(page, "cash-result")).toBe(8000);
    expect(await tid(page, "cash-total")).toBe(8000);
    expect(await tid(page, "cash-out")).toBe(0);
    await expectBalances(page, `${y}-01-03`, `${y}-01-03`);
    // dia 02: sem o pagamento
    await gotoCash(page, `?data=${y}-01-02`);
    expect(await tid(page, "cash-result")).toBe(50000 - 4250);
    await expectBalances(page, `${y}-01-02`, `${y}-01-02`);
    // clicar no link leva ao atendimento
    await gotoCash(page, `?data=${y}-01-03`);
    await page.getByRole("link", { name: `Atendimento nº ${oid}` }).click();
    await expect(page).toHaveURL(new RegExp(`/atendimentos/${oid}$`));
  });

  test("fiado não pago NÃO entra no caixa; pagamento parcial entra só pelo que foi pago", async ({
    page,
  }, info) => {
    const y = year(info, 1);
    const tk = token();
    await login(page);
    const unpaid = seedOrder(`${tk} Devedor`, 10000, []);
    const partial = seedOrder(`${tk} Parcial`, 10000, [{ cents: 4000, at: at(`${y}-02-10`) }]);
    // a OS sem pagamento tem occurredAt "agora"; o caixa do ano não a mostra de qualquer forma
    await gotoCash(page, range(y));
    expect(await tid(page, "cash-total")).toBe(4000);
    expect(await tid(page, "cash-result")).toBe(4000);
    await expect(page.getByRole("link", { name: `Atendimento nº ${partial}` })).toBeVisible();
    await expect(page.getByRole("link", { name: `Atendimento nº ${unpaid}` })).toHaveCount(0);
    // hoje: a OS do fiado não aparece no extrato
    await gotoCash(page, `?q=${tk}`);
    await expect(page.getByRole("link", { name: `Atendimento nº ${unpaid}` })).toHaveCount(0);
    expect(await count(page)).toBe(0);
  });
});

// ================================================================= fuso de São Paulo

test.describe("lançamentos perto da meia-noite (fuso America/Sao_Paulo)", () => {
  test("23:30 e 00:30 caem no dia/mês corretos (virada de dia e de mês)", async ({
    page,
  }, info) => {
    const y = year(info, 2);
    const tk = token();
    await login(page);
    const cat = catId("Outras entradas", "IN");
    const out = catId("Aluguel", "OUT");
    seedEntry({ dir: "IN", cents: 1000, at: at(`${y}-03-31`, "23:30"), cat, desc: `${tk} a2330` });
    seedEntry({ dir: "IN", cents: 2000, at: at(`${y}-04-01`, "00:30"), cat, desc: `${tk} b0030` });
    seedEntry({ dir: "OUT", cents: 500, at: at(`${y}-04-30`, "23:30"), cat: out, desc: `${tk} c` });
    seedEntry({ dir: "OUT", cents: 700, at: at(`${y}-05-01`, "00:30"), cat: out, desc: `${tk} d` });

    await gotoCash(page, `?data=${y}-03-31`);
    expect(await count(page)).toBe(1);
    expect(await tid(page, "cash-total")).toBe(1000);
    await expect(page.getByRole("region", { name: "Extrato" })).toContainText(`31/03/${y}`);
    await expect(page.getByRole("region", { name: "Extrato" })).toContainText("23:30");
    await expectBalances(page, `${y}-03-31`, `${y}-03-31`);

    await gotoCash(page, `?data=${y}-04-01`);
    expect(await count(page)).toBe(1);
    expect(await tid(page, "cash-total")).toBe(2000);
    await expect(page.getByRole("region", { name: "Extrato" })).toContainText("00:30");
    // abertura de 01/04 inclui o lançamento das 23:30 de 31/03
    await expectBalances(page, `${y}-04-01`, `${y}-04-01`);
    expect(dbBefore(`${y}-04-01`) - dbBefore(`${y}-03-31`)).toBe(1000);

    // abril inteiro (virada de mês): 00:30 de 01/04 dentro, 23:30 de 30/04 dentro; 31/03 e 01/05 fora
    await gotoCash(page, `?periodo=personalizado&de=${y}-04-01&ate=${y}-04-30`);
    expect(await tid(page, "cash-total")).toBe(2000);
    expect(await tid(page, "cash-out")).toBe(500);
    expect(await tid(page, "cash-result")).toBe(1500);
    expect(await count(page)).toBe(2);
    await gotoCash(page, `?data=${y}-05-01`);
    expect(await tid(page, "cash-out")).toBe(700);
    expect(await count(page)).toBe(1);

    // criado pelo formulário: 23:30 do dia 31/03 e 00:30 do dia seguinte seguem a mesma regra
    await gotoCash(page, `?data=${y}-03-31`);
    await openNew(page, "+ Despesa");
    await fillEntry(page, {
      value: "9",
      category: "Aluguel",
      when: `${y}-03-31T23:30`,
      desc: `${tk} ui2330`,
    });
    await save(page);
    await expect(dialog(page)).toBeHidden();
    await expect(page.getByRole("region", { name: "Extrato" })).toContainText(`${tk} ui2330`);
    await openNew(page, "+ Despesa");
    await fillEntry(page, {
      value: "8",
      category: "Aluguel",
      when: `${y}-04-01T00:30`,
      desc: `${tk} ui0030`,
    });
    await save(page);
    await expect(dialog(page)).toBeHidden();
    await expect(page.getByRole("region", { name: "Extrato" })).not.toContainText(`${tk} ui0030`);
    const stored = dbAll("select occurredAt from CashEntry where description = ?", `${tk} ui2330`);
    expect(new Date(String(stored[0].occurredAt)).toISOString()).toBe(at(`${y}-03-31`, "23:30"));
    await gotoCash(page, `?data=${y}-04-01`);
    await expect(page.getByRole("region", { name: "Extrato" })).toContainText(`${tk} ui0030`);
  });
});

// ================================================================= lançamentos manuais

test.describe("lançamento manual: criar, editar, excluir", () => {
  test("cria entrada, edita (valor, forma, direção e categoria) e exclui", async ({
    page,
  }, info) => {
    const y = year(info, 3);
    const tk = token();
    await login(page);
    await gotoCash(page, range(y));
    await openNew(page, "+ Entrada");
    await expect(dialog(page).getByRole("heading", { name: "Nova entrada" })).toBeVisible();
    await fillEntry(page, {
      value: "25",
      category: "Outras entradas",
      method: "Dinheiro",
      when: `${y}-06-10T10:00`,
      desc: `${tk} venda avulsa`,
    });
    await save(page);
    await expect(page.getByText("Lançamento registrado")).toBeVisible();
    const row = () => listRow(page, `${tk} venda avulsa`);
    await expect(row()).toBeVisible();
    await expectCents(page, "cash-total", 2500);

    await row().getByRole("button", { name: "Editar" }).click();
    await expect(dialog(page).getByRole("heading", { name: "Editar lançamento" })).toBeVisible();
    await expect(dialog(page).getByLabel("Descrição (opcional)")).toHaveValue(`${tk} venda avulsa`);
    await fillEntry(page, { value: "40", method: "Pix" });
    await save(page, "Salvar alterações");
    await expect(page.getByText("Lançamento atualizado")).toBeVisible();
    await expect(dialog(page)).toBeHidden();
    await expect(row()).toContainText("Pix");
    await expectCents(page, "cash-total", 4000);

    // vira saída: a categoria é limpa e uma de saída é exigida
    await row().getByRole("button", { name: "Editar" }).click();
    await dialog(page).getByRole("button", { name: "Saída", exact: true }).click();
    await expect(dialog(page).getByLabel("Categoria")).toHaveValue("");
    await save(page, "Salvar alterações");
    await expect(dialog(page).getByText("Selecione uma categoria")).toBeVisible();
    await fillEntry(page, { category: "Outras despesas" });
    await save(page, "Salvar alterações");
    await expect(dialog(page)).toBeHidden();
    await expectCents(page, "cash-total", 0);
    await expectCents(page, "cash-out", 4000);
    await expect(row().locator("[data-direction=OUT]")).toBeVisible();

    // excluir (cancelar primeiro não exclui)
    await row().getByRole("button", { name: "Excluir" }).click();
    await expect(dialog(page).getByRole("heading", { name: "Excluir lançamento?" })).toBeVisible();
    await dialog(page).getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(dialog(page)).toBeHidden();
    expect(
      dbNum("select count(*) from CashEntry where description = ?", `${tk} venda avulsa`),
    ).toBe(1);
    await row().getByRole("button", { name: "Excluir" }).click();
    await dialog(page).getByRole("button", { name: "Excluir", exact: true }).click();
    await expect(page.getByText("Lançamento excluído")).toBeVisible();
    await expect(page.getByText(`${tk} venda avulsa`)).toHaveCount(0);
    await expectCents(page, "cash-out", 0);
    expect(
      dbNum("select count(*) from CashEntry where description = ?", `${tk} venda avulsa`),
    ).toBe(0);
  });

  test("validações do formulário: valor vazio/zero/inválido, categoria, data futura", async ({
    page,
  }) => {
    await login(page);
    await gotoCash(page);
    const before = dbNum("select count(*) from CashEntry");
    await openNew(page, "+ Despesa");
    const dlg = dialog(page);
    await save(page);
    await expect(dlg.getByText("Informe o valor")).toBeVisible();
    await expect(dlg.getByText("Selecione uma categoria")).toBeVisible();
    await fillEntry(page, { value: "0", category: "Aluguel" });
    await save(page);
    await expect(dlg.getByText("O valor deve ser maior que zero")).toBeVisible();
    await fillEntry(page, { value: "abc" });
    await save(page);
    await expect(
      dlg
        .getByRole("alert")
        .filter({ hasText: /inv[áa]lido|valor/i })
        .first(),
    ).toBeVisible();
    await fillEntry(page, { value: "-5" });
    await save(page);
    await expect(dlg).toBeVisible(); // negativo nunca grava
    // data futura (amanhã) é rejeitada pelo servidor
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    await fillEntry(page, { value: "5", when: `${tomorrow}T10:00` });
    await save(page);
    await expect(dlg.getByText("A data do lançamento não pode ser futura").first()).toBeVisible();
    expect(dbNum("select count(*) from CashEntry")).toBeGreaterThanOrEqual(before); // nada novo nosso
    await expect(dlg).toBeVisible();
    await dlg.getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(dlg).toBeHidden();
    // dia seguinte bloqueado no seletor de dia
    await expect(page.getByRole("button", { name: "Próximo dia" })).toBeDisabled();
  });

  test("trocar a direção limpa a categoria e só oferece categorias da direção", async ({
    page,
  }) => {
    await login(page);
    await gotoCash(page);
    await openNew(page, "+ Despesa");
    const sel = dialog(page).getByLabel("Categoria");
    await expect(sel.locator("option", { hasText: "Aluguel" })).toHaveCount(1);
    await expect(sel.locator("option", { hasText: "Outras entradas" })).toHaveCount(0);
    await sel.selectOption({ label: "Aluguel" });
    await dialog(page).getByRole("button", { name: "Entrada", exact: true }).click();
    await expect(sel).toHaveValue("");
    await expect(sel.locator("option", { hasText: "Aluguel" })).toHaveCount(0);
    await expect(sel.locator("option", { hasText: "Outras entradas" })).toHaveCount(1);
    await dialog(page).getByRole("button", { name: "Saída", exact: true }).click();
    await expect(sel).toHaveValue("");
  });

  test("duplo clique em Salvar não duplica o lançamento", async ({ page }, info) => {
    const y = year(info, 4);
    const tk = token();
    await login(page);
    await gotoCash(page, range(y));
    await openNew(page, "+ Despesa");
    await fillEntry(page, {
      value: "15",
      category: "Aluguel",
      when: `${y}-01-05T10:00`,
      desc: `${tk} duplo`,
    });
    await dialog(page).getByRole("button", { name: "Salvar lançamento", exact: true }).dblclick();
    await expect(dialog(page)).toBeHidden();
    await page.waitForTimeout(500);
    expect(dbNum("select count(*) from CashEntry where description = ?", `${tk} duplo`)).toBe(1);
  });
});

// ================================================================= categorias no formulário

test("categoria inativa some do formulário, fica no extrato e o lançamento antigo continua editável", async ({
  page,
}, info) => {
  const y = year(info, 5);
  const tk = token();
  await login(page);
  const name = `${tk} Velha`;
  const cat = seedCategory(name, "OUT", false);
  const active = seedCategory(`${tk} Ativa`, "OUT", true);
  seedEntry({ dir: "OUT", cents: 1234, at: at(`${y}-01-10`), cat, desc: `${tk} antigo` });
  await gotoCash(page, range(y));

  const row = listRow(page, `${tk} antigo`);
  await expect(row).toContainText(`${name} (inativa)`);
  // filtro de categoria lista a inativa (histórico)
  await expect(
    filterCategory(page).locator("option", { hasText: `${name} (inativa)` }),
  ).toHaveCount(1);

  await openNew(page, "+ Despesa");
  const sel = dialog(page).getByLabel("Categoria");
  await expect(sel.locator("option", { hasText: `${tk} Ativa` })).toHaveCount(1);
  await expect(sel.locator("option", { hasText: `${tk} Velha` })).toHaveCount(0);
  await dialog(page).getByRole("button", { name: "Cancelar", exact: true }).click();

  // edição do lançamento antigo mantém a categoria inativa selecionável
  await row.getByRole("button", { name: "Editar" }).click();
  await expect(dialog(page).getByLabel("Categoria")).toHaveValue(String(cat));
  await fillEntry(page, { value: "20" });
  await save(page, "Salvar alterações");
  await expect(page.getByText("Lançamento atualizado")).toBeVisible();
  await expect(dialog(page)).toBeHidden();
  await expectCents(page, "cash-out", 2000);
  // tirá-lo da categoria inativa: a ativa passa a valer
  await row.getByRole("button", { name: "Editar" }).click();
  await fillEntry(page, { category: `${tk} Ativa` });
  await save(page, "Salvar alterações");
  await expect(dialog(page)).toBeHidden();
  await expect(row).toContainText(`${tk} Ativa`);
  expect(active).toBeGreaterThan(0);
});

// ================================================================= totais x extrato, filtros, paginação

test.describe("totais x extrato", () => {
  test("totais por forma e por categoria batem com a soma do extrato (3 páginas)", async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    const y = year(info, 6);
    const tk = token();
    await login(page);
    const methods = ["CASH", "PIX", "DEBIT_CARD", "CREDIT_CARD"];
    const cats: [string, Dir][] = [
      ["Aluguel", "OUT"],
      ["Outras despesas", "OUT"],
      ["Outras entradas", "IN"],
      ["Saldo inicial / aporte", "IN"],
    ];
    const oid = seedOrder(`${tk} Cli`, 99999, []);
    const bulk: EntrySeed[] = [];
    for (let i = 0; i < 123; i++) {
      const [cn, dir] = cats[i % 4];
      const m = methods[(i * 7 + 3) % 4];
      const cents = 137 + ((i * 331) % 9000);
      if (i % 10 === 0) {
        bulk.push({
          dir: "IN",
          cents,
          method: m,
          at: at(`${y}-05-${String(1 + (i % 28)).padStart(2, "0")}`, "09:00"),
          orderId: oid,
        });
      } else {
        bulk.push({
          dir,
          cents,
          method: m,
          cat: catId(cn, dir),
          desc: "x",
          at: at(`${y}-05-${String(1 + (i % 28)).padStart(2, "0")}`, `1${i % 10}:${10 + (i % 40)}`),
        });
      }
    }
    seedEntries(bulk);
    await gotoCash(page, range(y));
    expect(await count(page)).toBe(123);
    await expect(page.getByText("Página 1 de 3")).toBeVisible();
    expect(await rows(page)).toHaveLength(50);
    const all = await allRows(page);
    expect(all).toHaveLength(123);

    await gotoCash(page, range(y));
    const inTotal = all.filter((r) => r.dir === "IN").reduce((s, r) => s + r.cents, 0);
    const outTotal = all.filter((r) => r.dir === "OUT").reduce((s, r) => s + r.cents, 0);
    expect(await tid(page, "cash-total")).toBe(inTotal);
    expect(await tid(page, "cash-out")).toBe(outTotal);
    expect(await tid(page, "cash-result")).toBe(inTotal - outTotal);
    for (const m of methods) {
      const mine = all.filter((r) => r.text.includes(METHOD_LABEL[m]));
      const inM = mine.filter((r) => r.dir === "IN").reduce((s, r) => s + r.cents, 0);
      const outM = mine.filter((r) => r.dir === "OUT").reduce((s, r) => s + r.cents, 0);
      expect(await tid(page, `cash-${m}`), `entradas ${m}`).toBe(inM);
      expect(await tid(page, `cash-out-${m}`), `saídas ${m}`).toBe(outM);
      expect(await tid(page, `cash-net-${m}`), `líquido ${m}`).toBe(inM - outM);
    }
    // por categoria (inclui "Atendimentos" = pagamentos de OS)
    const byCat = page.getByRole("region", { name: "Totais por categoria" });
    for (const [label, test_] of [
      ["Atendimentos", (r: Row) => r.text.includes("Atendimento nº")],
      ["Aluguel", (r: Row) => r.text.includes("Aluguel")],
      ["Outras despesas", (r: Row) => r.text.includes("Outras despesas")],
      ["Outras entradas", (r: Row) => r.text.includes("Outras entradas")],
      ["Saldo inicial / aporte", (r: Row) => r.text.includes("Saldo inicial / aporte")],
    ] as const) {
      const mine = all.filter(test_);
      const item = byCat.locator("div", { hasText: new RegExp(`^${label} \\(${mine.length}\\)`) });
      await expect(item.first(), label).toBeVisible();
      const got = await money(item.first().locator("dd"));
      expect(got, label).toBe(mine.reduce((s, r) => s + r.cents, 0));
    }
  });

  test("filtros do extrato: tipo, categoria (inclui Atendimentos), forma e busca", async ({
    page,
  }, info) => {
    const y = year(info, 7);
    const tk = token();
    await login(page);
    const rent = catId("Aluguel", "OUT");
    const oth = catId("Outras entradas", "IN");
    const customer = `${tk} Maria`;
    const oid = seedOrder(customer, 3000, [
      { cents: 3000, at: at(`${y}-02-01`), method: "CREDIT_CARD" },
    ]);
    seedEntry({
      dir: "OUT",
      cents: 1000,
      method: "PIX",
      cat: rent,
      desc: `${tk} luz`,
      at: at(`${y}-02-02`),
    });
    seedEntry({
      dir: "OUT",
      cents: 2000,
      method: "CASH",
      cat: rent,
      desc: `${tk} cafe`,
      at: at(`${y}-02-03`),
    });
    seedEntry({
      dir: "IN",
      cents: 500,
      method: "CASH",
      cat: oth,
      desc: `${tk} troco`,
      at: at(`${y}-02-04`),
    });
    const base = range(y);

    await gotoCash(page, base);
    expect(await count(page)).toBe(4);
    await page.getByRole("button", { name: "Entradas", exact: true }).last().click();
    await expect(page).toHaveURL(/tipo=entradas/);
    await expect.poll(async () => (await rows(page)).map((r) => r.dir).join()).toBe("IN,IN");
    await page.getByRole("button", { name: "Saídas", exact: true }).last().click();
    await expect(page).toHaveURL(/tipo=saidas/);
    await expect.poll(async () => (await rows(page)).map((r) => r.dir).join()).toBe("OUT,OUT");
    await page.getByRole("button", { name: "Todos", exact: true }).click();
    await expect(page.getByTestId("cash-count")).toContainText("4 lançamentos");

    // categoria
    const catSel = filterCategory(page);
    await catSel.selectOption("atendimentos");
    await expect(page.getByTestId("cash-count")).toContainText("1 lançamento");
    await expect(page.getByRole("link", { name: `Atendimento nº ${oid}` })).toBeVisible();
    await catSel.selectOption({ label: "Aluguel · saída" });
    await expect(page.getByTestId("cash-count")).toContainText("2 lançamentos");
    await catSel.selectOption("");
    await expect(page).not.toHaveURL(/categoria=/); // um filtro por vez: cada navegação parte da URL atual
    // forma
    const formaSel = page
      .locator("select")
      .filter({ has: page.locator("option", { hasText: "Todas as formas" }) });
    await formaSel.selectOption("CASH");
    await expect(page).toHaveURL(/forma=CASH/);
    await expect(page.getByTestId("cash-count")).toContainText("2 lançamentos");
    await formaSel.selectOption("");
    await expect(page).not.toHaveURL(/forma=/);
    // busca: descrição, cliente (sem acento/caixa) e nº do atendimento
    const box = page.getByRole("searchbox", { name: "Buscar no extrato" });
    const qIs = (v: string) =>
      expect.poll(() => decodeURIComponent(page.url()).replaceAll("+", " ")).toContain(`q=${v}`);
    await box.fill(`${tk} LUZ`);
    await qIs(`${tk} LUZ`);
    await expect(page.getByTestId("cash-count")).toContainText("1 lançamento");
    await expect(page.getByRole("region", { name: "Extrato" })).toContainText(`${tk} luz`);
    await box.fill(`${tk} maria`);
    await qIs(`${tk} maria`);
    await expect(page.getByRole("link", { name: `Atendimento nº ${oid}` })).toBeVisible();
    await expect(page.getByTestId("cash-count")).toContainText("1 lançamento");
    await box.fill(`nº ${oid}`);
    await qIs(`nº ${oid}`);
    await expect(page.getByRole("link", { name: `Atendimento nº ${oid}` })).toBeVisible();
    await expect(page.getByTestId("cash-count")).toContainText("1 lançamento");
    // sem resultados: estado vazio com "Limpar filtros", que mantém o período
    await box.fill(`${tk} naoexiste`);
    await expect(page.getByText("Nenhum lançamento encontrado com esses filtros")).toBeVisible();
    await page.getByRole("link", { name: "Limpar filtros" }).click();
    await expect(page.getByTestId("cash-count")).toContainText("4 lançamentos");
    await expect(page).toHaveURL(/periodo=personalizado/);
    // totais do cabeçalho ignoram os filtros do extrato
    expect(await tid(page, "cash-total")).toBe(3500);
  });

  test("semana (segunda a domingo) e mês: limites e paginação com mais de 50 linhas", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const tk = token();
    await login(page);
    // limites do período atual em São Paulo
    const ymdBR = (d: Date) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
    const addDays = (s: string, n: number) => {
      const d = new Date(`${s}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    };
    const today = ymdBR(new Date());
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = domingo
    const monday = addDays(today, -((dow + 6) % 7));
    const sunday = addDays(monday, 6);
    const monthFirst = `${today.slice(0, 8)}01`;
    const nextFirst = addDays(`${today.slice(0, 8)}28`, 4).slice(0, 8) + "01";
    const monthLast = addDays(nextFirst, -1);
    const ddmm = (s: string) => s.split("-").reverse().join("/");
    const cat = catId("Aluguel", "OUT");
    const e = (d: string, hm: string, label: string) =>
      seedEntry({ dir: "OUT", cents: 100, cat, desc: `${tk} ${label}`, at: at(d, hm) });

    e(monday, "00:30", "segunda0030");
    e(addDays(monday, -1), "23:30", "domingoAnterior");
    e(sunday, "23:30", "domingo2330");
    e(addDays(sunday, 1), "00:30", "segundaSeguinte");
    e(monthFirst, "00:30", "mes0030");
    e(addDays(monthFirst, -1), "23:30", "mesAnterior");
    e(monthLast, "23:30", "mes2330");
    e(nextFirst, "00:30", "mesSeguinte");

    await gotoCash(page, `?periodo=semana&q=${tk}`);
    await expect(page.getByText(`${ddmm(monday)} a ${ddmm(sunday)}`).first()).toBeVisible();
    await expect(page.getByRole("region", { name: "Extrato" })).toContainText("segunda0030");
    const text = await page.getByRole("region", { name: "Extrato" }).innerText();
    expect(text).toContain("segunda0030");
    expect(text).toContain("domingo2330");
    expect(text).not.toContain("domingoAnterior");
    expect(text).not.toContain("segundaSeguinte");
    await expect(page.getByRole("button", { name: "Semana" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await gotoCash(page, `?periodo=mes&q=${tk}`);
    const mtext = await page.getByRole("region", { name: "Extrato" }).innerText();
    expect(mtext).toContain("mes0030");
    expect(mtext).toContain("mes2330");
    expect(mtext).not.toContain("mesAnterior");
    expect(mtext).not.toContain("mesSeguinte");
    await expect(page.getByRole("button", { name: "Mês" })).toHaveAttribute("aria-pressed", "true");

    // > 50 linhas na semana e no mês (filtradas pelo token: o banco é compartilhado)
    const tkW = token();
    const tkM = token();
    seedEntries([
      ...Array.from({ length: 55 }, (_, i) => ({
        dir: "OUT" as Dir,
        cents: 100 + i,
        cat,
        desc: `${tkW} w${i}`,
        at: at(monday === today ? sunday : monday, "12:00"),
      })),
      ...Array.from({ length: 57 }, (_, i) => ({
        dir: "OUT" as Dir,
        cents: 100 + i,
        cat,
        desc: `${tkM} m${i}`,
        at: at(monthFirst === today ? monthLast : monthFirst, "12:00"),
      })),
    ]);
    for (const [qs, t, n] of [
      ["semana", tkW, 55],
      ["mes", tkM, 57],
    ] as const) {
      await gotoCash(page, `?periodo=${qs}&q=${t}`);
      expect(await count(page)).toBe(n);
      await expect(page.getByText("Página 1 de 2")).toBeVisible();
      expect(await rows(page)).toHaveLength(50);
      await page.getByRole("link", { name: "Próxima" }).click();
      await expect(page.getByText("Página 2 de 2")).toBeVisible();
      await expect(page).toHaveURL(/pagina=2/);
      expect(await rows(page)).toHaveLength(n - 50);
      await page.getByRole("link", { name: "Anterior" }).click();
      await expect(page.getByText("Página 1 de 2")).toBeVisible();
    }
  });

  test("período personalizado e datas invertidas", async ({ page }, info) => {
    const y = year(info, 8);
    const tk = token();
    await login(page);
    const cat = catId("Aluguel", "OUT");
    seedEntry({ dir: "OUT", cents: 100, cat, desc: `${tk} um`, at: at(`${y}-03-01`, "00:30") });
    seedEntry({ dir: "OUT", cents: 200, cat, desc: `${tk} dez`, at: at(`${y}-03-10`, "23:30") });
    seedEntry({ dir: "OUT", cents: 400, cat, desc: `${tk} onze`, at: at(`${y}-03-11`, "00:30") });

    // URL invertida é corrigida
    await gotoCash(page, `?periodo=personalizado&de=${y}-03-10&ate=${y}-03-01`);
    await expect(page.getByText(`01/03/${y} a 10/03/${y}`).first()).toBeVisible();
    expect(await tid(page, "cash-out")).toBe(300);
    // URL com lixo vira hoje (sem erro)
    await gotoCash(page, `?periodo=personalizado&de=lixo&ate=2024-13-45`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // pelo chip: abre com os últimos 7 dias; ajusta as datas; início depois do fim é corrigido
    await gotoCash(page);
    await page.getByRole("button", { name: "Personalizado" }).click();
    await expect(page).toHaveURL(/periodo=personalizado/);
    await page.getByLabel("Início").fill(`${y}-03-01`);
    await page.getByLabel("Fim").fill(`${y}-03-10`);
    await expect(page).toHaveURL(new RegExp(`ate=${y}-03-10`));
    await expect(page.getByTestId("cash-out")).toContainText("3,00");
    await page.getByLabel("Fim").fill(`${y}-02-01`); // fim antes do início
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(`01/02/${y} a 01/03/${y}`).first()).toBeVisible();
  });

  test("saldo negativo é legível", async ({ page }, info) => {
    const y = year(info, 9);
    const tk = token();
    await login(page);
    const cat = catId("Aluguel", "OUT");
    const id = seedEntry({
      dir: "OUT",
      cents: 50_000_000,
      cat,
      desc: `${tk} rombo`,
      at: at(`${y}-01-01`, "10:00"),
    });
    try {
      await gotoCash(page, range(y));
      const bal = page.getByTestId("cash-balance");
      await expect(bal).toHaveAttribute("data-negative", "true");
      expect(await money(bal)).toBeLessThan(0);
      await expect(bal).toContainText(/[-−]/);
      expect(await tid(page, "cash-result")).toBe(-50_000_000);
      expect(await noHScroll(page)).toBe(true);
    } finally {
      dbRun("delete from CashEntry where id = ?", id);
    }
  });

  test("estado vazio do período", async ({ page }) => {
    await login(page);
    await gotoCash(page, "?data=1900-01-01");
    await expect(page.getByText("Nenhum lançamento neste período")).toBeVisible();
    expect(await tid(page, "cash-result")).toBe(0);
  });
});

// ================================================================= categorias (tela)

test.describe("/caixa/categorias", () => {
  const li = (page: Page, name: string) =>
    page.locator("li[data-testid^=category-]").filter({ hasText: name }).first();

  async function addCategory(page: Page, name: string, dir?: "Entrada" | "Saída") {
    const form = page.getByRole("form", { name: "Nova categoria" });
    await form.getByLabel("Nome").fill(name);
    if (dir) await form.getByRole("button", { name: dir, exact: true }).click();
    await form.getByRole("button", { name: "Adicionar categoria" }).click();
  }

  test("criar, duplicada (sem acento/caixa), mesma palavra em outra direção, renomear, inativar/reativar, excluir", async ({
    page,
  }) => {
    await login(page);
    const tk = token();
    await page.goto("/caixa/categorias");
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByRole("heading", { level: 1, name: "Categorias do caixa" }),
    ).toBeVisible();

    await addCategory(page, `${tk} Água`, "Saída");
    await expect(page.getByText("Categoria criada")).toBeVisible();
    await expect(li(page, `${tk} Água`)).toBeVisible();
    // duplicada: outra caixa e sem acento, mesma direção
    await addCategory(page, `${tk.toUpperCase()} AGUA`, "Saída");
    await expect(
      page.getByText("Já existe uma categoria com esse nome para este tipo"),
    ).toBeVisible();
    // mesma palavra em outra direção é aceita
    await addCategory(page, `${tk} Água`, "Entrada");
    await expect(
      page.getByRole("region", { name: "Categorias de entrada" }).getByText(`${tk} Água`),
    ).toBeVisible();

    // renomear
    const out = page.getByRole("region", { name: "Categorias de saída" });
    const item = out.locator("li").filter({ hasText: `${tk} Água` });
    await item.getByRole("button", { name: "Renomear" }).click();
    await dialog(page).getByLabel("Nome").fill(`${tk} Energia`);
    await dialog(page).getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(page.getByText("Categoria atualizada")).toBeVisible();
    await expect(out.locator("li").filter({ hasText: `${tk} Energia` })).toBeVisible();

    // inativar / reativar
    const energia = out.locator("li").filter({ hasText: `${tk} Energia` });
    await energia.getByRole("button", { name: "Inativar" }).click();
    await dialog(page).getByRole("button", { name: "Inativar", exact: true }).click();
    await expect(page.getByText("Categoria inativada")).toBeVisible();
    await expect(energia.getByText("Inativa", { exact: true })).toBeVisible();
    await energia.getByRole("button", { name: "Reativar" }).click();
    await expect(page.getByText("Categoria reativada")).toBeVisible();
    await expect(energia.getByText("Inativa", { exact: true })).toHaveCount(0);

    // excluir (nunca usada)
    await energia.getByRole("button", { name: "Excluir" }).click();
    await dialog(page).getByRole("button", { name: "Excluir", exact: true }).click();
    await expect(page.getByText("Categoria excluída")).toBeVisible();
    await expect(out.locator("li").filter({ hasText: `${tk} Energia` })).toHaveCount(0);
  });

  test("categoria usada: Excluir desabilitado; estado velho é rejeitado pelo servidor; inativa some do formulário", async ({
    page,
  }, info) => {
    const y = year(info, 10);
    await login(page);
    const tk = token();
    const used = seedCategory(`${tk} Usada`, "OUT");
    seedEntry({ dir: "OUT", cents: 100, cat: used, at: at(`${y}-01-01`) });
    const stale = seedCategory(`${tk} Velha`, "OUT");
    await page.goto("/caixa/categorias");
    await page.waitForLoadState("networkidle");
    const usedLi = li(page, `${tk} Usada`);
    await expect(usedLi.getByRole("button", { name: "Excluir" })).toBeDisabled();
    await expect(usedLi).toContainText("Já tem lançamentos");
    await expect(usedLi).toContainText("1 lançamento");

    // a tela ainda acredita que "Velha" é excluível; um lançamento entra por fora
    seedEntry({ dir: "OUT", cents: 100, cat: stale, at: at(`${y}-01-01`) });
    const staleLi = li(page, `${tk} Velha`);
    await staleLi.getByRole("button", { name: "Excluir" }).click();
    await dialog(page).getByRole("button", { name: "Excluir", exact: true }).click();
    await expect(dialog(page).getByRole("alert")).toContainText("Categoria com lançamentos");
    await dialog(page).getByRole("button", { name: "Cancelar", exact: true }).click();
    expect(dbNum("select count(*) from CashCategory where id = ?", stale)).toBe(1);

    // inativar a usada: continua listada na tela; some do formulário de novo lançamento
    await usedLi.getByRole("button", { name: "Inativar" }).click();
    await dialog(page).getByRole("button", { name: "Inativar", exact: true }).click();
    await expect(page.getByText("Categoria inativada")).toBeVisible();
    await gotoCash(page, range(y));
    await openNew(page, "+ Despesa");
    await expect(
      dialog(page)
        .getByLabel("Categoria")
        .locator("option", { hasText: `${tk} Usada` }),
    ).toHaveCount(0);
  });

  test("categorias de sistema: sem excluir/renomear; Compra de produtos sem inativar", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/caixa/categorias");
    await page.waitForLoadState("networkidle");
    const opening = li(page, "Saldo inicial / aporte");
    await expect(opening.getByText("Sistema", { exact: true })).toBeVisible();
    await expect(opening.getByRole("button", { name: "Excluir" })).toBeDisabled();
    await expect(opening.getByRole("button", { name: "Renomear" })).toBeDisabled();
    await expect(opening.getByRole("button", { name: "Inativar" })).toBeEnabled();
    const purchase = li(page, "Compra de produtos");
    await expect(purchase.getByText("Sistema", { exact: true })).toBeVisible();
    await expect(purchase.getByRole("button", { name: "Excluir" })).toBeDisabled();
    await expect(purchase.getByRole("button", { name: "Renomear" })).toBeDisabled();
    await expect(purchase.getByRole("button", { name: "Inativar" })).toBeDisabled();
    await expect(purchase).toContainText("usada pelo sistema");
  });
});

// ================================================================= sessão

test.describe("sessão", () => {
  for (const route of ["/caixa", "/caixa/categorias", "/caixa?periodo=mes"]) {
    test(`sem sessão, ${route} redireciona para /login`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login/);
    });
  }

  test("sessão expirada: salvar lançamento leva ao /login sem erro do Next", async ({
    page,
    context,
  }, info) => {
    const y = year(info, 11);
    const tk = token();
    await login(page);
    await gotoCash(page, range(y));
    await openNew(page, "+ Despesa");
    await fillEntry(page, {
      value: "5",
      category: "Aluguel",
      when: `${y}-01-01T10:00`,
      desc: `${tk} semsessao`,
    });
    await context.clearCookies();
    await save(page);
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(/Application error|Unhandled/i)).toHaveCount(0);
    expect(dbNum("select count(*) from CashEntry where description = ?", `${tk} semsessao`)).toBe(
      0,
    );
  });

  test("sessão expirada: criar categoria leva ao /login", async ({ page, context }) => {
    const tk = token();
    await login(page);
    await page.goto("/caixa/categorias");
    await page.waitForLoadState("networkidle");
    await context.clearCookies();
    await addCategoryRaw(page, `${tk} Fantasma`);
    await expect(page).toHaveURL(/\/login/);
    expect(dbNum("select count(*) from CashCategory where name = ?", `${tk} Fantasma`)).toBe(0);
  });
});

async function addCategoryRaw(page: Page, name: string) {
  const form = page.getByRole("form", { name: "Nova categoria" });
  await form.getByLabel("Nome").fill(name);
  await form.getByRole("button", { name: "Adicionar categoria" }).click();
}

// ================================================================= layout

test("nome e descrição longos sem espaços não geram rolagem horizontal", async ({ page }, info) => {
  const y = year(info, 12);
  const tk = token();
  await login(page);
  const longName = `${tk}${"X".repeat(60 - tk.length)}`;
  const cat = seedCategory(longName, "OUT");
  const longCustomer = `${tk}${"Y".repeat(100)}`;
  seedEntry({
    dir: "OUT",
    cents: 123456789,
    cat,
    desc: "D".repeat(200),
    at: at(`${y}-01-01`),
    method: "CREDIT_CARD",
  });
  seedOrder(longCustomer, 5000, [{ cents: 5000, at: at(`${y}-01-02`) }]);
  await gotoCash(page, range(y));
  await expect(page.getByRole("region", { name: "Extrato" })).toContainText(longName);
  expect(await noHScroll(page)).toBe(true);
  await page.goto("/caixa/categorias");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(longName).first()).toBeVisible();
  expect(await noHScroll(page)).toBe(true);
});
