import {
  typeSearch,
  badge,
  completeWith,
  createOrderQuick,
  createService,
  dialog,
  expect,
  login,
  test,
  token,
} from "./orders-helpers";

// D-47: apagar dados de teste (cliente sem atendimentos, atendimento cancelado). Nomes únicos por teste.

const delOrderBtn = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: "Excluir atendimento", exact: false });

test("excluir dados de teste: atendimento cancelado, serviço e cliente", async ({ page }) => {
  await login(page);
  const tk = token();
  const svc = `${tk} Lavagem`;
  const cliente = `${tk} Cliente`;
  await createService(page, { name: svc, car: "100" });
  const id = await createOrderQuick(page, { name: cliente, services: [svc] });
  const orderUrl = page.url();

  // em andamento: sem "Excluir atendimento"
  await expect(delOrderBtn(page)).toHaveCount(0);

  await completeWith(page, "Pix");
  await expect(badge(page)).toHaveText("Pago");
  await expect(delOrderBtn(page)).toHaveCount(0); // concluído: sem excluir

  // estorna e cancela
  await page.getByRole("button", { name: "Estornar pagamento de R$ 100,00 em Pix" }).click();
  await dialog(page).getByRole("button", { name: "Estornar", exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  await page.getByRole("button", { name: "Cancelar atendimento", exact: true }).click();
  await dialog(page).getByRole("button", { name: "Cancelar atendimento", exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(badge(page)).toHaveText("Cancelado");

  // cliente só com atendimento cancelado: recusa, erro no diálogo
  await page.getByRole("link", { name: cliente }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: cliente })).toBeVisible();
  await page.waitForLoadState("networkidle");
  const clienteUrl = page.url();
  await page.getByRole("button", { name: `Excluir ${cliente}`, exact: true }).click();
  await expect(dialog(page).getByRole("heading", { name: "Excluir cliente?" })).toBeVisible();
  await expect(dialog(page)).toContainText("Os veículos cadastrados saem junto");
  await dialog(page).getByRole("button", { name: "Excluir definitivamente" }).click();
  await expect(dialog(page)).toContainText("só tem atendimentos cancelados");
  await dialog(page).getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(dialog(page)).toBeHidden();

  // exclui o atendimento cancelado (cancelar no diálogo não exclui)
  await page.goto(orderUrl);
  await page.waitForLoadState("networkidle");
  await delOrderBtn(page).click();
  await expect(dialog(page).getByRole("heading", { name: "Excluir atendimento?" })).toBeVisible();
  await dialog(page).getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  await delOrderBtn(page).click();
  await dialog(page).getByRole("button", { name: "Excluir definitivamente" }).click();
  // toast primeiro: dura ~4 s e some se a navegação (dev sob carga) demorar
  await expect(page.getByText("Atendimento excluído")).toBeVisible();
  await expect(page).toHaveURL(/\/atendimentos$/);
  const gone = await page.goto(orderUrl);
  expect(gone?.status()).toBe(404);
  expect(id).toBeGreaterThan(0);

  // exclui o serviço
  await page.goto("/servicos");
  const box = page.getByRole("searchbox", { name: "Buscar serviço por nome" });
  await typeSearch(page, box, svc);
  await expect(page.locator(`button[aria-label="Excluir ${svc}"]:visible`)).toBeVisible();
  await page.locator(`button[aria-label="Excluir ${svc}"]:visible`).click();
  await dialog(page).getByRole("button", { name: "Excluir definitivamente" }).click();
  await expect(page.getByText("Serviço excluído")).toBeVisible();

  // exclui o cliente
  await page.goto(clienteUrl);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: `Excluir ${cliente}`, exact: true }).click();
  await dialog(page).getByRole("button", { name: "Excluir definitivamente" }).click();
  // toast primeiro: dura ~4 s e some se a navegação (dev sob carga) demorar
  await expect(page.getByText("Cliente excluído")).toBeVisible();
  await expect(page).toHaveURL(/\/clientes$/);
  const g2 = await page.goto(clienteUrl);
  expect(g2?.status()).toBe(404);
});

test("cliente com atendimento concluído recusa a exclusão e mostra o erro no diálogo", async ({
  page,
}) => {
  await login(page);
  const tk = token();
  const svc = `${tk} Cera`;
  const cliente = `${tk} Cliente`;
  await createService(page, { name: svc, car: "50" });
  await createOrderQuick(page, { name: cliente, services: [svc] });
  await completeWith(page, "Pix");
  await expect(delOrderBtn(page)).toHaveCount(0);

  await page.getByRole("link", { name: cliente }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: cliente })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: `Excluir ${cliente}`, exact: true }).click();
  await dialog(page).getByRole("button", { name: "Excluir definitivamente" }).click();
  await expect(dialog(page)).toContainText("tem atendimentos e não pode ser excluído");
  await dialog(page).getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: cliente })).toBeVisible();
});
