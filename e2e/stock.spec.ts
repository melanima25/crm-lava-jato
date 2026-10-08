import type { Page, TestInfo } from "@playwright/test";
import {
  brl,
  completeWith,
  createOrderQuick,
  createService,
  dbAll,
  dbNum,
  dbRun,
  dbRunMany,
  dialog,
  expect,
  gotoReady,
  listRow,
  login,
  noHScroll,
  test,
  token,
  typeSearch,
  waitHydrated,
} from "./orders-helpers";

// Entrega 8: produtos e estoque. O banco é compartilhado entre testes/projetos em paralelo: cada teste
// cria produtos com nome único (token) e assere pela linha do próprio produto; datas de compra no
// caixa usam um ANO exclusivo por teste/projeto (1960..1979) para isolar o caixa.

const iso = (d: Date) => d.toISOString();
const year = (info: TestInfo, idx: number) =>
  1960 + idx + (info.project.name === "mobile" ? 10 : 0) - info.repeatEachIndex * 20;

const MINUS = "−";

// ---------------------------------------------------------------- seeds / leitura (SQL)

function seedProduct(o: {
  name: string;
  qty?: number;
  min?: number | null;
  active?: boolean;
  unit?: string;
  at?: string;
}): number {
  const now = iso(new Date());
  const qty = o.qty ?? 0;
  const id = Number(
    dbRun(
      `insert into Product (name, searchName, unit, stockQuantity, minStockQuantity, active, createdAt, updatedAt)
       values (?, ?, ?, ?, ?, ${o.active === false ? "false" : "true"}, ?, ?)`,
      o.name,
      o.name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(),
      o.unit ?? "un",
      qty,
      o.min ?? null,
      now,
      now,
    ),
  );
  if (qty !== 0)
    seedMovement(id, "IN", qty, "Estoque inicial semeado", o.at ?? "2000-01-01T12:00:00.000Z");
  return id;
}

function seedMovement(
  productId: number,
  type: "IN" | "OUT" | "ADJUSTMENT" | "SALE",
  quantity: number,
  reason: string | null,
  at: string,
  extra: { cashEntryId?: number | null; itemId?: number | null } = {},
): number {
  return Number(
    dbRun(
      `insert into StockMovement (productId, type, quantity, reason, cashEntryId, serviceOrderItemId, occurredAt, createdAt)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
      productId,
      type,
      quantity,
      reason,
      extra.cashEntryId ?? null,
      extra.itemId ?? null,
      at,
      iso(new Date()),
    ),
  );
}

const pid = (name: string) => dbNum("select id from Product where name = ?", name);
const cachedQty = (id: number) => dbNum("select stockQuantity from Product where id = ?", id);
const sumQty = (id: number) =>
  dbNum("select coalesce(sum(quantity), 0) from StockMovement where productId = ?", id);
const movCount = (id: number) =>
  dbNum("select count(*) from StockMovement where productId = ?", id);
/** Produtos cujo cache difere da soma das movimentações (0 = invariante OK; leitura atômica). */
const invariantViolations = (id: number) => Number(cachedQty(id) !== sumQty(id));

// ---------------------------------------------------------------- UI

const rowsVisible = (page: Page) => page.locator("[data-testid=stock-row]:visible");
const movRows = (page: Page) => page.getByTestId("movement-row");

async function createProductUI(page: Page, d: { name: string; min?: string; unit?: string }) {
  await gotoReady(page, "/produtos/novo");
  await page.getByLabel("Nome", { exact: true }).fill(d.name);
  if (d.unit !== undefined) await page.getByLabel("Unidade").fill(d.unit);
  if (d.min !== undefined) await page.locator("#product-min-stock").fill(d.min);
  await page.getByRole("button", { name: "Cadastrar produto" }).click();
  await expect(page.getByText("Produto cadastrado")).toBeVisible();
  await expect(page).toHaveURL(/\/produtos$/);
  return pid(d.name);
}

async function gotoProduct(page: Page, id: number, qs = "") {
  await gotoReady(page, `/estoque/${id}${qs}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

type Kind = "Entrada" | "Baixa" | "Acertar inventário";
async function openDialog(page: Page, kind: Kind, name: string) {
  const b = page.getByRole("button", { name: `${kind} de ${name}`, exact: true }).first();
  await waitHydrated(b);
  await b.click();
  await expect(dialog(page)).toBeVisible();
}

const qtyField = (page: Page, label = "Quantidade") =>
  dialog(page).getByLabel(label, { exact: true });
const confirm = (page: Page, label: string) =>
  dialog(page).getByRole("button", { name: label, exact: true });

type Fill = {
  qty?: string;
  reason?: string;
  when?: string;
  purchase?: { value?: string; method?: string } | false;
};
async function fillDialog(page: Page, kind: Kind, f: Fill) {
  const dlg = dialog(page);
  if (f.qty !== undefined)
    await qtyField(page, kind === "Acertar inventário" ? "Quantidade contada" : "Quantidade").fill(
      f.qty,
    );
  if (f.reason !== undefined) {
    await dlg
      .getByLabel(kind === "Baixa" ? "Motivo (obrigatório)" : "Motivo (opcional)")
      .fill(f.reason);
  }
  if (f.when !== undefined) await dlg.getByLabel("Data e hora").fill(f.when);
  if (f.purchase) {
    const sw = dlg.getByRole("switch", { name: "Lançar compra no caixa" });
    if ((await sw.getAttribute("aria-checked")) !== "true") await sw.click();
    if (f.purchase.value !== undefined)
      await dlg.getByLabel("Valor total da compra").fill(f.purchase.value);
    if (f.purchase.method)
      await dlg.getByRole("button", { name: f.purchase.method, exact: true }).click();
  }
}

/** Abre, preenche, confirma e espera o diálogo fechar com o toast de sucesso. */
async function doMove(page: Page, kind: Kind, name: string, f: Fill, toast: string | RegExp) {
  await openDialog(page, kind, name);
  await fillDialog(page, kind, f);
  const label =
    kind === "Entrada"
      ? "Registrar entrada"
      : kind === "Baixa"
        ? "Registrar baixa"
        : "Acertar estoque";
  await confirm(page, label).click();
  await expect(page.getByText(toast).first()).toBeVisible();
  await expect(dialog(page)).toBeHidden();
}

const closeDialog = async (page: Page) => {
  await confirm(page, "Cancelar").click();
  await expect(dialog(page)).toBeHidden();
};

async function searchStock(page: Page, q: string, qs = "") {
  await gotoReady(page, `/estoque${qs}`);
  await typeSearch(page, page.getByRole("searchbox", { name: "Buscar produto por nome" }), q);
}

const deltas = async (page: Page) =>
  (await page.getByTestId("movement-delta").allInnerTexts()).map((t) => t.trim());

// ================================================================= fluxo principal (critérios 1, 3, 4)

test.describe("fluxo principal", () => {
  test("cadastrar -> entrada 10 com compra -> baixa 3 -> acerto para 5: histórico, saldos e despesa bloqueada", async ({
    page,
  }, info) => {
    const y = year(info, 0);
    const name = `${token()} Cera`;
    await login(page);
    const id = await createProductUI(page, { name });
    expect(cachedQty(id)).toBe(0);

    await gotoProduct(page, id);
    await expect(page.getByText(/Nenhuma movimentação ainda/)).toBeVisible();

    await doMove(
      page,
      "Entrada",
      name,
      {
        qty: "10",
        reason: "Compra atacado",
        when: `${y}-03-10T10:00`,
        purchase: { value: "85,50", method: "Pix" },
      },
      "Entrada de 10 un registrada. Estoque atual: 10 un",
    );
    await doMove(
      page,
      "Baixa",
      name,
      { qty: "3", reason: "Uso em serviço" },
      "Baixa de 3 un registrada. Estoque atual: 7 un",
    );
    await doMove(
      page,
      "Acertar inventário",
      name,
      { qty: "5" },
      "Inventário acertado. Estoque atual: 5 un",
    );

    // histórico: mais recente primeiro; deltas e saldos
    await expect(movRows(page)).toHaveCount(3);
    expect(await deltas(page)).toEqual([`${MINUS}2`, `${MINUS}3`, "+10"]);
    await expect(movRows(page).nth(0)).toHaveAttribute("data-type", "ADJUSTMENT");
    await expect(movRows(page).nth(1)).toHaveAttribute("data-type", "OUT");
    await expect(movRows(page).nth(2)).toHaveAttribute("data-type", "IN");
    await expect(movRows(page).nth(0)).toContainText("Saldo: 5");
    await expect(movRows(page).nth(1)).toContainText("Saldo: 7");
    await expect(movRows(page).nth(2)).toContainText("Saldo: 10");
    await expect(page.getByTestId("stock-quantity").first()).toHaveText(/^5\s*un/);
    await expect(movRows(page).nth(2)).toContainText(brl(8550));
    await expect(movRows(page).nth(2)).toContainText("Pix");

    // banco: cache = soma; despesa OUT ligada, categoria de sistema, data da entrada
    expect(cachedQty(id)).toBe(5);
    expect(sumQty(id)).toBe(5);
    const ce = dbAll(
      `select c.direction, c.amountCents, c.method, c.occurredAt, cat.name as cat
         from StockMovement m join CashEntry c on c.id = m.cashEntryId left join CashCategory cat on cat.id = c.categoryId
        where m.productId = ? and m.type = 'IN'`,
      id,
    );
    expect(ce).toHaveLength(1);
    expect(ce[0]).toMatchObject({
      direction: "OUT",
      amountCents: 8550,
      method: "PIX",
      cat: "Compra de produtos",
    });
    expect(String(ce[0].occurredAt)).toContain(`${y}-03-10`);
    expect(invariantViolations(id)).toBe(0);

    // /estoque: quantidade na lista
    await searchStock(page, name);
    await expect(rowsVisible(page)).toHaveCount(1);
    await expect(rowsVisible(page).getByTestId("stock-quantity")).toHaveText(/^5\s*un/);

    // caixa no dia da compra: saída "Compra de produtos", bloqueada com o motivo
    await gotoReady(page, `/caixa?data=${y}-03-10`);
    await page.waitForLoadState("networkidle");
    const row = listRow(page, name);
    await expect(row).toBeVisible();
    await expect(row).toContainText("Compra de produtos");
    await expect(row).toContainText(brl(8550));
    await expect(row).toContainText(/movimentação do produto/);
    await expect(row.getByRole("button", { name: /Editar/ })).toHaveCount(0);
    await expect(row.getByRole("button", { name: /Excluir/ })).toHaveCount(0);
    await expect(row.locator("[data-direction=OUT]").first()).toBeVisible();
  });

  test("entrada SEM compra não cria lançamento no caixa", async ({ page }, info) => {
    const y = year(info, 1);
    const name = `${token()} SemCompra`;
    const id = seedProduct({ name });
    await login(page);
    await gotoProduct(page, id);
    await openDialog(page, "Entrada", name);
    await expect(dialog(page).getByText(/Sem esta opção o caixa não muda/)).toBeVisible();
    await closeDialog(page);

    const before = dbNum(
      "select count(*) from CashEntry where occurredAt >= ? and occurredAt < ?",
      `${y}-01-01T00:00:00.000Z`,
      `${y + 1}-01-01T00:00:00.000Z`,
    );
    await doMove(
      page,
      "Entrada",
      name,
      { qty: "4", when: `${y}-05-05T09:00` },
      "Entrada de 4 un registrada. Estoque atual: 4 un",
    );
    expect(dbNum("select cashEntryId is null from StockMovement where productId = ?", id)).toBe(1);
    expect(
      dbNum(
        "select count(*) from CashEntry where occurredAt >= ? and occurredAt < ?",
        `${y}-01-01T00:00:00.000Z`,
        `${y + 1}-01-01T00:00:00.000Z`,
      ),
    ).toBe(before);
    await gotoReady(page, `/caixa?data=${y}-05-05`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(name)).toHaveCount(0);
    await expect(movCount(id)).toBe(1);
  });
});

// ================================================================= validações (critérios 2, 3)

test.describe("validações dos diálogos", () => {
  test("baixa: acima do saldo não confirma; sem motivo não confirma; limite Disponível", async ({
    page,
  }) => {
    const name = `${token()} Baixa`;
    const id = seedProduct({ name, qty: 4 });
    await login(page);
    await gotoProduct(page, id);
    await openDialog(page, "Baixa", name);
    await expect(dialog(page)).toContainText("Disponível: 4 un");
    const ok = confirm(page, "Registrar baixa");
    await qtyField(page).fill("1");
    await expect(ok).toBeDisabled(); // sem motivo
    await dialog(page).getByLabel("Motivo (obrigatório)").fill("   ");
    await expect(ok).toBeDisabled(); // só espaços
    await dialog(page).getByRole("button", { name: "Perda", exact: true }).click();
    await expect(dialog(page).getByLabel("Motivo (obrigatório)")).toHaveValue("Perda");
    await expect(ok).toBeEnabled();
    await qtyField(page).fill("5"); // > saldo
    await expect(ok).toBeDisabled();
    await qtyField(page).fill("4"); // = saldo é permitido
    await expect(ok).toBeEnabled();
    // + trava no limite
    await qtyField(page).fill("3");
    await dialog(page).getByRole("button", { name: "Aumentar quantidade" }).click();
    await expect(qtyField(page)).toHaveValue("4");
    await expect(dialog(page).getByRole("button", { name: "Aumentar quantidade" })).toBeDisabled();
    expect(movCount(id)).toBe(1);
  });

  test("baixa de produto zerado: sem estoque disponível", async ({ page }) => {
    const name = `${token()} Zerado`;
    const id = seedProduct({ name, qty: 0 });
    await login(page);
    await gotoProduct(page, id);
    await openDialog(page, "Baixa", name);
    await expect(dialog(page)).toContainText("Sem estoque disponível para baixa");
    await dialog(page).getByLabel("Motivo (obrigatório)").fill("x");
    await expect(confirm(page, "Registrar baixa")).toBeDisabled();
  });

  test("quantidade 0, negativa, vazia e decimal na entrada; data futura; valores da compra", async ({
    page,
  }) => {
    const name = `${token()} Entrada`;
    const id = seedProduct({ name });
    await login(page);
    await gotoProduct(page, id);
    await openDialog(page, "Entrada", name);
    const ok = confirm(page, "Registrar entrada");
    await expect(ok).toBeEnabled(); // padrão 1
    for (const v of ["0", "-3", ""]) {
      await qtyField(page).fill(v);
      await expect(ok, `qtd "${v}"`).toBeDisabled();
    }
    // decimal: NÃO pode virar outro número em silêncio ("2,5" → 25). O texto fica visível, avisa e bloqueia.
    for (const v of ["2,5", "2.5"]) {
      await qtyField(page).fill(v);
      await expect(qtyField(page), `qtd "${v}"`).toHaveValue(v);
      await expect(
        dialog(page).getByText("Use um número inteiro, sem vírgula nem ponto."),
      ).toBeVisible();
      await expect(ok, `qtd "${v}"`).toBeDisabled();
    }
    await qtyField(page).fill("1");
    await expect(
      dialog(page).getByText("Use um número inteiro, sem vírgula nem ponto."),
    ).toHaveCount(0);
    await expect(ok).toBeEnabled();

    // data futura
    const t = new Date(Date.now() + 3 * 86_400_000);
    const fut = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "America/Sao_Paulo",
      dateStyle: "short",
    }).format(t);
    await dialog(page).getByLabel("Data e hora").fill(`${fut}T10:00`);
    await expect(dialog(page).getByText(/não pode ser futura/)).toBeVisible();
    await expect(ok).toBeDisabled();
    await dialog(page).getByLabel("Data e hora").fill("2000-01-01T10:00");
    await expect(ok).toBeEnabled();

    // compra: sem valor/sem forma/zero/inválido
    const sw = dialog(page).getByRole("switch", { name: "Lançar compra no caixa" });
    await sw.click();
    await expect(ok).toBeDisabled(); // sem valor e sem forma
    const val = dialog(page).getByLabel("Valor total da compra");
    await val.fill("0");
    await expect(dialog(page).getByText("Informe um valor maior que zero")).toBeVisible();
    await dialog(page).getByRole("button", { name: "Pix", exact: true }).click();
    await expect(ok).toBeDisabled(); // forma ok, valor 0
    await val.fill("abc");
    await expect(ok).toBeDisabled();
    await val.fill("-5");
    await expect(ok).toBeDisabled();
    await val.fill("12,34");
    await expect(ok).toBeEnabled();
    await expect(dialog(page)).toContainText(/saída de R\$\s*12,34/);
    await val.fill("12,34");
    // sem forma de pagamento (reabre)
    await closeDialog(page);
    await openDialog(page, "Entrada", name);
    await dialog(page).getByRole("switch", { name: "Lançar compra no caixa" }).click();
    await dialog(page).getByLabel("Valor total da compra").fill("10");
    await expect(confirm(page, "Registrar entrada")).toBeDisabled(); // falta a forma
    expect(movCount(id)).toBe(0);
    expect(cachedQty(id)).toBe(0);
  });

  test("acerto: contagem igual recusada; maior (delta +); para 0; contagem negativa/vazia", async ({
    page,
  }) => {
    const name = `${token()} Acerto`;
    const id = seedProduct({ name, qty: 6 });
    await login(page);
    await gotoProduct(page, id);
    await openDialog(page, "Acertar inventário", name);
    const ok = confirm(page, "Acertar estoque");
    await expect(qtyField(page, "Quantidade contada")).toHaveValue("6");
    await expect(ok).toBeDisabled(); // igual ao saldo
    await expect(page.getByTestId("adjust-preview")).toContainText("nada a ajustar");
    for (const v of ["", "-1"]) {
      await qtyField(page, "Quantidade contada").fill(v);
      await expect(ok, `contagem "${v}"`).toBeDisabled();
    }
    await qtyField(page, "Quantidade contada").fill("9");
    await expect(page.getByTestId("adjust-preview")).toContainText("+3");
    await ok.click();
    await expect(page.getByText("Inventário acertado. Estoque atual: 9 un")).toBeVisible();
    await expect(dialog(page)).toBeHidden();
    await expect(movRows(page).first()).toHaveAttribute("data-type", "ADJUSTMENT");
    await expect(page.getByTestId("movement-delta").first()).toHaveText("+3");
    await expect(movRows(page).first()).toContainText("Saldo: 9");

    await doMove(
      page,
      "Acertar inventário",
      name,
      { qty: "0", reason: "Acabou" },
      "Inventário acertado. Estoque atual: 0 un",
    );
    await expect(page.getByTestId("movement-delta").first()).toHaveText(`${MINUS}9`);
    await expect(page.getByTestId("stock-quantity").first()).toHaveText(/^0\s*un/);
    expect(cachedQty(id)).toBe(0);
    expect(sumQty(id)).toBe(0);
    expect(invariantViolations(id)).toBe(0);
  });
});

// ================================================================= editar / excluir movimentações

test.describe("editar e excluir movimentações", () => {
  test("editar entrada: quantidade, motivo, remover e criar a compra no caixa", async ({
    page,
  }, info) => {
    const y = year(info, 2);
    const name = `${token()} Edicao`;
    const id = seedProduct({ name });
    await login(page);
    await gotoProduct(page, id);
    await doMove(
      page,
      "Entrada",
      name,
      {
        qty: "10",
        reason: "Original",
        when: `${y}-06-01T10:00`,
        purchase: { value: "50", method: "Dinheiro" },
      },
      "Entrada de 10 un registrada",
    );
    const entry = () =>
      dbAll("select id, cashEntryId from StockMovement where productId = ?", id)[0];
    const ceId = Number(entry().cashEntryId);
    expect(ceId).toBeGreaterThan(0);

    // editar quantidade e motivo (compra acompanha)
    await page.getByRole("button", { name: "Editar movimentação" }).click();
    await expect(dialog(page).getByRole("heading", { name: "Editar entrada" })).toBeVisible();
    await expect(dialog(page).getByLabel("Valor total da compra")).toHaveValue("50,00");
    await qtyField(page).fill("8");
    await dialog(page).getByLabel("Motivo (opcional)").fill("Corrigida");
    await confirm(page, "Salvar alterações").click();
    await expect(page.getByText("Movimentação atualizada. Estoque atual: 8 un")).toBeVisible();
    await expect(dialog(page)).toBeHidden();
    await expect(movRows(page).first()).toContainText("Corrigida");
    expect(cachedQty(id)).toBe(8);

    // remove a compra (switch off): despesa some
    await page.getByRole("button", { name: "Editar movimentação" }).click();
    await dialog(page).getByRole("switch", { name: "Lançar compra no caixa" }).click();
    await expect(dialog(page)).toContainText(
      "a despesa de compra vinculada será removida do caixa",
    );
    await confirm(page, "Salvar alterações").click();
    await expect(page.getByText("Movimentação atualizada").first()).toBeVisible();
    await expect(dialog(page)).toBeHidden();
    expect(dbNum("select count(*) from CashEntry where id = ?", ceId)).toBe(0);
    expect(dbNum("select cashEntryId is null from StockMovement where productId = ?", id)).toBe(1);

    // cria a compra na edição (Débito, R$ 20,00)
    await expect(movRows(page).first()).not.toContainText("Compra R$");
    await page.getByRole("button", { name: "Editar movimentação" }).click();
    await dialog(page).getByRole("switch", { name: "Lançar compra no caixa" }).click();
    await dialog(page).getByLabel("Valor total da compra").fill("20");
    await dialog(page).getByRole("button", { name: "Débito", exact: true }).click();
    await confirm(page, "Salvar alterações").click();
    await expect(page.getByText("Movimentação atualizada").first()).toBeVisible();
    await expect(dialog(page)).toBeHidden();
    const created = dbAll(
      `select c.direction, c.amountCents, c.method from StockMovement m join CashEntry c on c.id = m.cashEntryId where m.productId = ?`,
      id,
    );
    expect(created).toEqual([{ direction: "OUT", amountCents: 2000, method: "DEBIT_CARD" }]);
    expect(invariantViolations(id)).toBe(0);
  });

  test("excluir entrada com compra remove a despesa; recusa se o estoque ficaria negativo; editar idem", async ({
    page,
  }, info) => {
    const y = year(info, 3);
    const name = `${token()} Exclui`;
    const id = seedProduct({ name });
    await login(page);
    await gotoProduct(page, id);
    await doMove(
      page,
      "Entrada",
      name,
      { qty: "10", when: `${y}-07-01T10:00`, purchase: { value: "30", method: "Crédito" } },
      "Entrada de 10 un registrada",
    );
    await doMove(
      page,
      "Baixa",
      name,
      { qty: "6", reason: "Perda" },
      "Baixa de 6 un registrada. Estoque atual: 4 un",
    );

    // 1) editar a entrada para 5 deixaria -1 -> recusado, nada muda
    const entryRow = page.locator("[data-testid=movement-row][data-type=IN]").first();
    await entryRow.getByRole("button", { name: "Editar movimentação" }).click();
    await qtyField(page).fill("5");
    await confirm(page, "Salvar alterações").click();
    await expect(dialog(page).getByRole("alert")).toContainText("ficaria negativo");
    await closeDialog(page);
    expect(sumQty(id)).toBe(4);

    // 2) excluir a entrada deixaria -6 -> recusado (despesa permanece)
    await entryRow.getByRole("button", { name: "Excluir movimentação" }).click();
    await expect(
      dialog(page).getByRole("heading", { name: "Excluir movimentação?" }),
    ).toBeVisible();
    await expect(dialog(page)).toContainText("despesa também será removida do caixa");
    await confirm(page, "Excluir").click();
    await expect(dialog(page)).toContainText("ficaria negativo");
    await closeDialog(page);
    expect(movCount(id)).toBe(2);
    expect(dbNum("select count(*) from CashEntry where description like ?", `%${name}%`)).toBe(1);

    // 3) exclui a baixa (saldo volta a 10) e depois a entrada com compra
    const outRow = movRows(page).filter({ hasText: "Perda" }).first();
    await outRow.getByRole("button", { name: "Excluir movimentação" }).click();
    await confirm(page, "Excluir").click();
    await expect(page.getByText("Movimentação excluída. Estoque atual: 10")).toBeVisible();
    await expect(dialog(page)).toBeHidden();
    expect(cachedQty(id)).toBe(10);
    await expect(movRows(page)).toHaveCount(1);

    await page.getByRole("button", { name: "Excluir movimentação" }).click();
    await confirm(page, "Excluir").click();
    await expect(
      page.getByText(/Movimentação excluída e compra removida do caixa\. Estoque atual: 0/),
    ).toBeVisible();
    await expect(dialog(page)).toBeHidden();
    expect(movCount(id)).toBe(0);
    expect(cachedQty(id)).toBe(0);
    expect(dbNum("select count(*) from CashEntry where description like ?", `%${name}%`)).toBe(0);
    await gotoReady(page, `/caixa?data=${y}-07-01`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(name)).toHaveCount(0);
    expect(invariantViolations(id)).toBe(0);
  });
});

// ================================================================= produtos (exclusão, inativo, mínimo)

test.describe("produto: exclusão, inativo e estoque mínimo", () => {
  test("produto com histórico não é excluído (sugere Inativar); sem movimentações pode", async ({
    page,
  }) => {
    const tk = token();
    const withHist = `${tk} ComHistorico`;
    const clean = `${tk} SemHistorico`;
    seedProduct({ name: withHist, qty: 3 });
    seedProduct({ name: clean });
    await login(page);

    await gotoReady(page, "/produtos");
    await typeSearch(
      page,
      page.getByRole("searchbox", { name: "Buscar produto por nome" }),
      withHist,
    );
    await page.locator(`button[aria-label="Excluir ${withHist}"]:visible`).click();
    await dialog(page).getByRole("button", { name: "Excluir definitivamente" }).click();
    await expect(dialog(page)).toContainText(/Inativar/);
    await closeDialog(page);
    expect(pid(withHist)).toBeGreaterThan(0);

    await typeSearch(page, page.getByRole("searchbox", { name: "Buscar produto por nome" }), clean);
    await page.locator(`button[aria-label="Excluir ${clean}"]:visible`).click();
    await dialog(page).getByRole("button", { name: "Excluir definitivamente" }).click();
    await expect(page.getByText("Produto excluído")).toBeVisible();
    expect(pid(clean)).toBe(0);
  });

  test("produto inativo: entrada/baixa desabilitadas, acerto permitido", async ({ page }) => {
    const name = `${token()} Inativo`;
    const id = seedProduct({ name, qty: 5, active: false });
    await login(page);
    await gotoProduct(page, id);
    await expect(page.getByText("Produto inativo: entrada e baixa estão bloqueadas")).toBeVisible();
    await expect(
      page.getByRole("button", { name: `Entrada de ${name}`, exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: `Baixa de ${name}`, exact: true }),
    ).toBeDisabled();
    await doMove(
      page,
      "Acertar inventário",
      name,
      { qty: "7", reason: "Contagem" },
      "Inventário acertado. Estoque atual: 7 un",
    );
    expect(cachedQty(id)).toBe(7);
    // lista: inativo só com ?inativos=1; botões desabilitados também lá
    await searchStock(page, name, "?inativos=1");
    await expect(rowsVisible(page)).toHaveCount(1);
    await expect(
      rowsVisible(page).getByRole("button", { name: `Entrada de ${name}` }),
    ).toBeDisabled();
    await gotoReady(page, "/estoque");
    await typeSearch(page, page.getByRole("searchbox", { name: "Buscar produto por nome" }), name);
    await expect(page.getByText(`Nenhum resultado para “${name}”`)).toBeVisible();
  });

  test("estoque mínimo: selo, filtro, card do Início, mínimo 0 e limpar mínimo", async ({
    page,
  }) => {
    const name = `${token()} Minimo`;
    const id = seedProduct({ name, qty: 6 });
    await login(page);

    // sem mínimo: sem selo
    await searchStock(page, name);
    await expect(rowsVisible(page)).toHaveCount(1);
    await expect(rowsVisible(page).getByText("Estoque baixo")).toHaveCount(0);

    // define mínimo 6 no cadastro -> selo (6 <= 6)
    await gotoReady(page, `/produtos/${id}/editar`);
    await page.locator("#product-min-stock").fill("6");
    await page.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(page).toHaveURL(/\/produtos$/);
    expect(dbNum("select minStockQuantity from Product where id = ?", id)).toBe(6);
    await searchStock(page, name);
    await expect(rowsVisible(page).getByText("Estoque baixo")).toBeVisible();
    await expect(rowsVisible(page)).toContainText("6 un");

    // filtro "Só estoque baixo" / ?baixo=1 (preserva q)
    await page.getByRole("checkbox", { name: "Só estoque baixo" }).click();
    await expect(page).toHaveURL(/baixo=1/);
    await expect(page).toHaveURL(/q=/);
    await expect(rowsVisible(page)).toHaveCount(1);
    await gotoReady(page, `/estoque?baixo=1&q=${encodeURIComponent(name)}`);
    await expect(rowsVisible(page)).toHaveCount(1);
    await expect(page.getByRole("checkbox", { name: "Só estoque baixo" })).toBeChecked();

    // card do Início: presença/coerência (global)
    await gotoReady(page, "/");
    const card = page.getByTestId("home-estoque");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Estoque baixo");
    await expect(card).toHaveAttribute("href", "/estoque?baixo=1");

    // mínimo 0: só alerta quando zera
    await gotoReady(page, `/produtos/${id}/editar`);
    await page.locator("#product-min-stock").fill("0");
    await page.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(page).toHaveURL(/\/produtos$/);
    await searchStock(page, name);
    await expect(rowsVisible(page).getByText("Estoque baixo")).toHaveCount(0);
    await gotoProduct(page, id);
    await doMove(
      page,
      "Baixa",
      name,
      { qty: "6", reason: "Perda" },
      "Baixa de 6 un registrada. Estoque atual: 0 un",
    );
    await expect(page.getByText("Estoque baixo")).toBeVisible();
    await searchStock(page, name, "?baixo=1");
    await expect(rowsVisible(page)).toHaveCount(1);

    // limpar o mínimo remove o alerta
    await gotoReady(page, `/produtos/${id}/editar`);
    await page.locator("#product-min-stock").fill("");
    await page.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(page).toHaveURL(/\/produtos$/);
    expect(dbAll("select minStockQuantity as m from Product where id = ?", id)[0].m).toBeNull();
    await searchStock(page, name, "?baixo=1");
    await expect(page.getByText("Nenhum resultado para")).toBeVisible();
    await searchStock(page, name);
    await expect(rowsVisible(page)).toHaveCount(1);
    await expect(rowsVisible(page).getByText("Estoque baixo")).toHaveCount(0);
  });

  test("estoque mínimo inválido no cadastro é recusado", async ({ page }) => {
    await login(page);
    await gotoReady(page, "/produtos/novo");
    await page.getByLabel("Nome", { exact: true }).fill(`${token()} MinInvalido`);
    await page.locator("#product-min-stock").fill("-2");
    await page.getByRole("button", { name: "Cadastrar produto" }).click();
    await expect(page).toHaveURL(/\/produtos\/novo$/);
    await expect(page.locator("#product-min-stock-error, [role=alert]").first()).toBeVisible();
  });
});

// ================================================================= SALE (critério 6) e invariante (critério 1)

test.describe("SALE e invariante", () => {
  test("movimentação SALE aparece com link da OS, cadeado e sem Editar/Excluir", async ({
    page,
  }) => {
    const name = `${token()} Venda`;
    const id = seedProduct({ name, qty: 10 });
    const now = iso(new Date());
    const cid = Number(
      dbRun(
        "insert into Customer (name, searchName, active, createdAt, updatedAt) values (?, ?, true, ?, ?)",
        `${name} Cliente`,
        `${name} cliente`.toLowerCase(),
        now,
        now,
      ),
    );
    const oid = Number(
      dbRun(
        `insert into ServiceOrder (customerId, status, occurredAt, completedAt, discountCents, totalCents, paidCents, createdAt, updatedAt)
         values (?, 'DONE', ?, ?, 0, 5000, 0, ?, ?)`,
        cid,
        now,
        now,
        now,
        now,
      ),
    );
    const itemId = Number(
      dbRun(
        `insert into ServiceOrderItem (orderId, kind, productId, description, quantity, unitPriceCents, totalCents)
         values (?, 'PRODUCT', ?, ?, 2, 2500, 5000)`,
        oid,
        id,
        name,
      ),
    );
    seedMovement(id, "SALE", -2, null, now, { itemId });
    dbRun("update Product set stockQuantity = 8 where id = ?", id);

    await login(page);
    await gotoProduct(page, id);
    const sale = page.locator("[data-testid=movement-row][data-type=SALE]").first();
    await expect(sale).toBeVisible();
    await expect(sale.getByTestId("movement-delta")).toHaveText(`${MINUS}2`);
    await expect(sale).toContainText("Saldo: 8");
    const link = sale.getByRole("link", { name: `Venda — OS nº ${oid}` });
    await expect(link).toHaveAttribute("href", `/atendimentos/${oid}`);
    await expect(sale).toContainText(/venda de atendimento/);
    await expect(sale.getByRole("button", { name: /Editar/ })).toHaveCount(0);
    await expect(sale.getByRole("button", { name: /Excluir/ })).toHaveCount(0);
    // a entrada manual segue editável
    await expect(
      movRows(page)
        .filter({ hasText: "Estoque inicial" })
        .getByRole("button", { name: "Editar movimentação" }),
    ).toBeVisible();
    await expect(page.getByTestId("stock-quantity").first()).toHaveText(/^8\s*un/);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/atendimentos/${oid}$`));
  });

  test("estoque exibido = soma dos deltas do histórico, inclusive paginado (>30 movimentos)", async ({
    page,
  }) => {
    const name = `${token()} Paginado`;
    const id = seedProduct({ name });
    const rows: unknown[][] = [];
    let total = 0;
    for (let i = 0; i < 35; i++) {
      const type = i % 5 === 4 ? "OUT" : "IN";
      const q = type === "IN" ? 3 + (i % 4) : -2;
      total += q;
      const day = String(1 + i).padStart(2, "0");
      rows.push([
        id,
        type,
        q,
        `mov ${i}`,
        null,
        null,
        `1999-02-${day <= "28" ? day : "28"}T${String(8 + (i % 10)).padStart(2, "0")}:00:00.000Z`,
        iso(new Date()),
      ]);
    }
    dbRunMany(
      `insert into StockMovement (productId, type, quantity, reason, cashEntryId, serviceOrderItemId, occurredAt, createdAt)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
      rows,
    );
    dbRun("update Product set stockQuantity = ? where id = ?", total, id);
    expect(sumQty(id)).toBe(total);

    await login(page);
    await gotoProduct(page, id);
    await expect(page.getByText("Página 1 de 2")).toBeVisible();
    await expect(movRows(page)).toHaveCount(30);
    const p1 = await deltas(page);
    await page.getByRole("link", { name: "Próxima" }).click();
    await expect(page).toHaveURL(/pagina=2/);
    await expect(page.getByText("Página 2 de 2")).toBeVisible();
    await expect(movRows(page)).toHaveCount(5);
    const p2 = await deltas(page);
    const num = (t: string) => Number(t.replace(MINUS, "-").replace("+", ""));
    const sum = [...p1, ...p2].map(num).reduce((a, b) => a + b, 0);
    expect(sum).toBe(total);
    // o saldo da movimentação mais recente (página 1, primeira) = estoque exibido
    await page.getByRole("link", { name: "Anterior" }).click();
    await expect(page.getByTestId("stock-quantity").first()).toHaveText(
      new RegExp(`^${total}\\s*un`),
    );
    await expect(movRows(page).first()).toContainText(`Saldo: ${total}`);
    // página fora do intervalo não quebra
    const res = await page.goto(`/estoque/${id}?pagina=99`);
    expect(res?.status()).toBeLessThan(500);
    expect(invariantViolations(id)).toBe(0);
  });
});

// ================================================================= busca, acesso, concorrência, layout

test.describe("busca, acesso e robustez", () => {
  test("busca por nome sem acento, caixa e curingas literais", async ({ page }) => {
    const tk = token();
    const name = `Cerâmica Líquida ${tk}`;
    seedProduct({ name: `Cerâmica Líquida ${tk}`, qty: 1 });
    await login(page);
    const box = page.getByRole("searchbox", { name: "Buscar produto por nome" });
    await gotoReady(page, "/estoque");
    await typeSearch(page, box, `ceramica liquida ${tk}`);
    await expect(rowsVisible(page)).toHaveCount(1);
    await expect(rowsVisible(page)).toContainText(name);
    await gotoReady(
      page,
      `/estoque?q=${encodeURIComponent(`CERÂMICA LÍQUIDA ${tk.toUpperCase()}`)}`,
    );
    await expect(rowsVisible(page)).toHaveCount(1);
    for (const wc of ["%", "_", "%%", "\\"]) {
      await gotoReady(page, `/estoque?q=${encodeURIComponent(wc)}`);
      await expect(page.getByText(/Nenhum resultado para/), `curinga ${wc}`).toBeVisible();
      await expect(rowsVisible(page)).toHaveCount(0);
    }
  });

  test("sem sessão: /estoque e /estoque/[id] vão ao /login", async ({ page }) => {
    const id = seedProduct({ name: `${token()} Anon`, qty: 1 });
    for (const url of ["/estoque", `/estoque/${id}`]) {
      await page.goto(url);
      await expect(page).toHaveURL(/\/login/);
    }
  });

  test("sessão expirada: entrada/baixa/acerto/exclusão levam ao /login sem erro do Next e sem gravar", async ({
    page,
    context,
  }) => {
    const name = `${token()} Sessao`;
    const id = seedProduct({ name, qty: 5 });
    await login(page);
    await gotoProduct(page, id);
    const attempts: [Kind, Fill, string][] = [
      ["Entrada", { qty: "2" }, "Registrar entrada"],
      ["Baixa", { qty: "1", reason: "x" }, "Registrar baixa"],
      ["Acertar inventário", { qty: "9" }, "Acertar estoque"],
    ];
    for (const [kind, f, label] of attempts) {
      await openDialog(page, kind, name);
      await fillDialog(page, kind, f);
      await context.clearCookies();
      await confirm(page, label).click();
      await expect(page).toHaveURL(/\/login/);
      await expect(page.getByText(/Application error|Unhandled/i)).toHaveCount(0);
      expect(movCount(id), kind).toBe(1);
      await login(page);
      await gotoProduct(page, id);
    }
    // exclusão
    await doMove(page, "Entrada", name, { qty: "1" }, "Entrada de 1 un registrada");
    await page.getByRole("button", { name: "Excluir movimentação" }).first().click();
    await context.clearCookies();
    await confirm(page, "Excluir").click();
    await expect(page).toHaveURL(/\/login/);
    expect(movCount(id)).toBe(2);
  });

  test("duplo clique em 'Registrar baixa' não gera 2 baixas", async ({ page }) => {
    const name = `${token()} Duplo`;
    const id = seedProduct({ name, qty: 6 });
    await login(page);
    await gotoProduct(page, id);
    await openDialog(page, "Baixa", name);
    await fillDialog(page, "Baixa", { qty: "3", reason: "Uso em serviço" });
    await confirm(page, "Registrar baixa")
      .dblclick({ delay: 10 })
      .catch(() => {});
    await expect(page.getByText("Baixa de 3 un registrada. Estoque atual: 3 un")).toBeVisible();
    await expect(dialog(page)).toBeHidden();
    await page.waitForTimeout(800);
    expect(
      dbNum("select count(*) from StockMovement where productId = ? and type = 'OUT'", id),
    ).toBe(1);
    expect(cachedQty(id)).toBe(3);
    expect(invariantViolations(id)).toBe(0);
  });

  test("duas abas com estado velho: a outra baixa o saldo -> erro do servidor, nada gravado", async ({
    page,
    context,
  }) => {
    const name = `${token()} Abas`;
    const id = seedProduct({ name, qty: 5 });
    await login(page);
    await gotoProduct(page, id);
    await openDialog(page, "Baixa", name);
    await fillDialog(page, "Baixa", { qty: "3", reason: "Aba A" });

    const b = await context.newPage();
    await gotoProduct(b, id);
    await doMove(
      b,
      "Baixa",
      name,
      { qty: "5", reason: "Aba B" },
      "Baixa de 5 un registrada. Estoque atual: 0 un",
    );
    await b.close();

    await confirm(page, "Registrar baixa").click();
    await expect(dialog(page).getByRole("alert")).toContainText(
      `Estoque insuficiente de “${name}”: disponível 0 un.`,
    );
    await expect(dialog(page)).toBeVisible();
    expect(movCount(id)).toBe(2);
    expect(cachedQty(id)).toBe(0);
    expect(invariantViolations(id)).toBe(0);
  });

  test("nomes e motivos longos sem espaços não geram rolagem horizontal", async ({ page }) => {
    const longName = `${token()}${"NomeMuitoLongo".repeat(10)}`.slice(0, 150);
    const id = seedProduct({ name: longName, qty: 3, min: 5 });
    const reason = "R".repeat(200);
    seedMovement(id, "OUT", -1, reason, "2001-01-01T10:00:00.000Z");
    dbRun("update Product set stockQuantity = 2 where id = ?", id);
    await login(page);
    for (const url of [
      `/estoque?q=${encodeURIComponent(longName.slice(0, 20))}`,
      `/estoque/${id}`,
    ]) {
      await gotoReady(page, url);
      expect(await noHScroll(page), url).toBe(true);
    }
    for (const kind of ["Entrada", "Baixa", "Acertar inventário"] as const) {
      await openDialog(page, kind, longName);
      expect(await noHScroll(page), kind).toBe(true);
      const box = await dialog(page).boundingBox();
      const vw = page.viewportSize()!.width;
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(vw + 1);
      await closeDialog(page);
    }
  });

  test("ids inexistentes ou inválidos mostram 404 amigável", async ({ page }) => {
    await login(page);
    for (const id of ["99999999", "abc", "0", "-1", "1.5"]) {
      const res = await page.goto(`/estoque/${id}`);
      expect(res?.status(), id).toBe(404);
      await expect(page.getByText(/não encontrad|404/i).first()).toBeVisible();
    }
  });
});

// ================================================================= regressão (critério 5)

test("serviço não altera estoque: concluir, pagar, estornar e cancelar atendimento só de serviços", async ({
  page,
}) => {
  const tk = token();
  const sentinelName = `${tk} Sentinela`;
  const sid = seedProduct({ name: sentinelName, qty: 7 });
  const snapshotProducts = () =>
    JSON.stringify(dbAll("select id, stockQuantity from Product where id = ? ", sid)) +
    movCount(sid);
  const before = snapshotProducts();

  await login(page);
  const svc = `${tk} Lavagem`;
  await createService(page, { name: svc, car: "100" });
  const oid = await createOrderQuick(page, { name: `${tk} Cliente`, services: [svc] });
  const forOrder = () =>
    dbNum(
      `select count(*) from StockMovement where serviceOrderItemId in (select id from ServiceOrderItem where orderId = ?)`,
      oid,
    );
  expect(forOrder()).toBe(0);

  await completeWith(page, "Pix"); // concluir + pagar
  expect(forOrder()).toBe(0);
  expect(snapshotProducts()).toBe(before);

  await page.getByRole("button", { name: "Estornar pagamento de R$ 100,00 em Pix" }).click();
  await dialog(page).getByRole("button", { name: "Estornar", exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  expect(forOrder()).toBe(0);

  await page.getByRole("button", { name: "Cancelar atendimento", exact: true }).click();
  await dialog(page).getByRole("button", { name: "Cancelar atendimento", exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  expect(forOrder()).toBe(0);
  expect(snapshotProducts()).toBe(before);
  expect(invariantViolations(sid)).toBe(0);
  // e pelo lado da tela: o produto segue com 7
  await gotoProduct(page, sid);
  await expect(page.getByTestId("stock-quantity").first()).toHaveText(/^7\s*un/);
});
