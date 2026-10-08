import { expect, test as base, type Page } from "@playwright/test";
import { dbRun, dialog, login, methodBtn, noHScroll, token } from "./orders-helpers";

// Capturas do fiado para inspeção visual. Só roda com VISUAL_DIR definido.
const DIR = process.env.VISUAL_DIR;
const test = base;
test.skip(!DIR, "defina VISUAL_DIR para capturar screenshots");

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

function seed(
  name: string,
  totals: { total: number; paid?: number; daysAgo: number }[],
  phone?: string,
) {
  const now = iso(Date.now());
  const cid = Number(
    dbRun(
      "insert into Customer (name, searchName, phone, active, createdAt, updatedAt) values (?, ?, ?, true, ?, ?)",
      name,
      name.toLowerCase(),
      phone ?? null,
      now,
      now,
    ),
  );
  const vid = Number(
    dbRun(
      "insert into Vehicle (customerId, type, plate, brand, model, active, createdAt, updatedAt) values (?, 'CAR', ?, 'Fiat', 'Uno', true, ?, ?)",
      cid,
      `${name.slice(2, 5).toUpperCase()}${Math.floor(1000 + Math.random() * 9000)}`,
      now,
      now,
    ),
  );
  for (const t of totals) {
    const at = iso(Date.now() - t.daysAgo * DAY);
    const oid = Number(
      dbRun(
        `insert into ServiceOrder (customerId, vehicleId, status, occurredAt, completedAt, discountCents, totalCents, paidCents, createdAt, updatedAt)
         values (?, ?, 'DONE', ?, ?, 0, ?, ?, ?, ?)`,
        cid,
        vid,
        at,
        at,
        t.total,
        t.paid ?? 0,
        now,
        now,
      ),
    );
    dbRun(
      `insert into ServiceOrderItem (orderId, kind, description, quantity, unitPriceCents, totalCents) values (?, 'SERVICE', 'Lavagem completa', 1, ?, ?)`,
      oid,
      t.total,
      t.total,
    );
    if (t.paid)
      dbRun(
        `insert into CashEntry (direction, amountCents, method, serviceOrderId, occurredAt, createdAt, updatedAt) values ('IN', ?, 'PIX', ?, ?, ?, ?)`,
        t.paid,
        oid,
        at,
        now,
        now,
      );
  }
  return cid;
}

const shot = (page: Page, p: string, name: string) =>
  page.screenshot({ path: `${DIR}/${p}-${name}.png`, fullPage: true });

test("capturas do fiado", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const p = testInfo.project.name;
  await login(page);
  const tk = token();
  const longName = `${tk}${"Clientelongosemespaco".repeat(5)}`;
  const a = seed(
    `${tk} Ana Souza`,
    [
      { total: 5000, daysAgo: 30 },
      { total: 8000, daysAgo: 10 },
    ],
    "31988887777",
  );
  seed(`${tk} Bruno Lima`, [{ total: 123456, paid: 20000, daysAgo: 3 }], "31977776666");
  seed(longName, [{ total: 99999, daysAgo: 1 }]);
  seed(`${tk} Carla Dias`, [{ total: 2500, daysAgo: 60 }]);

  await page.goto(`/fiado?q=${tk}`);
  await page.waitForLoadState("networkidle");
  expect(await noHScroll(page)).toBe(true);
  await shot(page, p, "fiado-lista");

  await page.goto(`/fiado?q=${tk}nada`);
  await shot(page, p, "fiado-vazio-busca");

  await page.goto("/fiado");
  await page.waitForLoadState("networkidle");
  await shot(page, p, "fiado-sem-busca");

  await page.goto(`/fiado?q=${tk}&receber=${a}`);
  await page.waitForLoadState("networkidle");
  await dialog(page).getByLabel("Valor a receber").fill("100");
  await methodBtn(page, "Pix").click();
  await page.screenshot({ path: `${DIR}/${p}-dialogo-previa.png` });
  await dialog(page).getByLabel("Valor a receber").fill("500");
  await page.screenshot({ path: `${DIR}/${p}-dialogo-erro.png` });
  expect(await noHScroll(page)).toBe(true);

  await page.goto(`/clientes/${a}`);
  await page.waitForLoadState("networkidle");
  await shot(page, p, "cliente-saldo");
  expect(await noHScroll(page)).toBe(true);

  await page.goto(`/atendimentos/novo?q=${tk}`);
  await shot(page, p, "novo-busca-devedor");
  await page.goto(`/atendimentos/novo?cliente=${a}`);
  await page.waitForLoadState("networkidle");
  await shot(page, p, "novo-faixa-devedor");
  expect(await noHScroll(page)).toBe(true);

  await page.goto("/");
  await shot(page, p, "inicio");
});
