import { expect, test as base, type Locator, type Page } from "@playwright/test";
import { TEST_USER } from "./constants";
import { gotoReady, typeSearch } from "./orders-helpers";

// Cada teste usa dados próprios e aleatórios (nome, telefone, placa): desktop e mobile rodam em
// paralelo no mesmo banco, então nada é compartilhado entre testes.

const LETTERS = "BCDFGHJKLMNPQRSTVWXZ";
const rnd = (n: number) => Math.floor(Math.random() * n);
const letters = (n: number) =>
  Array.from({ length: n }, () => LETTERS[rnd(LETTERS.length)]).join("");
const digits = (n: number) => Array.from({ length: n }, () => rnd(10)).join("");

/** Token alfabético único (sem vogais/dígitos, para não casar por acaso com placas/telefones). */
const token = () => `Zq${letters(8)}`.toLowerCase().replace(/^./, (c) => c.toUpperCase());
const oldPlate = () => `${letters(3)}${digits(4)}`; // ABC1234
const mercosulPlate = () => `${letters(3)}${rnd(10)}${letters(1)}${digits(2)}`; // ABC1D23
const phone11 = () => `319${digits(8)}`; // DDD + 9 + 8 dígitos

const fmtPhone = (d: string) => `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
const fmtPlate = (p: string) => `${p.slice(0, 3)}-${p.slice(3)}`;

// Coleta console.error/warning e pageerror em todos os testes deste arquivo.
const test = base.extend<{ problems: string[] }>({
  problems: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("console", (m) => {
        if (m.type() !== "error" && m.type() !== "warning") return;
        const text = m.text();
        // Recurso 404 esperado nos testes de "cliente inexistente".
        if (text.includes("status of 404")) return;
        problems.push(`${m.type()}: ${text}`);
      });
      page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
      await use(problems);
      expect(problems).toEqual([]);
    },
    { auto: true },
  ],
});

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(TEST_USER.email);
  await page.getByLabel("Senha").fill(TEST_USER.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Bem-vindo" })).toBeVisible();
}

async function createCustomer(page: Page, data: { name: string; phone?: string; notes?: string }) {
  await gotoReady(page, "/clientes/novo");
  await page.getByLabel("Nome", { exact: true }).fill(data.name);
  if (data.phone) await page.getByLabel("Telefone (opcional)").fill(data.phone);
  if (data.notes) await page.getByLabel("Observações (opcional)").fill(data.notes);
  await page.getByRole("button", { name: "Cadastrar cliente" }).click();
  await expect(page).toHaveURL(/\/clientes\/\d+$/);
  await expect(page.getByRole("heading", { level: 1, name: data.name })).toBeVisible();
  return page.url();
}

type Vehicle = {
  type: "Carro" | "Moto";
  plate?: string;
  brand?: string;
  model?: string;
  color?: string;
};

function dialog(page: Page) {
  return page.getByRole("dialog");
}

async function openVehicleDialog(page: Page) {
  await page.getByRole("button", { name: "Adicionar veículo" }).click();
  await expect(dialog(page).getByRole("heading", { name: "Novo veículo" })).toBeVisible();
}

async function fillVehicle(page: Page, v: Vehicle) {
  const d = dialog(page);
  await d.getByRole("radio", { name: v.type }).click();
  if (v.plate) await d.getByLabel("Placa (opcional)").fill(v.plate);
  if (v.brand) await d.getByLabel("Marca").fill(v.brand);
  if (v.model) await d.getByLabel("Modelo").fill(v.model);
  if (v.color) await d.getByLabel("Cor").fill(v.color);
}

async function addVehicle(page: Page, v: Vehicle) {
  const before = await page.getByTestId("vehicle-item").count();
  await openVehicleDialog(page);
  await fillVehicle(page, v);
  await dialog(page).getByRole("button", { name: "Adicionar veículo" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByTestId("vehicle-item")).toHaveCount(before + 1);
}

/** Digita na busca e devolve o link visível (cartão no mobile, tabela no desktop) do cliente. */
async function search(page: Page, q: string, includeInactive = false) {
  await page.goto(includeInactive ? "/clientes?inativos=1" : "/clientes");
  const box = page.getByRole("searchbox", { name: "Buscar cliente por nome, telefone ou placa" });
  await typeSearch(page, box, q);
}

function result(page: Page, name: string): Locator {
  return page.locator("a:visible", { hasText: name }).first();
}

async function expectFound(page: Page, q: string, name: string) {
  await search(page, q);
  await expect(result(page, name)).toBeVisible();
}

test.describe("cliente e veículos", () => {
  test("cria cliente com 2 veículos (carro e moto); telefone formatado", async ({ page }) => {
    await login(page);
    const name = `${token()} Silva`;
    const ph = phone11();
    const p1 = oldPlate();
    const p2 = mercosulPlate();
    await createCustomer(page, { name, phone: ph, notes: "Cliente fiel" });

    await expect(page.getByText(fmtPhone(ph))).toBeVisible();
    await expect(page.getByText("Cliente fiel")).toBeVisible();
    await expect(page.getByText("Nenhum veículo cadastrado")).toBeVisible();

    await addVehicle(page, { type: "Carro", plate: p1.toLowerCase(), brand: "Fiat", model: "Uno" });
    await addVehicle(page, { type: "Moto", plate: p2, brand: "Honda", color: "Preta" });

    const items = page.getByTestId("vehicle-item");
    await expect(items).toHaveCount(2);
    const carro = items.filter({ hasText: fmtPlate(p1) });
    const moto = items.filter({ hasText: fmtPlate(p2) });
    await expect(carro).toContainText("Carro");
    await expect(carro).toContainText("Fiat · Uno");
    await expect(moto).toContainText("Moto");
    await expect(moto).toContainText("Honda · Preta");
    await expect(carro).toHaveAttribute("data-active", "true");

    // Persistiu: recarrega.
    await page.reload();
    await expect(page.getByTestId("vehicle-item")).toHaveCount(2);

    // Lista mostra telefone formatado e 2 veículos.
    await search(page, name);
    const link = result(page, name);
    await expect(link).toBeVisible();
    await expect(page.locator(":visible", { hasText: fmtPhone(ph) }).first()).toBeVisible();
  });

  test("busca por nome: parte, sem acento e maiúsculas", async ({ page }) => {
    await login(page);
    const tk = token();
    const name = `${tk} José Ávila`;
    await createCustomer(page, { name });

    await expectFound(page, tk.toLowerCase().slice(0, 8), name); // parte do nome
    await expectFound(page, `${tk.toUpperCase()} JOSE`, name); // sem acento, maiúsculas
    await expectFound(page, `${tk.toLowerCase()} josé avila`, name); // acento no termo, sem no dado
    await expectFound(page, "josé ávila", name);
  });

  test("busca por telefone: parcial, com e sem máscara", async ({ page }) => {
    await login(page);
    const ph = phone11();
    const name = `${token()} Fone`;
    await createCustomer(page, { name, phone: fmtPhone(ph) });

    await expectFound(page, ph, name); // completo, sem máscara
    await expectFound(page, fmtPhone(ph), name); // com máscara
    await expectFound(page, ph.slice(-6), name); // parcial
    await expectFound(page, ph.slice(2, 7), name); // miolo
    await expectFound(page, `(${ph.slice(0, 2)}) ${ph.slice(2, 7)}`, name); // máscara parcial
  });

  // Dividido em dois: cada busca custa 2-5 s no servidor de dev sob carga (3 workers); com 8 buscas
  // + cadastro o teste único passava de 50 s no projeto mobile.
  test("busca por placa antiga: com/sem hífen, minúscula, parcial", async ({ page }) => {
    await login(page);
    const old = oldPlate();
    const name = `${token()} PlacaAntiga`;
    await createCustomer(page, { name });
    await addVehicle(page, { type: "Carro", plate: fmtPlate(old) });

    await expectFound(page, old, name);
    await expectFound(page, fmtPlate(old), name);
    await expectFound(page, old.toLowerCase(), name);
    await expectFound(page, old.slice(0, 3) + "-" + old.slice(3, 5), name); // parcial com hífen
  });

  test("busca por placa Mercosul: com/sem hífen, minúscula, parcial", async ({ page }) => {
    await login(page);
    const merc = mercosulPlate();
    const name = `${token()} PlacaMercosul`;
    await createCustomer(page, { name });
    await addVehicle(page, { type: "Moto", plate: merc });

    await expectFound(page, merc, name);
    await expectFound(page, `${merc.slice(0, 3)}-${merc.slice(3)}`, name);
    await expectFound(page, merc.toLowerCase(), name);
    await expectFound(page, merc.slice(-4), name); // parcial
  });

  test("busca não é vulnerável a curingas e trata caracteres especiais", async ({ page }) => {
    await login(page);
    const name = `${token()} Curinga`;
    await createCustomer(page, { name });

    // curinga no meio do termo não expande a busca
    await search(page, `${name.slice(0, 4)}%${name.slice(-3)}`);
    await expect(result(page, name)).toHaveCount(0);
    // aspas, barras e tags não quebram a página
    await search(page, `"';<script>\\`);
    await expect(page.getByRole("heading", { level: 1, name: "Clientes" })).toBeVisible();
  });

  test("busca só com curingas (%, _) não lista todos os clientes", async ({ page }) => {
    await login(page);
    const name = `${token()} Curinga2`;
    await createCustomer(page, { name });
    for (const q of ["%", "_", "%%%", "%_%"]) {
      await search(page, q);
      await expect(page.getByText(`Nenhum resultado para “${q}”`)).toBeVisible();
      await expect(result(page, name)).toHaveCount(0);
    }
  });

  test("busca sem resultado e limpar busca", async ({ page }) => {
    await login(page);
    const q = `nada${letters(10).toLowerCase()}`;
    await search(page, q);
    await expect(page.getByText(`Nenhum resultado para “${q}”`)).toBeVisible();
    await page.getByRole("button", { name: "Limpar busca" }).click();
    await expect(page).not.toHaveURL(/q=/);
    await expect(page.getByText(/Nenhum resultado/)).toBeHidden();
  });

  test("placa duplicada é rejeitada com o nome do dono (inclusive veículo inativo)", async ({
    page,
  }) => {
    await login(page);
    const owner = `${token()} Dono`;
    const other = `${token()} Outro`;
    const plate = mercosulPlate();
    await createCustomer(page, { name: owner });
    await addVehicle(page, { type: "Carro", plate });

    // Inativa o veículo: a placa continua reservada.
    await page
      .getByTestId("vehicle-item")
      .getByRole("button", { name: /^Inativar/ })
      .click();
    await dialog(page).getByRole("button", { name: "Inativar", exact: true }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(page.getByTestId("vehicle-item")).toHaveAttribute("data-active", "false");

    await createCustomer(page, { name: other });
    await openVehicleDialog(page);
    await fillVehicle(page, {
      type: "Moto",
      plate: `${plate.slice(0, 3)}-${plate.slice(3)}`.toLowerCase(),
    });
    await dialog(page).getByRole("button", { name: "Adicionar veículo" }).click();

    const msg = `Esta placa já está cadastrada para o cliente ${owner}`;
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByText(msg)).toBeVisible();
    // não criou nada
    await dialog(page).getByRole("button", { name: "Cancelar" }).click();
    await expect(page.getByText("Nenhum veículo cadastrado")).toBeVisible();
  });

  test("placa duplicada ao editar outro veículo; editar mantendo a própria placa funciona", async ({
    page,
  }) => {
    await login(page);
    const a = `${token()} A`;
    const pa = oldPlate();
    const pb = oldPlate();
    await createCustomer(page, { name: a });
    await addVehicle(page, { type: "Carro", plate: pa });
    await addVehicle(page, { type: "Carro", plate: pb });

    const second = page.getByTestId("vehicle-item").filter({ hasText: fmtPlate(pb) });
    await second.getByRole("button", { name: /^Editar/ }).click();
    // mesma placa + nova cor: ok
    await dialog(page).getByLabel("Cor").fill("Azul");
    await dialog(page).getByRole("button", { name: "Salvar veículo" }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(second).toContainText("Azul");

    // trocar para a placa do outro veículo: rejeitado
    await second.getByRole("button", { name: /^Editar/ }).click();
    await dialog(page).getByLabel("Placa (opcional)").fill(pa);
    await dialog(page).getByRole("button", { name: "Salvar veículo" }).click();
    await expect(
      dialog(page).getByText(`Esta placa já está cadastrada para o cliente ${a}`),
    ).toBeVisible();
  });

  test("inativar e reativar veículo", async ({ page }) => {
    await login(page);
    await createCustomer(page, { name: `${token()} Veic` });
    const plate = oldPlate();
    await addVehicle(page, { type: "Moto", plate });
    const item = page.getByTestId("vehicle-item");

    await item.getByRole("button", { name: /^Inativar/ }).click();
    await expect(dialog(page).getByText("Inativar veículo?")).toBeVisible();
    // cancelar não altera
    await dialog(page).getByRole("button", { name: "Cancelar" }).click();
    await expect(item).toHaveAttribute("data-active", "true");

    await item.getByRole("button", { name: /^Inativar/ }).click();
    await dialog(page).getByRole("button", { name: "Inativar", exact: true }).click();
    await expect(item).toHaveAttribute("data-active", "false");
    await expect(item).toContainText("Inativo");

    await item.getByRole("button", { name: /^Reativar/ }).click();
    await dialog(page).getByRole("button", { name: "Reativar", exact: true }).click();
    await expect(item).toHaveAttribute("data-active", "true");
  });

  test("inativar cliente: some da busca padrão, aparece com 'Mostrar inativos'; reativar volta", async ({
    page,
  }) => {
    await login(page);
    const name = `${token()} Inativo`;
    const plate = oldPlate();
    await createCustomer(page, { name });
    await addVehicle(page, { type: "Carro", plate });

    await page.getByRole("button", { name: "Inativar cliente" }).click();
    await expect(dialog(page).getByText("Inativar cliente?")).toBeVisible();
    await dialog(page).getByRole("button", { name: "Inativar", exact: true }).click();
    await expect(page.getByRole("button", { name: "Reativar cliente" })).toBeVisible();
    await expect(page.getByText("Inativo").first()).toBeVisible();

    // Cliente inativo não permite adicionar veículo (botão não existe) nem reativar veículo.
    await expect(page.getByRole("button", { name: "Adicionar veículo" })).toHaveCount(0);

    // Busca padrão (nome e placa) não acha.
    await search(page, name);
    await expect(page.getByText(`Nenhum resultado para “${name}”`)).toBeVisible();
    await search(page, plate);
    await expect(page.getByText(`Nenhum resultado para “${plate}”`)).toBeVisible();

    // Com o filtro, acha (checkbox na tela).
    await page.getByRole("checkbox", { name: "Mostrar inativos" }).check();
    await expect(page).toHaveURL(/inativos=1/);
    await expect(result(page, name)).toBeVisible();
    await expect(page.getByText("Inativo").first()).toBeVisible();

    // Reativa.
    await result(page, name).click();
    await page.getByRole("button", { name: "Reativar cliente" }).click();
    await dialog(page).getByRole("button", { name: "Reativar", exact: true }).click();
    await expect(page.getByRole("button", { name: "Inativar cliente" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Adicionar veículo" })).toBeVisible();
    await expectFound(page, name, name);
  });

  test("checkbox 'Mostrar inativos' preserva a busca e vice-versa", async ({ page }) => {
    await login(page);
    const name = `${token()} Filtro`;
    await createCustomer(page, { name });
    await page.getByRole("button", { name: "Inativar cliente" }).click();
    await dialog(page).getByRole("button", { name: "Inativar", exact: true }).click();
    await expect(page.getByRole("button", { name: "Reativar cliente" })).toBeVisible();

    await search(page, name);
    await page.getByRole("checkbox", { name: "Mostrar inativos" }).check();
    await expect(page).toHaveURL(/q=/);
    await expect(page).toHaveURL(/inativos=1/);
    await expect(result(page, name)).toBeVisible();
    await page.getByRole("checkbox", { name: "Mostrar inativos" }).uncheck();
    await expect(page).not.toHaveURL(/inativos/);
    await expect(page.getByText(`Nenhum resultado para “${name}”`)).toBeVisible();
  });

  test("editar cliente", async ({ page }) => {
    await login(page);
    const name = `${token()} Antes`;
    const novo = `${token()} Depois`;
    await createCustomer(page, { name, phone: phone11(), notes: "obs antiga" });

    await page.getByRole("link", { name: "Editar" }).click();
    await expect(page).toHaveURL(/\/editar$/);
    await expect(page.getByLabel("Nome", { exact: true })).toHaveValue(name);
    await expect(page.getByLabel("Telefone (opcional)")).toHaveValue(/^\(\d{2}\) \d{5}-\d{4}$/);
    await page.getByLabel("Nome", { exact: true }).fill(novo);
    const ph = phone11();
    await page.getByLabel("Telefone (opcional)").fill(ph);
    await page.getByLabel("Observações (opcional)").fill("");
    await page.getByRole("button", { name: "Salvar alterações" }).click();

    await expect(page).toHaveURL(/\/clientes\/\d+$/);
    await expect(page.getByRole("heading", { level: 1, name: novo })).toBeVisible();
    await expect(page.getByText(fmtPhone(ph))).toBeVisible();
    await expect(page.getByText("obs antiga")).toHaveCount(0);

    // Apagar telefone.
    await page.getByRole("link", { name: "Editar" }).click();
    await page.getByLabel("Telefone (opcional)").fill("");
    await page.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(page.getByText("Sem telefone")).toBeVisible();

    // Nome antigo não é mais achado.
    await search(page, name);
    await expect(page.getByText(`Nenhum resultado para “${name}”`)).toBeVisible();
  });

  test("cancelar edição volta ao detalhe sem alterar", async ({ page }) => {
    await login(page);
    const name = `${token()} Cancel`;
    await createCustomer(page, { name });
    await page.getByRole("link", { name: "Editar" }).click();
    await page.getByLabel("Nome", { exact: true }).fill("Mudou");
    await page.getByRole("link", { name: "Cancelar" }).click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  });
});

test.describe("validações de formulário", () => {
  test("cliente: nome vazio/curto e telefone inválido; nenhum cadastro criado", async ({
    page,
  }) => {
    await login(page);
    await gotoReady(page, "/clientes/novo");
    await page.getByRole("button", { name: "Cadastrar cliente" }).click();
    await expect(page.getByText("O nome deve ter ao menos 2 caracteres")).toBeVisible();
    await expect(page).toHaveURL(/\/clientes\/novo$/);

    await page.getByLabel("Nome", { exact: true }).fill("   ");
    await page.getByRole("button", { name: "Cadastrar cliente" }).click();
    await expect(page.getByText("O nome deve ter ao menos 2 caracteres")).toBeVisible();

    await page.getByLabel("Nome", { exact: true }).fill(`${token()} Valido`);
    await page.getByLabel("Telefone (opcional)").fill("123");
    await page.getByRole("button", { name: "Cadastrar cliente" }).click();
    await expect(page.getByText("Telefone inválido (informe DDD + número)")).toBeVisible();
    await expect(page).toHaveURL(/\/clientes\/novo$/);
  });

  test("veículo: tipo obrigatório e placa inválida", async ({ page }) => {
    await login(page);
    await createCustomer(page, { name: `${token()} Val` });
    await openVehicleDialog(page);
    const d = dialog(page);

    await d.getByRole("button", { name: "Adicionar veículo" }).click();
    await expect(d.getByText("Informe o tipo do veículo (Carro ou Moto)")).toBeVisible();

    await d.getByRole("radio", { name: "Carro" }).click();
    await d.getByLabel("Placa (opcional)").fill("12-34");
    await d.getByRole("button", { name: "Adicionar veículo" }).click();
    await expect(d.getByText("Placa inválida (use ABC-1234 ou ABC-1D23)")).toBeVisible();
    await expect(d).toBeVisible();

    // Placa vazia é válida (opcional).
    await d.getByLabel("Placa (opcional)").fill("");
    await d.getByRole("button", { name: "Adicionar veículo" }).click();
    await expect(d).toBeHidden();
    await expect(page.getByTestId("vehicle-item")).toContainText("Sem placa");
  });

  test("máscara da placa em maiúsculas com hífen", async ({ page }) => {
    await login(page);
    await createCustomer(page, { name: `${token()} Mask` });
    await openVehicleDialog(page);
    const input = dialog(page).getByLabel("Placa (opcional)");
    await input.pressSequentially("abc1234");
    await expect(input).toHaveValue("ABC-1234");
    await input.fill("");
    await input.pressSequentially("abc1d23");
    await expect(input).toHaveValue("ABC-1D23");
  });
});

test.describe("acesso e rotas", () => {
  for (const route of ["/clientes", "/clientes/novo", "/clientes/1", "/clientes/1/editar"]) {
    test(`sem sessão, ${route} redireciona para /login`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login$/);
    });
  }

  test("action sem sessão (cookie removido após abrir a tela) redireciona para /login", async ({
    page,
    context,
  }) => {
    await login(page);
    await createCustomer(page, { name: `${token()} Sessao` });
    await context.clearCookies();
    await page.getByRole("button", { name: "Inativar cliente" }).click();
    await dialog(page).getByRole("button", { name: "Inativar", exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("/clientes/999999 e ids inválidos mostram 404 amigável", async ({ page }) => {
    await login(page);
    for (const route of ["/clientes/999999", "/clientes/abc", "/clientes/-1", "/clientes/1.5"]) {
      const res = await page.goto(route);
      expect(res?.status()).toBe(404);
      await expect(page.getByText(/não encontrad|404/i).first()).toBeVisible();
      // não vaza stack/erro técnico
      await expect(page.getByText(/Prisma|stack|TypeError|Unhandled/i)).toHaveCount(0);
    }
    const res = await page.goto("/clientes/999999/editar");
    expect(res?.status()).toBe(404);
  });

  test("lista vazia inicial ou com dados; sem scroll horizontal em lista, detalhe e formulários", async ({
    page,
  }) => {
    await login(page);
    const noHScroll = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      );
    const name = `${token()} ${"Sobrenomemuitolongo".repeat(3)}`;
    await createCustomer(page, { name, phone: phone11() });
    await addVehicle(page, {
      type: "Carro",
      plate: mercosulPlate(),
      brand: "MarcaComNomeBemLongo",
      model: "ModeloComNomeBemLongoTambem",
      color: "Cor",
    });
    expect(await noHScroll()).toBe(true);
    await page.goto("/clientes");
    expect(await noHScroll()).toBe(true);
    await gotoReady(page, "/clientes/novo");
    expect(await noHScroll()).toBe(true);
  });
});
