import { expect, test as base, type Locator, type Page } from "@playwright/test";
import { TEST_USER } from "./constants";
import { gotoReady, typeSearch } from "./orders-helpers";

// Cada teste usa nomes únicos (token aleatório): desktop e mobile rodam em paralelo no mesmo banco.

const LETTERS = "BCDFGHJKLMNPQRSTVWXZ";
const rnd = (n: number) => Math.floor(Math.random() * n);
const letters = (n: number) =>
  Array.from({ length: n }, () => LETTERS[rnd(LETTERS.length)]).join("");
const token = () => `Zq${letters(8)}`.toLowerCase().replace(/^./, (c) => c.toUpperCase());

const test = base.extend<{ problems: string[] }>({
  problems: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("console", (m) => {
        if (m.type() !== "error" && m.type() !== "warning") return;
        const text = m.text();
        if (text.includes("status of 404")) return; // recurso 404 esperado nos testes de id inexistente
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

const dialog = (page: Page) => page.getByRole("dialog");

const noHScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

/** Cartão (mobile) ou linha (desktop) visível do item. */
function row(page: Page, name: string): Locator {
  return page.locator("li:visible, tr:visible").filter({ hasText: name }).first();
}
const btn = (page: Page, label: string, name: string) =>
  page.locator(`button[aria-label="${label} ${name}"]:visible`);

type ServiceData = { name: string; description?: string; car?: string; moto?: string };

async function fillService(page: Page, d: ServiceData) {
  await page.getByLabel("Nome", { exact: true }).fill(d.name);
  if (d.description !== undefined)
    await page.getByLabel("Descrição (opcional)").fill(d.description);
  if (d.car !== undefined) await page.getByLabel("Preço Carro (opcional)").fill(d.car);
  if (d.moto !== undefined) await page.getByLabel("Preço Moto (opcional)").fill(d.moto);
}

async function createService(page: Page, d: ServiceData) {
  await gotoReady(page, "/servicos/novo");
  await fillService(page, d);
  await page.getByRole("button", { name: "Cadastrar serviço" }).click();
  // toast primeiro: dura ~4 s e some se a navegação (dev sob carga) demorar
  await expect(page.getByText("Serviço cadastrado")).toBeVisible();
  await expect(page).toHaveURL(/\/servicos$/);
}

type ProductData = { name: string; description?: string; unit?: string; price?: string };

async function fillProduct(page: Page, d: ProductData) {
  await page.getByLabel("Nome", { exact: true }).fill(d.name);
  if (d.description !== undefined)
    await page.getByLabel("Descrição (opcional)").fill(d.description);
  if (d.unit !== undefined) await page.getByLabel("Unidade").fill(d.unit);
  if (d.price !== undefined) await page.getByLabel("Preço de venda (opcional)").fill(d.price);
}

async function createProduct(page: Page, d: ProductData) {
  await gotoReady(page, "/produtos/novo");
  await fillProduct(page, d);
  await page.getByRole("button", { name: "Cadastrar produto" }).click();
  // toast primeiro: dura ~4 s e some se a navegação (dev sob carga) demorar
  await expect(page.getByText("Produto cadastrado")).toBeVisible();
  await expect(page).toHaveURL(/\/produtos$/);
}

/** Busca por nome na lista (espera a hidratação e a URL refletir a busca). */
async function searchList(
  page: Page,
  base: "/servicos" | "/produtos",
  q: string,
  inactive = false,
) {
  await page.goto(inactive ? `${base}?inativos=1` : base);
  const box = page.getByRole("searchbox", {
    name: base === "/servicos" ? "Buscar serviço por nome" : "Buscar produto por nome",
  });
  await typeSearch(page, box, q);
}

async function openEdit(page: Page, base: "/servicos" | "/produtos", name: string) {
  await page.goto(base);
  await searchList(page, base, name);
  await page.locator(`a[aria-label="Editar ${name}"]:visible`).click();
  await expect(page).toHaveURL(/\/editar$/);
}

// ---------------------------------------------------------------- SERVIÇOS

test.describe("serviços: cadastro e listagem", () => {
  test("cria só-carro, só-moto e ambos; 'Não oferece' e preços em BRL", async ({ page }) => {
    await login(page);
    const tk = token();
    const carro = `${tk} SoCarro`;
    const moto = `${tk} SoMoto`;
    const ambos = `${tk} Ambos`;
    await createService(page, { name: carro, car: "80" });
    await createService(page, { name: moto, moto: "1.234,56", description: "Descrição de teste" });
    await createService(page, { name: ambos, car: "120,5", moto: "0,01" });

    await searchList(page, "/servicos", tk);
    const rc = row(page, carro);
    await expect(rc).toContainText("R$ 80,00");
    await expect(rc).toContainText("Não oferece");
    const rm = row(page, moto);
    await expect(rm).toContainText("R$ 1.234,56");
    await expect(rm).toContainText("Não oferece");
    await expect(rm).toContainText("Descrição de teste");
    const ra = row(page, ambos);
    await expect(ra).toContainText("R$ 120,50");
    await expect(ra).toContainText("R$ 0,01");
    await expect(ra).not.toContainText("Não oferece");
  });

  test("valores digitados reaparecem certos ao editar; editar nome/preços; limpar um preço", async ({
    page,
  }) => {
    await login(page);
    const tk = token();
    const name = `${tk} Editar`;
    await createService(page, { name, car: "1.234,56", moto: "50" });

    await openEdit(page, "/servicos", name);
    await expect(page.getByLabel("Preço Carro (opcional)")).toHaveValue("1.234,56");
    await expect(page.getByLabel("Preço Moto (opcional)")).toHaveValue("50,00");

    const novo = `${tk} Editado`;
    await page.getByLabel("Nome", { exact: true }).fill(novo);
    await page.getByLabel("Preço Carro (opcional)").fill("99,9");
    await page.getByLabel("Preço Moto (opcional)").fill("");
    await page.getByRole("button", { name: "Salvar alterações" }).click();
    // toast primeiro: dura ~4 s e some se a navegação (dev sob carga) demorar
    await expect(page.getByText("Serviço atualizado")).toBeVisible();
    await expect(page).toHaveURL(/\/servicos$/);

    await searchList(page, "/servicos", novo);
    await expect(row(page, novo)).toContainText("R$ 99,90");
    await expect(row(page, novo)).toContainText("Não oferece");
    await searchList(page, "/servicos", name);
    await expect(page.getByText(`Nenhum resultado para “${name}”`)).toBeVisible();
  });

  test("limpar os dois preços dá erro nos dois campos e não salva", async ({ page }) => {
    await login(page);
    const name = `${token()} SemPreco`;
    await createService(page, { name, car: "10" });
    await openEdit(page, "/servicos", name);
    await page.getByLabel("Preço Carro (opcional)").fill("");
    await page.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(page.getByText("Informe ao menos um preço (Carro ou Moto)")).toHaveCount(2);
    await expect(page).toHaveURL(/\/editar$/);

    // Cadastro novo sem preço também.
    await gotoReady(page, "/servicos/novo");
    await fillService(page, { name: `${token()} Novo` });
    await page.getByRole("button", { name: "Cadastrar serviço" }).click();
    await expect(page.getByText("Informe ao menos um preço (Carro ou Moto)")).toHaveCount(2);
    await expect(page).toHaveURL(/\/servicos\/novo$/);
  });

  test("preço zero, negativo e inválido são rejeitados", async ({ page }) => {
    await login(page);
    await gotoReady(page, "/servicos/novo");
    const nome = `${token()} Invalido`;
    await page.getByLabel("Nome", { exact: true }).fill(nome);
    const submit = page.getByRole("button", { name: "Cadastrar serviço" });

    await page.getByLabel("Preço Carro (opcional)").fill("0");
    await submit.click();
    await expect(page.getByText("O preço deve ser maior que zero")).toBeVisible();
    await expect(page).toHaveURL(/\/servicos\/novo$/);

    await page.getByLabel("Preço Carro (opcional)").fill("0,00");
    await submit.click();
    await expect(page.getByText("O preço deve ser maior que zero")).toBeVisible();

    await page.getByLabel("Preço Carro (opcional)").fill("-5");
    await page.getByLabel("Preço Carro (opcional)").blur();
    await expect(
      page.getByText(/O valor não pode ser negativo|Informe ao menos um preço/).first(),
    ).toBeVisible();
    await submit.click();
    await expect(page).toHaveURL(/\/servicos\/novo$/);

    await page.getByLabel("Preço Carro (opcional)").fill("abc");
    await page.getByLabel("Preço Carro (opcional)").blur();
    await expect(page.getByText(/Valor inválido|Informe ao menos um preço/).first()).toBeVisible();
    await submit.click();
    await expect(page).toHaveURL(/\/servicos\/novo$/);

    await page.getByLabel("Preço Carro (opcional)").fill("1.000.000,00");
    await submit.click();
    await expect(page.getByText("Preço acima do limite permitido")).toBeVisible();
    await expect(page).toHaveURL(/\/servicos\/novo$/);
  });

  test("preço inválido em um campo não pode ser salvo silenciosamente como 'não oferece'", async ({
    page,
  }) => {
    await login(page);
    const name = `${token()} Silencio`;
    await gotoReady(page, "/servicos/novo");
    await fillService(page, { name, car: "abc", moto: "50" });
    await page.getByRole("button", { name: "Cadastrar serviço" }).click();
    // Esperado: permanece no formulário com erro (não grava Carro=null sem avisar).
    await page.waitForTimeout(2500);
    await expect(page).toHaveURL(/\/servicos\/novo$/);
  });

  test("nome: vazio/curto e duplicado (Cera, CÉRA, ' cera ') rejeitado no campo", async ({
    page,
  }) => {
    await login(page);
    const tk = token();
    await gotoReady(page, "/servicos/novo");
    await page.getByLabel("Preço Carro (opcional)").fill("10");
    await page.getByRole("button", { name: "Cadastrar serviço" }).click();
    await expect(page.getByText("O nome deve ter ao menos 2 caracteres")).toBeVisible();

    await createService(page, { name: `${tk} Cera`, car: "30" });
    for (const dup of [`${tk} CÉRA`, `  ${tk.toUpperCase()} cera  `, `${tk.toLowerCase()} cera`]) {
      await gotoReady(page, "/servicos/novo");
      await fillService(page, { name: dup, car: "10" });
      await page.getByRole("button", { name: "Cadastrar serviço" }).click();
      await expect(page.getByText("Já existe um serviço com este nome").first()).toBeVisible();
      await expect(page).toHaveURL(/\/servicos\/novo$/);
    }
    // editar outro serviço para o nome existente também é rejeitado
    const other = `${tk} Outro`;
    await createService(page, { name: other, car: "10" });
    await openEdit(page, "/servicos", other);
    await page.getByLabel("Nome", { exact: true }).fill(`${tk} cera`);
    await page.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(page.getByText("Já existe um serviço com este nome").first()).toBeVisible();
    // regravar o próprio nome com outra caixa funciona
    await page.getByLabel("Nome", { exact: true }).fill(other.toUpperCase());
    await page.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(page).toHaveURL(/\/servicos$/);
  });
});

test.describe("serviços: inativar e excluir", () => {
  test("excluir com confirmação: cancelar não exclui; confirmar some e libera o nome", async ({
    page,
  }) => {
    await login(page);
    const name = `${token()} Excluir`;
    await createService(page, { name, car: "25" });
    await searchList(page, "/servicos", name);
    await expect(row(page, name)).toBeVisible();

    await btn(page, "Excluir", name).click();
    await expect(dialog(page).getByText("Excluir serviço?")).toBeVisible();
    await dialog(page).getByRole("button", { name: "Cancelar" }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(row(page, name)).toBeVisible();

    await btn(page, "Excluir", name).click();
    await dialog(page).getByRole("button", { name: "Excluir definitivamente" }).click();
    await expect(page.getByText("Serviço excluído")).toBeVisible();
    await searchList(page, "/servicos", name, true); // nem com inativos
    await expect(page.getByText(`Nenhum resultado para “${name}”`)).toBeVisible();

    // nome reutilizável
    await createService(page, { name, moto: "40" });
    await searchList(page, "/servicos", name);
    await expect(row(page, name)).toContainText("R$ 40,00");
  });

  test("excluir pela tela de edição volta à lista", async ({ page }) => {
    await login(page);
    const name = `${token()} ExcluirEdicao`;
    await createService(page, { name, car: "25" });
    await openEdit(page, "/servicos", name);
    await btn(page, "Excluir", name).click();
    await dialog(page).getByRole("button", { name: "Excluir definitivamente" }).click();
    // toast primeiro: dura ~4 s e some se a navegação (dev sob carga) demorar
    await expect(page.getByText("Serviço excluído")).toBeVisible();
    await expect(page).toHaveURL(/\/servicos$/);
  });

  test("inativar/reativar e filtro 'Mostrar inativos'", async ({ page }) => {
    await login(page);
    const name = `${token()} Inativar`;
    await createService(page, { name, car: "25" });
    await searchList(page, "/servicos", name);

    await btn(page, "Inativar", name).click();
    await expect(dialog(page).getByText("Inativar serviço?")).toBeVisible();
    await dialog(page).getByRole("button", { name: "Cancelar" }).click();
    await expect(row(page, name)).toBeVisible();

    await btn(page, "Inativar", name).click();
    await dialog(page).getByRole("button", { name: "Inativar", exact: true }).click();
    await expect(page.getByText("Serviço inativado")).toBeVisible();
    await expect(page.getByText(`Nenhum resultado para “${name}”`)).toBeVisible();

    await page.getByRole("checkbox", { name: "Mostrar inativos" }).check();
    await expect(page).toHaveURL(/inativos=1/);
    await expect(page).toHaveURL(/q=/);
    await expect(row(page, name)).toContainText("Inativo");

    await btn(page, "Reativar", name).click();
    await dialog(page).getByRole("button", { name: "Reativar", exact: true }).click();
    await expect(page.getByText("Serviço reativado")).toBeVisible();
    await expect(row(page, name)).not.toContainText("Inativo");
    await page.getByRole("checkbox", { name: "Mostrar inativos" }).uncheck();
    await expect(page).not.toHaveURL(/inativos/);
    await expect(row(page, name)).toBeVisible();
  });

  test("busca por nome sem acento, maiúsculas, parcial e curingas", async ({ page }) => {
    await login(page);
    const tk = token();
    const name = `${tk} Polimento Técnico`;
    await createService(page, { name, car: "150" });
    await searchList(page, "/servicos", "POLIMENTO TECNICO");
    await expect(row(page, name)).toBeVisible();
    await searchList(page, "/servicos", "técnico");
    await expect(row(page, name)).toBeVisible();
    await searchList(page, "/servicos", tk.toLowerCase().slice(0, 8));
    await expect(row(page, name)).toBeVisible();
    for (const q of ["%", "_", "%%%"]) {
      await searchList(page, "/servicos", q);
      await expect(page.getByText(`Nenhum resultado para “${q}”`)).toBeVisible();
    }
    await searchList(page, "/servicos", `${tk.slice(0, 4)}%${tk.slice(-2)}`);
    await expect(row(page, name)).toHaveCount(0);
    await searchList(page, "/servicos", `"';<script>\\`);
    await expect(page.getByRole("heading", { level: 1, name: "Serviços" })).toBeVisible();
  });
});

// ---------------------------------------------------------------- PRODUTOS

test.describe("produtos", () => {
  test("cria com unidade padrão 'un' e preço opcional; formatação BRL; reaparece ao editar", async ({
    page,
  }) => {
    await login(page);
    const tk = token();
    const semPreco = `${tk} SemPreco`;
    const comPreco = `${tk} ComPreco`;
    await gotoReady(page, "/produtos/novo");
    await expect(page.getByLabel("Unidade")).toHaveValue("un");
    await createProduct(page, { name: semPreco });
    await createProduct(page, {
      name: comPreco,
      unit: "L",
      price: "1.234,56",
      description: "Shampoo",
    });

    await searchList(page, "/produtos", tk);
    await expect(row(page, semPreco)).toContainText("un");
    await expect(row(page, semPreco)).toContainText("Uso interno");
    await expect(row(page, comPreco)).toContainText("R$ 1.234,56");
    await expect(row(page, comPreco)).toContainText("L");
    await expect(row(page, comPreco)).toContainText("Shampoo");

    await openEdit(page, "/produtos", comPreco);
    await expect(page.getByLabel("Unidade")).toHaveValue("L");
    await expect(page.getByLabel("Preço de venda (opcional)")).toHaveValue("1.234,56");
    // unidade vazia volta a "un"; preço limpo vira sem preço
    await page.getByLabel("Unidade").fill("");
    await page.getByLabel("Preço de venda (opcional)").fill("");
    await page.getByLabel("Nome", { exact: true }).fill(`${tk} Editado`);
    await page.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(page.getByText("Produto atualizado")).toBeVisible();
    await searchList(page, "/produtos", `${tk} Editado`);
    await expect(row(page, `${tk} Editado`)).toContainText("un");
    await expect(row(page, `${tk} Editado`)).toContainText("Uso interno");
  });

  test("validações: preço zero/negativo, nome duplicado (Cera, CÉRA, ' cera ')", async ({
    page,
  }) => {
    await login(page);
    const tk = token();
    await gotoReady(page, "/produtos/novo");
    await fillProduct(page, { name: `${tk} Zero`, price: "0" });
    await page.getByRole("button", { name: "Cadastrar produto" }).click();
    await expect(page.getByText("O preço deve ser maior que zero")).toBeVisible();
    await page.getByLabel("Preço de venda (opcional)").fill("-1");
    await page.getByRole("button", { name: "Cadastrar produto" }).click();
    await expect(page).toHaveURL(/\/produtos\/novo$/);

    await createProduct(page, { name: `${tk} Cera` });
    for (const dup of [`${tk} CÉRA`, `  ${tk.toUpperCase()} cera  `]) {
      await gotoReady(page, "/produtos/novo");
      await fillProduct(page, { name: dup });
      await page.getByRole("button", { name: "Cadastrar produto" }).click();
      await expect(page.getByText("Já existe um produto com este nome").first()).toBeVisible();
      await expect(page).toHaveURL(/\/produtos\/novo$/);
    }
    // nome de produto pode coincidir com nome de serviço (tabelas independentes)
    await createService(page, { name: `${tk} Cera`, car: "10" });
  });

  test("excluir (nome reutilizável) e inativar/reativar com filtro", async ({ page }) => {
    await login(page);
    const tk = token();
    const del = `${tk} Excluir`;
    const ina = `${tk} Inativar`;
    await createProduct(page, { name: del, price: "9" });
    await createProduct(page, { name: ina });

    await searchList(page, "/produtos", del);
    await btn(page, "Excluir", del).click();
    await expect(dialog(page).getByText("Excluir produto?")).toBeVisible();
    await dialog(page).getByRole("button", { name: "Excluir definitivamente" }).click();
    await expect(page.getByText("Produto excluído")).toBeVisible();
    await searchList(page, "/produtos", del, true);
    await expect(page.getByText(`Nenhum resultado para “${del}”`)).toBeVisible();
    await createProduct(page, { name: del });

    await searchList(page, "/produtos", ina);
    await btn(page, "Inativar", ina).click();
    await expect(dialog(page).getByText("Inativar produto?")).toBeVisible();
    await dialog(page).getByRole("button", { name: "Inativar", exact: true }).click();
    await expect(page.getByText("Produto inativado")).toBeVisible();
    await expect(page.getByText(`Nenhum resultado para “${ina}”`)).toBeVisible();
    await page.getByRole("checkbox", { name: "Mostrar inativos" }).check();
    await expect(row(page, ina)).toContainText("Inativo");
    await btn(page, "Reativar", ina).click();
    await dialog(page).getByRole("button", { name: "Reativar", exact: true }).click();
    await expect(page.getByText("Produto reativado")).toBeVisible();
  });

  test("busca por nome sem acento e curingas", async ({ page }) => {
    await login(page);
    const tk = token();
    const name = `${tk} Pretinho Pneu Ação`;
    await createProduct(page, { name });
    await searchList(page, "/produtos", "PRETINHO PNEU ACAO");
    await expect(row(page, name)).toBeVisible();
    await searchList(page, "/produtos", "%");
    await expect(page.getByText("Nenhum resultado para “%”")).toBeVisible();
  });
});

// ---------------------------------------------------------------- ACESSO, 404, LAYOUT

test.describe("acesso e rotas do catálogo", () => {
  for (const route of [
    "/servicos",
    "/servicos/novo",
    "/servicos/1/editar",
    "/produtos",
    "/produtos/novo",
    "/produtos/1/editar",
  ]) {
    test(`sem sessão, ${route} redireciona para /login`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login$/);
    });
  }

  for (const [base, kind] of [
    ["/servicos", "serviço"],
    ["/produtos", "produto"],
  ] as const) {
    test(`${base}: ids inexistentes/inválidos mostram 404 amigável`, async ({ page }) => {
      await login(page);
      for (const id of ["999999", "abc", "-1", "1.5", "0"]) {
        const res = await page.goto(`${base}/${id}/editar`);
        expect(res?.status(), `${base}/${id}/editar`).toBe(404);
        await expect(page.getByText(/não encontrad|404/i).first()).toBeVisible();
        await expect(page.getByText(/Prisma|stack|TypeError|Unhandled/i)).toHaveCount(0);
      }
      expect(kind).toBeTruthy();
    });
  }

  test("serviço: sem sessão, Excluir e Inativar levam ao /login sem erro do Next", async ({
    page,
    context,
  }) => {
    await login(page);
    const tk = token();
    const a = `${tk} SessaoA`;
    const b = `${tk} SessaoB`;
    await createService(page, { name: a, car: "10" });
    await createService(page, { name: b, car: "10" });
    await searchList(page, "/servicos", tk);
    await context.clearCookies();
    await btn(page, "Excluir", a).click();
    await dialog(page).getByRole("button", { name: "Excluir definitivamente" }).click();
    await expect(page).toHaveURL(/\/login/);

    await login(page);
    await searchList(page, "/servicos", b);
    await context.clearCookies();
    await btn(page, "Inativar", b).click();
    await dialog(page).getByRole("button", { name: "Inativar", exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("produto: sem sessão, Excluir leva ao /login", async ({ page, context }) => {
    await login(page);
    const name = `${token()} SessaoProd`;
    await createProduct(page, { name });
    await searchList(page, "/produtos", name);
    await context.clearCookies();
    await btn(page, "Excluir", name).click();
    await dialog(page).getByRole("button", { name: "Excluir definitivamente" }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("nomes/descrições longos sem espaços não geram scroll horizontal", async ({ page }) => {
    await login(page);
    const tk = token();
    const longName = `${tk}${"Nomemuitolongo".repeat(7)}`.slice(0, 120);
    const longDesc = "D".repeat(500);
    await createService(page, { name: longName, description: longDesc, car: "9.999,99" });
    await createProduct(page, { name: longName, description: longDesc, unit: "U".repeat(20) });

    for (const route of ["/servicos", "/produtos", "/servicos/novo", "/produtos/novo"]) {
      await page.goto(route);
      expect(await noHScroll(page), route).toBe(true);
    }
    for (const base of ["/servicos", "/produtos"] as const) {
      await searchList(page, base, tk);
      await expect(row(page, longName.slice(0, 30))).toBeVisible();
      expect(await noHScroll(page), `${base} lista com nome longo`).toBe(true);
      await page.locator(`a[aria-label="Editar ${longName}"]:visible`).click();
      await expect(page).toHaveURL(/\/editar$/);
      expect(await noHScroll(page), `${base} editar com nome longo`).toBe(true);
    }
  });

  test("barra inferior do celular chega a Serviços e Produtos; menu inclui Estoque", async ({
    page,
  }, testInfo) => {
    await login(page);
    const nav = page.getByRole("navigation", { name: "Navegação principal" });
    const mobile = testInfo.project.name === "mobile";
    // No celular, Serviços e Produtos ficam no "Mais" (diálogo); no desktop, no menu lateral.
    const goTo = async (name: string) => {
      if (mobile) {
        await nav.getByRole("button", { name: "Mais" }).click();
        await page.getByRole("dialog").getByRole("link", { name }).click();
      } else {
        await nav.getByRole("link", { name }).click();
      }
    };
    await goTo("Serviços");
    await expect(page).toHaveURL(/\/servicos$/);
    await expect(page.getByRole("heading", { level: 1, name: "Serviços" })).toBeVisible();
    await goTo("Produtos");
    await expect(page).toHaveURL(/\/produtos$/);
    await expect(page.getByRole("heading", { level: 1, name: "Produtos" })).toBeVisible();
    await nav.getByRole("link", { name: "Clientes" }).click();
    await expect(page).toHaveURL(/\/clientes$/);
    // dispatchEvent: o indicador do Next dev cobre o canto inferior esquerdo e intercepta o clique
    await nav.getByRole("link", { name: "Início" }).dispatchEvent("click");
    await expect(page).toHaveURL(/\/$/);
    expect(await noHScroll(page)).toBe(true);
    if (testInfo.project.name === "mobile") {
      // 4 links + o botão "Mais", todos dentro da viewport
      const links = nav.getByRole("link");
      await expect(links).toHaveCount(4);
      const slots = nav.locator("a:visible, button:visible");
      await expect(slots).toHaveCount(5);
      for (let i = 0; i < 5; i++) {
        const box = await slots.nth(i).boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(375.5);
      }
    } else {
      await expect(nav.getByText("Atendimentos")).toBeVisible();
    }
  });
});
