import { expect, test as base, type Page } from "@playwright/test";
import { dbNum, dbRun, dialog, login, noHScroll, token } from "./orders-helpers";

// Capturas do caixa para inspeção visual. Só roda com VISUAL_DIR definido.
const DIR = process.env.VISUAL_DIR;
const test = base;
test.skip(!DIR, "defina VISUAL_DIR para capturar screenshots");

const iso = (d: Date) => d.toISOString();
const at = (ymd: string, hm = "12:00") => iso(new Date(`${ymd}T${hm}:00.000-03:00`));
const cat = (name: string, dir: "IN" | "OUT") =>
  dbNum("select id from CashCategory where name = ? and direction = ?", name, dir);

function entry(o: {
  dir: "IN" | "OUT";
  cents: number;
  at: string;
  method?: string;
  cat?: number | null;
  desc?: string | null;
  orderId?: number | null;
}) {
  const now = iso(new Date());
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

function order(customer: string, total: number, paid: number, when: string) {
  const now = iso(new Date());
  const cid = Number(
    dbRun(
      "insert into Customer (name, searchName, active, createdAt, updatedAt) values (?, ?, true, ?, ?)",
      customer,
      customer.toLowerCase(),
      now,
      now,
    ),
  );
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
    `insert into ServiceOrderItem (orderId, kind, description, quantity, unitPriceCents, totalCents) values (?, 'SERVICE', 'Lavagem completa', 1, ?, ?)`,
    oid,
    total,
    total,
  );
  if (paid) entry({ dir: "IN", cents: paid, method: "PIX", at: when, orderId: oid });
  return oid;
}

async function shot(page: Page, name: string, full = true) {
  const w = page.viewportSize()!.width;
  await page.screenshot({ path: `${DIR}/caixa-${name}-${w}.png`, fullPage: full });
}

const go = async (page: Page, url: string) => {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
};

test("caixa: telas com dados, vazio, saldo negativo, bloqueado e formulários", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const mobile = info.project.name === "mobile";
  const y = mobile ? 1961 : 1960;
  await login(page);
  const tk = token();

  const rent = cat("Aluguel", "OUT");
  const buy = cat("Compra de produtos", "OUT");
  const open = cat("Saldo inicial / aporte", "IN");
  const other = cat("Outras entradas", "IN");
  entry({
    dir: "IN",
    cents: 150000,
    cat: open,
    method: "CASH",
    desc: "Abertura do caixa",
    at: at(`${y}-03-01`, "08:00"),
  });
  entry({
    dir: "OUT",
    cents: 45000,
    cat: rent,
    method: "PIX",
    desc: "Aluguel do galpão",
    at: at(`${y}-03-02`, "09:00"),
  });
  entry({
    dir: "OUT",
    cents: 12890,
    cat: buy,
    method: "DEBIT_CARD",
    desc: "Shampoo automotivo 20L e cera",
    at: at(`${y}-03-02`, "15:10"),
  });
  entry({
    dir: "IN",
    cents: 3500,
    cat: other,
    method: "CASH",
    desc: "Venda de aromatizante",
    at: at(`${y}-03-03`, "11:00"),
  });
  order(`${tk} Maria Aparecida dos Santos`, 12000, 12000, at(`${y}-03-03`, "10:00"));
  order(`${tk} João`, 8000, 3000, at(`${y}-03-03`, "16:00"));
  const range = `?periodo=personalizado&de=${y}-03-01&ate=${y}-03-31`;

  await go(page, `/caixa${range}`);
  await shot(page, "dados");
  await shot(page, "dados-topo", false);
  expect(await noHScroll(page)).toBe(true);

  // filtro sem resultados e dia vazio
  await go(page, `/caixa${range}&q=zzzz`);
  await shot(page, "filtro-vazio");
  await go(page, `/caixa?data=1950-01-01`);
  await shot(page, "vazio");

  // saldo negativo (ano próprio, saída gigante apagada em seguida)
  const bad = entry({
    dir: "OUT",
    cents: 70_000_000,
    cat: rent,
    desc: "Compra enorme",
    at: at(`${y - 5}-01-01`),
  });
  try {
    await go(page, `/caixa?periodo=personalizado&de=${y - 5}-01-01&ate=${y - 5}-12-31`);
    await shot(page, "negativo");
  } finally {
    dbRun("delete from CashEntry where id = ?", bad);
  }

  // formulários
  await go(page, `/caixa${range}`);
  await page.getByRole("button", { name: "+ Despesa", exact: true }).click();
  await expect(dialog(page)).toBeVisible();
  await shot(page, "form-despesa-vazio", false);
  await dialog(page).getByRole("button", { name: "Salvar lançamento", exact: true }).click();
  await expect(dialog(page).getByText("Informe o valor")).toBeVisible();
  await shot(page, "form-despesa-erros", false);
  await dialog(page).getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.getByRole("button", { name: "Saldo inicial", exact: true }).click();
  await dialog(page).getByLabel("Valor", { exact: true }).fill("0");
  await dialog(page).getByRole("button", { name: "Salvar lançamento", exact: true }).click();
  await expect(dialog(page).getByText("O valor deve ser maior que zero")).toBeVisible();
  await shot(page, "form-saldo-erros", false);
  await dialog(page).getByRole("button", { name: "Cancelar", exact: true }).click();

  // edição de um lançamento
  await page.getByRole("button", { name: "Editar" }).first().click();
  await expect(dialog(page)).toBeVisible();
  await shot(page, "form-editar", false);
  await dialog(page).getByRole("button", { name: "Cancelar", exact: true }).click();

  // categorias
  await go(page, "/caixa/categorias");
  await shot(page, "categorias");

  // FAB: rolagem até o fim da página (não deve cobrir o último cartão nem o menu)
  await go(page, `/caixa${range}`);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await shot(page, "fim-da-pagina", false);
});
