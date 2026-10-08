import { expect, test as base, type Page } from "@playwright/test";
import {
  completeFiado,
  completeWith,
  confirmPayment,
  createOrderQuick,
  createService,
  dialog,
  login,
  methodBtn,
  noHScroll,
  pickServices,
  startQuick,
  token,
} from "./orders-helpers";

// Capturas de atendimentos/caixa para inspeção visual. Só roda com VISUAL_DIR definido.
const DIR = process.env.VISUAL_DIR;
const test = base;
test.skip(!DIR, "defina VISUAL_DIR para capturar screenshots");

async function full(page: Page, name: string, project: string) {
  await page.screenshot({ path: `${DIR}/${project}-${name}.png`, fullPage: true });
}
async function view(page: Page, name: string, project: string) {
  await page.screenshot({ path: `${DIR}/${project}-${name}.png` });
}

test("capturas de atendimentos e caixa", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const p = testInfo.project.name;
  await login(page);
  const tk = token();
  const svc = [
    `${tk} Lavagem simples`,
    `${tk} Polimento técnico completo`,
    `${tk} ${"Servicolongosemespaco".repeat(4)}`.slice(0, 100),
  ];
  await createService(page, { name: svc[0], car: "50", moto: "30" });
  await createService(page, { name: svc[1], car: "350" });
  await createService(page, { name: svc[2], car: "1.234,56", moto: "99" });
  const longName = `${tk}${"Clientelongosemespaco".repeat(6)}`.slice(0, 120);

  // Novo atendimento (passos)
  await page.goto("/atendimentos/novo");
  await page.waitForLoadState("networkidle");
  await full(page, "novo-1-busca", p);
  await startQuick(page, { name: `${tk} Maria`, type: "Carro", plate: "" });
  await full(page, "novo-2-rapido", p);
  await pickServices(page, [svc[0], svc[1], svc[2]]);
  await page.getByRole("button", { name: "Desconto e observação" }).click();
  await page.locator("#order-discount").fill("25");
  await page.getByLabel("Observação").fill("Cliente pediu capricho nas rodas");
  await full(page, "novo-3-servicos", p);
  await view(page, "novo-3-servicos-viewport", p);
  expect(await noHScroll(page)).toBe(true);
  await page.locator("#order-discount").fill("99999");
  await full(page, "novo-4-desconto-erro", p);
  await page.locator("#order-discount").fill("25");

  // Criar e concluir: diálogo misto e erro de soma
  await page.getByRole("button", { name: "Criar e concluir" }).click();
  await expect(dialog(page)).toBeVisible();
  await view(page, "dialogo-1-inicial", p);
  await methodBtn(page, "Dinheiro").click();
  await dialog(page)
    .getByLabel(/^Valor em Dinheiro/)
    .fill("500");
  await view(page, "dialogo-2-restante", p);
  await dialog(page).getByRole("button", { name: "+ outra forma" }).click();
  await view(page, "dialogo-3-duas-formas", p);
  await dialog(page)
    .getByLabel(/^Valor em Pix/)
    .fill("5000");
  await view(page, "dialogo-4-erro-soma", p);
  await dialog(page)
    .getByLabel(/^Valor em Pix/)
    .fill("100");
  await confirmPayment(page, "Concluir e receber");
  await expect(page.getByRole("heading", { level: 1, name: /Atendimento #/ })).toBeVisible();
  await full(page, "detalhe-parcial", p);
  expect(await noHScroll(page)).toBe(true);
  await page.getByRole("button", { name: "Registrar pagamento" }).click();
  await view(page, "dialogo-5-registrar", p);
  await dialog(page).getByRole("button", { name: "Cancelar", exact: true }).click();

  // Outros status
  await createOrderQuick(page, { name: longName, type: "Moto", services: [svc[0]] });
  await full(page, "detalhe-andamento-nome-longo", p);
  expect(await noHScroll(page)).toBe(true);
  await createOrderQuick(page, { name: `${tk} Joao Fiado`, services: [svc[1]] });
  await completeFiado(page);
  await full(page, "detalhe-fiado", p);
  await createOrderQuick(page, { name: `${tk} Ana Paga`, services: [svc[0]] });
  await completeWith(page, "Pix");
  await full(page, "detalhe-pago", p);
  await createOrderQuick(page, { name: `${tk} Cancelado`, services: [svc[0]] });
  await page.getByRole("button", { name: "Cancelar atendimento", exact: true }).click();
  await view(page, "dialogo-6-cancelar", p);
  await dialog(page).getByRole("button", { name: "Cancelar atendimento", exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  await full(page, "detalhe-cancelado", p);

  await page.goto("/atendimentos");
  await page.waitForLoadState("networkidle");
  await full(page, "lista", p);
  expect(await noHScroll(page)).toBe(true);
  await page.getByRole("link", { name: "Dia anterior" }).click();
  await expect(page).toHaveURL(/data=/);
  await full(page, "lista-dia-anterior-vazio", p);

  await page.goto("/caixa");
  await page.waitForLoadState("networkidle");
  await full(page, "caixa", p);
  expect(await noHScroll(page)).toBe(true);
  await page.goto("/caixa?data=2001-01-01");
  await full(page, "caixa-vazio", p);

  // Menu "Mais" (celular) e navegação
  await page.goto("/atendimentos");
  await view(page, "menu-base", p);
  if (p === "mobile") {
    const nav = page.getByRole("navigation", { name: "Navegação principal" });
    await nav.getByRole("button", { name: "Mais" }).click();
    await expect(dialog(page)).toBeVisible();
    await view(page, "menu-mais", p);
  }

  // Passo do cliente existente (1 veículo)
  await page.goto("/atendimentos/novo");
  await page.getByRole("searchbox").fill(`${tk} Maria`);
  await page.waitForTimeout(800);
  await full(page, "novo-5-busca-resultado", p);
});
