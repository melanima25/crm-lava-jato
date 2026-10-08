import { expect, test, type Page } from "@playwright/test";
import { TEST_USER } from "./constants";

// Captura de telas para inspeção visual manual. Só roda com VISUAL_DIR definido:
//   VISUAL_DIR=/caminho npx playwright test e2e/customers-visual.spec.ts
const DIR = process.env.VISUAL_DIR;
test.skip(!DIR, "defina VISUAL_DIR para capturar screenshots");

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(TEST_USER.email);
  await page.getByLabel("Senha").fill(TEST_USER.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Bem-vindo" })).toBeVisible();
}

test("capturas", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const p = testInfo.project.name;
  const shot = (n: string) => page.screenshot({ path: `${DIR}/${p}-${n}.png`, fullPage: false });
  const full = (n: string) => page.screenshot({ path: `${DIR}/${p}-${n}.png`, fullPage: true });
  await login(page);

  await page.goto("/clientes");
  await full("lista-vazia-ou-base");

  await page.goto("/clientes/novo");
  await full("form-cliente");
  await page.getByRole("button", { name: "Cadastrar cliente" }).click();
  await shot("form-cliente-erro");

  await page
    .getByLabel("Nome", { exact: true })
    .fill(`Visual ${p} Maria da Conceição Aparecida dos Santos`);
  await page.getByLabel("Telefone (opcional)").fill("31988887777");
  await page
    .getByLabel("Observações (opcional)")
    .fill("Prefere atendimento pela manhã.\nPaga no Pix.");
  await page.getByRole("button", { name: "Cadastrar cliente" }).click();
  await expect(page).toHaveURL(/\/clientes\/\d+$/);
  await full("detalhe-sem-veiculo");

  // diálogo de veículo
  await page.getByRole("button", { name: "Adicionar veículo" }).click();
  await shot("dialogo-veiculo-vazio");
  const d = page.getByRole("dialog");
  await d.getByRole("button", { name: "Adicionar veículo" }).click({ force: true });
  await shot("dialogo-veiculo-erro-tipo");
  await d.getByRole("radio", { name: "Carro" }).click();
  await d.getByLabel("Placa (opcional)").fill(`VIS${p === "mobile" ? "1" : "2"}A23`);
  await d.getByLabel("Marca").fill("Volkswagen");
  await d.getByLabel("Modelo").fill("Gol");
  await d.getByLabel("Cor").fill("Prata");
  await d.getByLabel("Observações").fill("Risco na porta");
  await shot("dialogo-veiculo-preenchido");
  await d.getByRole("button", { name: "Adicionar veículo" }).click({ force: true });
  await page.waitForTimeout(300);
  await shot("dialogo-fechado-toast");
  await expect(d).toBeHidden();

  await page.getByRole("button", { name: "Adicionar veículo" }).click();
  await d.getByRole("radio", { name: "Moto" }).click();
  await d.getByLabel("Placa (opcional)").fill(`VIS${p === "mobile" ? "1" : "2"}A23`);
  await d.getByRole("button", { name: "Adicionar veículo" }).click({ force: true });
  await page.waitForTimeout(400);
  await shot("dialogo-placa-duplicada-toast");
  await d.getByRole("button", { name: "Cancelar" }).click();

  await page.getByRole("button", { name: "Adicionar veículo" }).click();
  await d.getByRole("radio", { name: "Moto" }).click();
  await d.getByLabel("Placa (opcional)").fill(`VIS${p === "mobile" ? "1" : "2"}B23`);
  await d.getByLabel("Marca").fill("Honda");
  await d.getByRole("button", { name: "Adicionar veículo" }).click({ force: true });
  await expect(d).toBeHidden();
  await page.waitForTimeout(500);
  await full("detalhe-com-veiculos");

  await page
    .getByTestId("vehicle-item")
    .last()
    .getByRole("button", { name: /^Inativar/ })
    .click();
  await shot("confirmar-inativar-veiculo");
  await d.getByRole("button", { name: "Inativar", exact: true }).click();
  await page.waitForTimeout(500);
  await full("detalhe-veiculo-inativo");

  await page.getByRole("button", { name: "Inativar cliente" }).click();
  await shot("confirmar-inativar-cliente");
  await d.getByRole("button", { name: "Inativar", exact: true }).click();
  await page.waitForTimeout(600);
  await full("detalhe-cliente-inativo");

  await page.goto("/clientes");
  await full("lista-com-dados");
  await page.getByRole("checkbox", { name: "Mostrar inativos" }).check();
  await page.waitForTimeout(800);
  await full("lista-inativos");
  await page.getByRole("searchbox").fill("zzzxxx");
  await page.waitForTimeout(1000);
  await full("lista-sem-resultado");

  await page.goto("/clientes/999999");
  await full("404");
});
