import type { Page } from "@playwright/test";
import {
  completeWith,
  confirmPayment,
  createService,
  dbNum,
  dbRun,
  dialog,
  expect,
  gotoReady,
  login,
  methodBtn,
  noHScroll,
  openComplete,
  orderIdFromUrl,
  test,
  tile,
  token,
} from "./orders-helpers";

// Entrega 9: venda de produto no atendimento com baixa automática do estoque (D-15).
// Banco compartilhado entre testes/projetos em paralelo: cada teste cria produtos com nome único (token)
// e confere o estoque pelo id do próprio produto.

// ---------------------------------------------------------------- seeds / leitura (SQL)

function seedProduct(o: { name: string; qty: number; price: number | null; unit?: string }) {
  const now = new Date().toISOString();
  const id = Number(
    dbRun(
      `insert into Product (name, searchName, unit, salePriceCents, stockQuantity, active, createdAt, updatedAt)
       values (?, ?, ?, ?, ?, true, ?, ?)`,
      o.name,
      o.name.toLowerCase(),
      o.unit ?? "un",
      o.price,
      o.qty,
      now,
      now,
    ),
  );
  if (o.qty > 0) {
    dbRun(
      `insert into StockMovement (productId, type, quantity, reason, occurredAt, createdAt)
       values (?, 'IN', ?, 'Estoque inicial semeado', '2000-01-01T12:00:00.000Z', ?)`,
      id,
      o.qty,
      now,
    );
  }
  return id;
}

const stockOf = (id: number) => dbNum("select stockQuantity from Product where id = ?", id);
const sumOf = (id: number) =>
  dbNum("select coalesce(sum(quantity), 0) from StockMovement where productId = ?", id);
const saleCount = (id: number) =>
  dbNum("select count(*) from StockMovement where productId = ? and type = 'SALE'", id);

/** Estoque (cache) e Σ movimentações, lidos juntos para comparar. */
async function expectStock(id: number, qty: number) {
  await expect.poll(() => stockOf(id)).toBe(qty);
  expect(sumOf(id)).toBe(qty);
}

// ---------------------------------------------------------------- UI

const productTile = (page: Page, name: string) =>
  page.getByRole("button", { name: `Adicionar ${name}`, exact: true });

const items = (page: Page) =>
  page.getByRole("list", { name: "Itens do atendimento" }).getByRole("listitem");

/** Cadastro rápido só com o nome do cliente (sem veículo). */
async function startQuickNoVehicle(page: Page, name: string) {
  await gotoReady(page, "/atendimentos/novo?rapido=1");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Nome", { exact: true }).fill(name);
}

async function pickProduct(page: Page, product: string, times = 1) {
  const row = page
    .getByRole("list", { name: "Produtos do atendimento" })
    .getByRole("listitem")
    .filter({ hasText: product });
  await expect(async () => {
    if (!(await row.count())) await productTile(page, product).click();
    await expect(row).toHaveCount(1, { timeout: 1500 });
  }).toPass({ timeout: 15_000 });
  for (let i = 1; i < times; i++) {
    await row.getByRole("button", { name: "Aumentar quantidade" }).click();
  }
  await expect(row.getByRole("group")).toContainText(String(times));
}

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("venda só de produto: sem veículo, conclui pago e baixa o estoque", async ({ page }) => {
  const product = `Oleo ${token()}`;
  const id = seedProduct({ name: product, qty: 10, price: 3000, unit: "frasco" });

  await startQuickNoVehicle(page, `Cliente ${token()}`);
  await expect(page.getByText("Opcional se for só venda de produtos.")).toBeVisible();
  await pickProduct(page, product, 2);
  await expect(page.getByTestId("order-total")).toContainText("60,00");
  await page.getByRole("button", { name: "Criar e concluir", exact: true }).click();
  await expect(dialog(page).getByRole("heading", { name: "Concluir e receber" })).toBeVisible();
  await methodBtn(page, "Dinheiro").click();
  await confirmPayment(page, "Concluir e receber");

  const orderId = await orderIdFromUrl(page);
  await expect(items(page).filter({ hasText: product })).toContainText("Produto");
  await expect(page.getByTestId("order-paid")).toContainText("60,00");
  await expectStock(id, 8);
  expect(saleCount(id)).toBe(1);
  expect(dbNum("select vehicleId is null from ServiceOrder where id = ?", orderId)).toBe(1);

  // Histórico do produto mostra a venda com link para a OS.
  await gotoReady(page, `/estoque/${id}`);
  const sale = page.getByRole("link", { name: `Venda — OS nº ${orderId}` });
  await expect(sale).toBeVisible();
  await expect(page.getByTestId("movement-row").filter({ hasText: "Venda" })).toContainText("−2");
  expect(await noHScroll(page)).toBe(true);
});

test("estoque insuficiente: aviso no atendimento, conclusão bloqueada e atalho para acertar", async ({
  page,
}) => {
  const product = `Cera ${token()}`;
  const id = seedProduct({ name: product, qty: 1, price: 2500 });

  await startQuickNoVehicle(page, `Cliente ${token()}`);
  await pickProduct(page, product, 2);
  await expect(page.getByText("insuficiente para concluir")).toBeVisible();
  await page.getByRole("button", { name: "Criar atendimento", exact: true }).click();
  const orderId = await orderIdFromUrl(page);

  await expect(page.getByTestId("stock-warning")).toContainText("Estoque atual: 1");
  await openComplete(page);
  await methodBtn(page, "Pix").click();
  await confirmPayment(page, "Concluir e receber");
  await expect(dialog(page).getByRole("alert")).toContainText(
    `Estoque insuficiente de “${product}”`,
  );
  // Nada foi gravado.
  expect(dbNum("select count(*) from ServiceOrder where id = ? and status = 'OPEN'", orderId)).toBe(
    1,
  );
  expect(dbNum("select count(*) from CashEntry where serviceOrderId = ?", orderId)).toBe(0);
  await expectStock(id, 1);

  await dialog(page).getByRole("link", { name: "Acertar inventário" }).click();
  await expect(page).toHaveURL(new RegExp(`/estoque/${id}\\?acertar=1$`));
  await expect(dialog(page).getByRole("heading", { name: "Acertar inventário" })).toBeVisible();
});

test("OS concluída: adicionar, alterar e remover produto mexem no estoque", async ({ page }) => {
  const service = `Lavagem ${token()}`;
  const product = `Aromatizante ${token()}`;
  const id = seedProduct({ name: product, qty: 5, price: 1500 });
  await createService(page, { name: service, car: "50,00" });

  await gotoReady(page, "/atendimentos/novo?rapido=1");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Nome", { exact: true }).fill(`Cliente ${token()}`);
  await page.getByRole("radio", { name: "Carro", exact: true }).click();
  await expect(async () => {
    const added = page
      .getByRole("list", { name: "Serviços do atendimento" })
      .getByRole("listitem")
      .filter({ hasText: service });
    if (!(await added.count())) await tile(page, service).click();
    await expect(added).toHaveCount(1, { timeout: 1500 });
  }).toPass({ timeout: 15_000 });
  await page.getByRole("button", { name: "Criar atendimento", exact: true }).click();
  await orderIdFromUrl(page);
  await completeWith(page, "Dinheiro");
  await expectStock(id, 5); // serviço não baixa estoque

  // Adicionar produto em OS concluída baixa na hora.
  await page.getByRole("button", { name: "Adicionar produto", exact: true }).click();
  await expect(dialog(page)).toContainText("sai do estoque na hora");
  await productTile(page, product).click();
  await expect(items(page).filter({ hasText: product })).toBeVisible();
  await expectStock(id, 4);

  // Alterar quantidade 1 → 3 ajusta pela diferença.
  await items(page)
    .filter({ hasText: product })
    .getByRole("button", { name: `Editar ${product}` })
    .click();
  await expect(dialog(page).getByRole("heading", { name: "Editar produto" })).toBeVisible();
  await dialog(page).getByRole("button", { name: "Aumentar quantidade" }).click();
  await dialog(page).getByRole("button", { name: "Aumentar quantidade" }).click();
  await dialog(page).getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  await expectStock(id, 2);

  // Remover devolve ao estoque.
  await items(page)
    .filter({ hasText: product })
    .getByRole("button", { name: `Remover ${product}` })
    .click();
  await expect(dialog(page).getByRole("heading", { name: "Remover produto?" })).toBeVisible();
  await expect(dialog(page)).toContainText("O produto volta ao estoque.");
  await dialog(page).getByRole("button", { name: "Remover", exact: true }).click();
  await expect(items(page).filter({ hasText: product })).toHaveCount(0);
  await expectStock(id, 5);
  expect(saleCount(id)).toBe(0);
});
