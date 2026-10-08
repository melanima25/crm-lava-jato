import { expect, test as base } from "@playwright/test";
import { dbRun, dialog, gotoReady, login, noHScroll, token } from "./orders-helpers";

// Capturas de estoque para inspeção visual. Só roda com VISUAL_DIR definido.
const DIR = process.env.VISUAL_DIR;
const test = base;
test.skip(!DIR, "defina VISUAL_DIR para capturar screenshots");

const iso = (d: Date) => d.toISOString();

function product(name: string, qty: number, min: number | null, active = true) {
  const now = iso(new Date());
  const id = Number(
    dbRun(
      `insert into Product (name, searchName, unit, stockQuantity, minStockQuantity, active, createdAt, updatedAt)
       values (?, ?, 'un', ?, ?, ${active ? "true" : "false"}, ?, ?)`,
      name,
      name.toLowerCase(),
      qty,
      min,
      now,
      now,
    ),
  );
  if (qty) move(id, "IN", qty, "Estoque inicial", "2000-01-01T12:00:00.000Z");
  return id;
}
function move(
  productId: number,
  type: string,
  q: number,
  reason: string | null,
  at: string,
  ce: number | null = null,
  item: number | null = null,
) {
  return Number(
    dbRun(
      `insert into StockMovement (productId, type, quantity, reason, cashEntryId, serviceOrderItemId, occurredAt, createdAt)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
      productId,
      type,
      q,
      reason,
      ce,
      item,
      at,
      iso(new Date()),
    ),
  );
}

test("capturas do estoque", async ({ page }, info) => {
  const tag = info.project.name;
  const shot = async (n: string, full = true) => {
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${DIR}/estoque-${tag}-${n}.png`, fullPage: full });
  };
  const tk = token();
  const now = new Date();
  const ago = (h: number) => iso(new Date(now.getTime() - h * 3600_000));

  const low = product(`${tk} Cera Liquida`, 0, 5);
  product(`${tk} Zerado Aromatizante`, 0, 3);
  product(`${tk} Shampoo Automotivo`, 30, 5);
  product(`${tk} Antigo Inativo`, 4, null, false);
  product(`${tk} ${"SemEspacoMuitoLongo".repeat(5)}`, 1, 2);

  // histórico variado no produto "low"
  const cust = Number(
    dbRun(
      "insert into Customer (name, searchName, active, createdAt, updatedAt) values (?, ?, true, ?, ?)",
      `${tk} Cliente`,
      `${tk} cliente`.toLowerCase(),
      iso(now),
      iso(now),
    ),
  );
  const oid = Number(
    dbRun(
      `insert into ServiceOrder (customerId, status, occurredAt, completedAt, discountCents, totalCents, paidCents, createdAt, updatedAt)
       values (?, 'DONE', ?, ?, 0, 4500, 0, ?, ?)`,
      cust,
      ago(30),
      ago(30),
      iso(now),
      iso(now),
    ),
  );
  const item = Number(
    dbRun(
      `insert into ServiceOrderItem (orderId, kind, productId, description, quantity, unitPriceCents, totalCents)
       values (?, 'PRODUCT', ?, 'Cera', 1, 4500, 4500)`,
      oid,
      low,
    ),
  );
  const ce = Number(
    dbRun(
      `insert into CashEntry (direction, amountCents, method, description, occurredAt, createdAt, updatedAt)
       values ('OUT', 12990, 'PIX', 'Compra de estoque', ?, ?, ?)`,
      ago(100),
      iso(now),
      iso(now),
    ),
  );
  move(low, "IN", 12, "Compra atacado", ago(100), ce);
  move(low, "OUT", -4, "Uso em serviço", ago(60));
  move(low, "SALE", -1, null, ago(30), null, item);
  move(low, "ADJUSTMENT", -5, "Contagem do mês", ago(5));
  dbRun("update Product set stockQuantity = 2 where id = ?", low);

  await login(page);

  await gotoReady(page, `/estoque?q=${tk}`);
  await expect(page.locator("[data-testid=stock-row]:visible").first()).toBeVisible();
  expect(await noHScroll(page)).toBe(true);
  await shot("lista");
  await gotoReady(page, `/estoque?baixo=1&q=${tk}`);
  await shot("lista-baixo");
  await gotoReady(page, `/estoque?q=${tk}zzzz`);
  await shot("lista-vazia");

  await gotoReady(page, `/estoque/${low}`);
  await expect(page.getByTestId("movement-row").first()).toBeVisible();
  expect(await noHScroll(page)).toBe(true);
  await shot("detalhe");

  const open = async (kind: string) => {
    await page
      .getByRole("button", { name: `${kind} de ${tk} Cera Liquida`, exact: true })
      .first()
      .click();
    await expect(dialog(page)).toBeVisible();
  };
  await open("Entrada");
  await dialog(page).getByLabel("Quantidade", { exact: true }).fill("10");
  await dialog(page).getByRole("switch", { name: "Lançar compra no caixa" }).click();
  await dialog(page).getByLabel("Valor total da compra").fill("150");
  await dialog(page).getByRole("button", { name: "Pix", exact: true }).click();
  await shot("dialogo-entrada", false);
  await dialog(page).getByRole("button", { name: "Cancelar" }).click();

  await open("Baixa");
  await dialog(page).getByLabel("Quantidade", { exact: true }).fill("2");
  await dialog(page).getByRole("button", { name: "Perda", exact: true }).click();
  // estado velho: o saldo cai a zero por fora e o servidor recusa
  move(low, "ADJUSTMENT", -2, "Outra aba", iso(new Date()));
  dbRun("update Product set stockQuantity = 0 where id = ?", low);
  await dialog(page).getByRole("button", { name: "Registrar baixa" }).click();
  await expect(dialog(page).getByRole("alert")).toBeVisible();
  await shot("dialogo-baixa-erro", false);
  await dialog(page).getByRole("button", { name: "Cancelar" }).click();

  await open("Acertar inventário");
  await dialog(page).getByLabel("Quantidade contada", { exact: true }).fill("9");
  await shot("dialogo-acerto", false);
  await dialog(page).getByRole("button", { name: "Cancelar" }).click();

  await gotoReady(page, "/");
  await shot("inicio", false);
});
