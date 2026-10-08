import {
  badge,
  brl,
  confirmPayment,
  createOrderQuick,
  createService,
  dialog,
  expect,
  gotoReady,
  listRow,
  login,
  methodBtn,
  noHScroll,
  openComplete,
  orderIdFromUrl,
  pickServices,
  startQuick,
  test,
  dbNum,
  dbRun,
  tile,
  token,
} from "./orders-helpers";

// Entrega 4: acesso, 404, sessão expirada, estoque, fuso, exclusão de cadastros usados e toques.

test.describe("acesso e rotas de atendimentos/caixa", () => {
  for (const route of [
    "/atendimentos",
    "/atendimentos/novo",
    "/atendimentos/novo?rapido=1",
    "/atendimentos/1",
    "/caixa",
  ]) {
    test(`sem sessão, ${route} redireciona para /login`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login$/);
    });
  }

  test("ids inexistentes/inválidos mostram 404 amigável", async ({ page }) => {
    await login(page);
    for (const path of [
      "/atendimentos/999999",
      "/atendimentos/abc",
      "/atendimentos/-1",
      "/atendimentos/1.5",
      "/atendimentos/0",
      "/atendimentos/novo?cliente=999999",
      "/atendimentos/novo?cliente=abc",
    ]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
      await expect(page.getByText(/não encontrad|404/i).first()).toBeVisible();
      await expect(page.getByText(/Prisma|stack|TypeError|Unhandled/i)).toHaveCount(0);
    }
  });

  test("sem sessão, Concluir leva ao /login sem erro do Next", async ({ page, context }) => {
    await login(page);
    const tk = token();
    const s = `${tk} Lavagem`;
    await createService(page, { name: s, car: "10" });
    await createOrderQuick(page, { name: `${tk} Cliente`, services: [s] });
    await page.waitForLoadState("networkidle");
    await context.clearCookies();
    await openComplete(page);
    await methodBtn(page, "Pix").click();
    await confirmPayment(page, "Concluir e receber");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(/Application error|Unhandled/i)).toHaveCount(0);
  });

  test("sem sessão, criar atendimento leva ao /login", async ({ page, context }) => {
    await login(page);
    const tk = token();
    const s = `${tk} Lavagem`;
    await createService(page, { name: s, car: "10" });
    await startQuick(page, { name: `${tk} Cliente`, type: "Carro" });
    await pickServices(page, [s]);
    await context.clearCookies();
    await page.getByRole("button", { name: "Criar atendimento", exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("cadastros usados em atendimentos (D-35/D-40)", () => {
  test("excluir serviço usado sugere Inativar; Inativar funciona e some do novo atendimento", async ({
    page,
  }) => {
    await login(page);
    const tk = token();
    const s = `${tk} Usado`;
    await createService(page, { name: s, car: "10" });
    await createOrderQuick(page, { name: `${tk} Cliente`, services: [s] });

    await page.goto(`/servicos?q=${encodeURIComponent(s)}`);
    await page.waitForLoadState("networkidle");
    await page.locator(`button[aria-label="Excluir ${s}"]:visible`).click();
    await dialog(page).getByRole("button", { name: "Excluir definitivamente" }).click();
    await expect(dialog(page)).toContainText("Use “Inativar”");
    await dialog(page).getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(dialog(page)).toBeHidden();

    await page.locator(`button[aria-label="Inativar ${s}"]:visible`).click();
    await dialog(page).getByRole("button", { name: "Inativar", exact: true }).click();
    await expect(page.getByText("Serviço inativado")).toBeVisible();

    // serviço inativo não aparece em novos atendimentos
    await startQuick(page, { name: `${tk} Outro`, type: "Carro" });
    await expect(tile(page, s)).toHaveCount(0);
  });

  test("excluir produto usado em item de atendimento é bloqueado (item inserido no banco)", async ({
    page,
  }) => {
    await login(page);
    const tk = token();
    const s = `${tk} Lavagem`;
    await createService(page, { name: s, car: "10" });
    const orderId = await createOrderQuick(page, { name: `${tk} Cliente`, services: [s] });
    const prod = `${tk} Produto`;
    await gotoReady(page, "/produtos/novo");
    await page.getByLabel("Nome", { exact: true }).fill(prod);
    await page.getByRole("button", { name: "Cadastrar produto" }).click();
    await expect(page).toHaveURL(/\/produtos$/);
    const pid = dbNum("select id from Product where name = ?", prod);
    // UI de venda de produto só vem na E8: simula o item PRODUCT direto no banco.
    dbRun(
      `insert into ServiceOrderItem (orderId, kind, productId, description, quantity, unitPriceCents, totalCents)
       values (?, 'PRODUCT', ?, ?, 1, 500, 500)`,
      orderId,
      pid,
      prod,
    );
    await page.goto(`/produtos?q=${encodeURIComponent(prod)}`);
    await page.waitForLoadState("networkidle");
    await page.locator(`button[aria-label="Excluir ${prod}"]:visible`).click();
    await dialog(page).getByRole("button", { name: "Excluir definitivamente" }).click();
    await expect(dialog(page)).toContainText("Use “Inativar”");
    await dialog(page).getByRole("button", { name: "Cancelar", exact: true }).click();
    await page.locator(`button[aria-label="Inativar ${prod}"]:visible`).click();
    await dialog(page).getByRole("button", { name: "Inativar", exact: true }).click();
    await expect(page.getByText("Produto inativado")).toBeVisible();
    dbRun("delete from ServiceOrderItem where orderId = ? and kind = 'PRODUCT'", orderId);
  });
});

test.describe("critério 7: serviço nunca altera estoque", () => {
  test("estoque do produto e a soma do estoque não mudam em criar/concluir/parcial/estornar/cancelar", async ({
    page,
  }) => {
    await login(page);
    const tk = token();
    const prod = `${tk} Cera`;
    await gotoReady(page, "/produtos/novo");
    await page.getByLabel("Nome", { exact: true }).fill(prod);
    await page.getByRole("button", { name: "Cadastrar produto" }).click();
    await expect(page).toHaveURL(/\/produtos$/);
    const pid = dbNum("select id from Product where name = ?", prod);
    dbRun("update Product set stockQuantity = 7 where id = ?", pid);

    const stock = async () => dbNum("select stockQuantity from Product where id = ?", pid);
    const sumAll = async () => dbNum("select coalesce(sum(stockQuantity),0) from Product");
    const sum0 = await sumAll();

    const s = `${tk} Lavagem com ${prod}`;
    await createService(page, { name: s, car: "80" });
    await createOrderQuick(page, { name: `${tk} Cliente`, services: [s] });
    expect(await stock()).toBe(7);
    // aumenta a quantidade do serviço (x3): estoque segue igual
    await page.getByRole("button", { name: `Editar ${s}` }).click();
    await dialog(page).getByRole("button", { name: "Aumentar quantidade" }).click();
    await dialog(page).getByRole("button", { name: "Aumentar quantidade" }).click();
    await dialog(page).getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(page.getByTestId("order-total")).toHaveText(brl(24000));
    expect(await stock()).toBe(7);

    await openComplete(page);
    await methodBtn(page, "Pix").click();
    await dialog(page)
      .getByLabel(/^Valor em Pix/)
      .fill("100");
    await confirmPayment(page, "Concluir e receber");
    await expect(badge(page)).toHaveText("Parcial");
    expect(await stock()).toBe(7);

    await page.getByRole("button", { name: "Estornar pagamento de R$ 100,00 em Pix" }).click();
    await dialog(page).getByRole("button", { name: "Estornar", exact: true }).click();
    await expect(badge(page)).toHaveText("Não pago");
    expect(await stock()).toBe(7);

    await page.getByRole("button", { name: "Cancelar atendimento", exact: true }).click();
    await dialog(page).getByRole("button", { name: "Cancelar atendimento", exact: true }).click();
    await expect(badge(page)).toHaveText("Cancelado");
    expect(await stock()).toBe(7);
    expect(await sumAll()).toBe(sum0);
  });
});

test.describe("fuso America/Sao_Paulo (caixa e lista)", () => {
  test("pagamentos perto da meia-noite BRT caem no dia local certo", async ({ page }, testInfo) => {
    await login(page);
    // Dia isolado por projeto (o banco é compartilhado): totais exatos são seguros.
    const year = testInfo.project.name === "mobile" ? 2002 : 2001;
    const tk = token();
    const now = new Date().toISOString();
    const customerId = dbRun(
      "insert into Customer (name, searchName, active, createdAt, updatedAt) values (?, ?, true, ?, ?)",
      `${tk} Fuso`,
      tk.toLowerCase(),
      now,
      now,
    );
    const orderId = dbRun(
      `insert into ServiceOrder (customerId, status, occurredAt, discountCents, totalCents, paidCents, createdAt, updatedAt)
       values (?, 'DONE', ?, 0, 4000, 4000, ?, ?)`,
      customerId,
      new Date(`${year}-05-10T02:30:00Z`).toISOString(), // 09/05 23:30 BRT
      now,
      now,
    );
    const entry = (iso: string, method: "PIX" | "CASH", amountCents: number) =>
      dbRun(
        `insert into CashEntry (direction, amountCents, method, serviceOrderId, occurredAt, createdAt, updatedAt)
         values ('IN', ?, ?, ?, ?, ?, ?)`,
        amountCents,
        method,
        orderId,
        new Date(iso).toISOString(),
        now,
        now,
      );
    entry(`${year}-05-10T02:30:00Z`, "PIX", 3000); // 23:30 BRT do dia 09
    entry(`${year}-05-10T03:10:00Z`, "CASH", 1000); // 00:10 BRT do dia 10

    const d09 = `${year}-05-09`;
    const d10 = `${year}-05-10`;
    await page.goto(`/caixa?data=${d09}`);
    await expect(page.getByTestId("cash-total")).toHaveText(brl(3000));
    await expect(page.getByTestId("cash-PIX")).toHaveText(brl(3000));
    await expect(page.getByTestId("cash-CASH")).toHaveText(brl(0));
    await expect(listRow(page, `${tk} Fuso`)).toContainText("23:30");
    await page.goto(`/caixa?data=${d10}`);
    await expect(page.getByTestId("cash-total")).toHaveText(brl(1000));
    await expect(page.getByTestId("cash-CASH")).toHaveText(brl(1000));
    await expect(listRow(page, `${tk} Fuso`)).toContainText("00:10");

    // a OS (23:30 BRT do dia 09) aparece na lista do dia 09, não no 10
    await page.goto(`/atendimentos?data=${d09}`);
    await expect(listRow(page, `${tk} Fuso`)).toContainText("23:30");
    await expect(page.getByTestId("summary-received")).toHaveText(brl(3000));
    await page.goto(`/atendimentos?data=${d10}`);
    await expect(page.getByText(`${tk} Fuso`)).toHaveCount(0);
    await expect(page.getByTestId("summary-received")).toHaveText(brl(1000));
  });
});

test.describe("critério 8: toques no celular (cliente cadastrado, 1 serviço)", () => {
  for (const modo of ["à vista (Pix)", "Fiado"] as const) {
    test(`fluxo ${modo} em <= 6 toques`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "mobile", "medição em 375px");
      await login(page);
      const tk = token();
      const s = `${tk} Lavagem`;
      await createService(page, { name: s, car: "35" });
      const cliente = `${tk} Cliente`;
      await createOrderQuick(page, { name: cliente, type: "Carro", services: [s] });

      // Início da medição: tela Início do celular (o cliente já existe).
      await page.goto("/");
      await page.waitForLoadState("networkidle");
      let taps = 0;
      const tap = async (loc: import("@playwright/test").Locator) => {
        await loc.click();
        taps++;
      };
      await tap(page.getByRole("link", { name: /Novo atendimento/ }).first()); // 1
      await page.waitForLoadState("networkidle");
      await page.getByRole("searchbox").fill(cliente); // digitação (não conta como toque)
      await expect(page).toHaveURL(/q=/);
      await expect(
        page.getByRole("list", { name: "Clientes encontrados" }).getByRole("link"),
      ).toHaveCount(1);
      await tap(page.getByRole("list", { name: "Clientes encontrados" }).getByRole("link").first()); // 2
      await expect(page.getByRole("radio", { name: /Outro veículo/ })).toHaveAttribute(
        "aria-checked",
        "false",
      );
      await tap(tile(page, s)); // 3 (veículo já vem selecionado)
      await tap(page.getByRole("button", { name: "Criar e concluir" })); // 4
      await tap(methodBtn(page, modo === "Fiado" ? "Fiado" : "Pix")); // 5
      await tap(
        dialog(page).getByRole("button", {
          name: modo === "Fiado" ? "Concluir no fiado" : "Concluir e receber",
          exact: true,
        }),
      ); // 6
      await orderIdFromUrl(page);
      await expect(badge(page)).toHaveText(modo === "Fiado" ? "Não pago" : "Pago");
      console.log(`TOQUES ${modo}: ${taps}`);
      expect(taps).toBeLessThanOrEqual(6);
    });
  }
});

test.describe("layout: sem rolagem horizontal com nomes longos", () => {
  test("nomes longos sem espaços em lista, novo, detalhe e caixa", async ({ page }) => {
    await login(page);
    const tk = token();
    const longSvc = `${tk}${"Servicolongo".repeat(8)}`.slice(0, 100);
    const longCli = `${tk}${"Clientelongo".repeat(9)}`.slice(0, 120);
    await createService(page, { name: longSvc, car: "1.234,56" });
    await startQuick(page, { name: longCli, type: "Carro", plate: "" });
    await pickServices(page, [longSvc]);
    expect(await noHScroll(page), "novo").toBe(true);
    await page.getByRole("button", { name: "Criar e concluir" }).click();
    await methodBtn(page, "Pix").click();
    await confirmPayment(page, "Concluir e receber");
    await orderIdFromUrl(page);
    expect(await noHScroll(page), "detalhe").toBe(true);
    for (const route of ["/atendimentos", "/caixa", "/atendimentos/novo"]) {
      await page.goto(route);
      expect(await noHScroll(page), route).toBe(true);
    }
  });
});
