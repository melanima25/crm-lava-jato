import { expect, test, type Page } from "@playwright/test";
import { TEST_USER } from "./constants";

// Captura de telas do catálogo para inspeção visual manual. Só roda com VISUAL_DIR definido.
const DIR = process.env.VISUAL_DIR;
test.skip(!DIR, "defina VISUAL_DIR para capturar screenshots");

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(TEST_USER.email);
  await page.getByLabel("Senha").fill(TEST_USER.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Bem-vindo" })).toBeVisible();
}

test("capturas do catálogo", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const p = testInfo.project.name;
  const full = (n: string) => page.screenshot({ path: `${DIR}/${p}-${n}.png`, fullPage: true });
  const shot = (n: string) => page.screenshot({ path: `${DIR}/${p}-${n}.png` });
  await login(page);

  await page.goto("/servicos");
  await full("servicos-base");
  await page.goto("/produtos");
  await full("produtos-base");

  const tk = `Vis${p}`;
  const services = [
    { name: `${tk} Lavagem simples`, d: "Lavagem externa", car: "50", moto: "30" },
    {
      name: `${tk} Polimento técnico completo`,
      d: "Polimento em 3 etapas com cera",
      car: "350",
      moto: "",
    },
    { name: `${tk} Higienização de bancos`, d: "", car: "", moto: "120,5" },
    {
      name: `${tk} ${"Nomelongosemespaco".repeat(6)}`.slice(0, 120),
      d: "x".repeat(200),
      car: "1.234,56",
      moto: "999.999,99",
    },
  ];
  for (const s of services) {
    await page.goto("/servicos/novo");
    await page.getByLabel("Nome", { exact: true }).fill(s.name);
    await page.getByLabel("Descrição (opcional)").fill(s.d);
    await page.getByLabel("Preço Carro (opcional)").fill(s.car);
    await page.getByLabel("Preço Moto (opcional)").fill(s.moto);
    if (s === services[0]) await full("form-servico-preenchido");
    await page.getByRole("button", { name: "Cadastrar serviço" }).click();
    await expect(page).toHaveURL(/\/servicos$/);
  }
  await page.goto("/servicos/novo");
  await page.getByRole("button", { name: "Cadastrar serviço" }).click();
  await full("form-servico-erro");

  await page.goto("/servicos");
  await page.waitForTimeout(500);
  await full("servicos-lista");

  const products = [
    { name: `${tk} Shampoo automotivo`, d: "Galão 5L", unit: "L", price: "" },
    { name: `${tk} Pretinho`, d: "", unit: "", price: "18,9" },
    {
      name: `${tk} ${"Produtolongosemespaco".repeat(5)}`.slice(0, 120),
      d: "y".repeat(200),
      unit: "un",
      price: "1.234,56",
    },
  ];
  for (const s of products) {
    await page.goto("/produtos/novo");
    await page.getByLabel("Nome", { exact: true }).fill(s.name);
    await page.getByLabel("Descrição (opcional)").fill(s.d);
    if (s.unit) await page.getByLabel("Unidade").fill(s.unit);
    await page.getByLabel("Preço de venda (opcional)").fill(s.price);
    if (s === products[0]) await full("form-produto-preenchido");
    await page.getByRole("button", { name: "Cadastrar produto" }).click();
    await expect(page).toHaveURL(/\/produtos$/);
  }
  await page.goto("/produtos");
  await page.waitForTimeout(500);
  await full("produtos-lista");

  // diálogo de exclusão + edição
  await page.goto("/servicos");
  await page.locator(`button[aria-label="Excluir ${services[0].name}"]:visible`).click();
  await page.waitForTimeout(400);
  await shot("dialogo-excluir-servico");
  await page.getByRole("button", { name: "Cancelar" }).click();
  await page.locator(`button[aria-label="Inativar ${services[1].name}"]:visible`).click();
  await page.waitForTimeout(300);
  await shot("dialogo-inativar-servico");
  await page.getByRole("dialog").getByRole("button", { name: "Inativar", exact: true }).click();
  await page.waitForTimeout(600);
  await page.getByRole("checkbox", { name: "Mostrar inativos" }).check();
  await page.waitForTimeout(800);
  await full("servicos-com-inativo");
  await page.locator(`a[aria-label="Editar ${services[3].name}"]:visible`).click();
  await expect(page).toHaveURL(/\/editar$/);
  await full("editar-servico-nome-longo");

  await page.goto("/produtos");
  await page.locator(`button[aria-label="Excluir ${products[0].name}"]:visible`).click();
  await page.waitForTimeout(400);
  await shot("dialogo-excluir-produto");
  await page.getByRole("button", { name: "Cancelar" }).click();

  await page.goto("/servicos?q=zzzxxx");
  await full("servicos-sem-resultado");
  await page.goto("/servicos/999999/editar");
  await full("404");
});
