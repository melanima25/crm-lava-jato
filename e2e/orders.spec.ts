import {
  typeSearch,
  badge,
  brl,
  cashRows,
  completeFiado,
  completeWith,
  confirmPayment,
  createOrderQuick,
  createService,
  dialog,
  expect,
  listRow,
  login,
  methodBtn,
  openComplete,
  orderIdFromUrl,
  pickServices,
  readCents,
  startQuick,
  test,
  dbNum,
  tile,
  token,
} from "./orders-helpers";

// Entrega 4: cenários (a)-(d) do roadmap e regras de recebimento. Cada teste cria cliente e serviços
// com nomes únicos e assere por linha do atendimento (o caixa/lista do dia é global e compartilhado).

const balance = (page: import("@playwright/test").Page) => page.getByTestId("order-balance");
const paid = (page: import("@playwright/test").Page) => page.getByTestId("order-paid");
const total = (page: import("@playwright/test").Page) => page.getByTestId("order-total");

test.describe("recebimento: cenários do roadmap", () => {
  test("(a) cliente novo, 2 serviços, concluir em Pix -> caixa do dia", async ({ page }) => {
    await login(page);
    const tk = token();
    const s1 = `${tk} Lavagem`;
    const s2 = `${tk} Cera`;
    await createService(page, { name: s1, car: "30" });
    await createService(page, { name: s2, car: "20" });
    const cliente = `${tk} Cliente`;

    await startQuick(page, { name: cliente, type: "Carro" });
    await pickServices(page, [s1, s2]);
    await expect(page.getByTestId("order-total")).toHaveText(brl(5000));
    await page.getByRole("button", { name: "Criar e concluir", exact: true }).click();
    await expect(dialog(page).getByRole("heading", { name: "Concluir e receber" })).toBeVisible();
    await methodBtn(page, "Pix").click();
    await expect(dialog(page).getByLabel(/^Valor em Pix/)).toHaveValue("50,00");
    await confirmPayment(page, "Concluir e receber");

    const id = await orderIdFromUrl(page);
    await expect(badge(page)).toHaveText("Pago");
    await expect(total(page)).toHaveText(brl(5000));
    await expect(paid(page)).toHaveText(brl(5000));
    await expect(balance(page)).toHaveText(brl(0));

    // caixa do dia: a linha do cliente, em Pix, R$ 50; total do dia = soma das linhas = soma por forma
    await page.goto("/caixa");
    await expect(page.getByRole("heading", { level: 1, name: "Caixa do dia" })).toBeVisible();
    const row = listRow(page, cliente);
    await expect(row).toContainText("Pix");
    await expect(row).toContainText(brl(5000));
    // "Entradas" = soma das linhas de ENTRADA do extrato (o extrato também lista saídas, E7). Só confere a
    // soma quando o dia cabe em uma página (o banco de teste é compartilhado e o dia pagina em 200).
    const rows = (await cashRows(page)).filter((r) => r.dir === "IN");
    const sum = rows.reduce((s, r) => s + r.cents, 0);
    const paginated = (await page.getByText(/Página \d+ de \d+/).count()) > 0;
    if (!paginated) expect(await readCents(page.getByTestId("cash-total"))).toBe(sum);
    const byMethod =
      (await readCents(page.getByTestId("cash-CASH"))) +
      (await readCents(page.getByTestId("cash-PIX"))) +
      (await readCents(page.getByTestId("cash-DEBIT_CARD"))) +
      (await readCents(page.getByTestId("cash-CREDIT_CARD")));
    if (!paginated) expect(byMethod).toBe(sum);
    expect(await readCents(page.getByTestId("cash-PIX"))).toBeGreaterThanOrEqual(5000);

    // lista de atendimentos: selo "Pago" na linha do cliente
    await page.goto("/atendimentos");
    await expect(listRow(page, cliente).locator("[data-slot=order-status]")).toHaveText("Pago");
    expect(id).toBeGreaterThan(0);
  });

  test("(b) Fiado: conclui sem lançar no caixa; situação Não pago", async ({ page }) => {
    await login(page);
    const tk = token();
    const s = `${tk} Lavagem`;
    await createService(page, { name: s, car: "45" });
    const cliente = `${tk} Cliente`;
    await createOrderQuick(page, { name: cliente, services: [s] });
    await expect(badge(page)).toHaveText("Em andamento");

    await openComplete(page);
    // Fiado só na conclusão; escolher Fiado dispensa valores
    await methodBtn(page, "Fiado").click();
    await expect(dialog(page).getByRole("status")).toContainText("nada entra no caixa");
    await expect(dialog(page).getByRole("textbox")).toHaveCount(0);
    await confirmPayment(page, "Concluir no fiado");
    await expect(dialog(page)).toBeHidden();

    await expect(badge(page)).toHaveText("Não pago");
    await expect(paid(page)).toHaveText(brl(0));
    await expect(balance(page)).toHaveText(brl(4500));
    await expect(page.getByText("Nenhum pagamento registrado.")).toBeVisible();

    await page.goto("/caixa");
    await expect(page.getByRole("heading", { name: "Extrato" })).toBeVisible();
    await expect(page.getByText(cliente)).toHaveCount(0);
    await page.goto("/atendimentos");
    const row = listRow(page, cliente);
    await expect(row.locator("[data-slot=order-status]")).toHaveText("Não pago");
    await expect(row).toContainText(brl(4500));
  });

  test("(c) misto R$ 80: R$ 30 no Pix -> Parcial, saldo R$ 50; depois quita o saldo", async ({
    page,
  }) => {
    await login(page);
    const tk = token();
    const s = `${tk} Polimento`;
    await createService(page, { name: s, car: "80" });
    const cliente = `${tk} Cliente`;
    await createOrderQuick(page, { name: cliente, services: [s] });
    const detailUrl = page.url();

    await openComplete(page);
    await methodBtn(page, "Pix").click();
    await dialog(page)
      .getByLabel(/^Valor em Pix/)
      .fill("30");
    // antes de confirmar: aviso do restante
    await expect(dialog(page).getByRole("status")).toHaveText(
      /Restante\s+R\$\s*50,00\s+fica no fiado/,
    );
    await confirmPayment(page, "Concluir e receber");
    await expect(dialog(page)).toBeHidden();

    await expect(badge(page)).toHaveText("Parcial");
    await expect(paid(page)).toHaveText(brl(3000));
    await expect(balance(page)).toHaveText(brl(5000));

    await page.goto("/caixa");
    await expect(listRow(page, cliente)).toContainText(brl(3000));
    await expect(listRow(page, cliente)).toContainText("Pix");

    // pagamento posterior do saldo
    await page.goto(detailUrl);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Registrar pagamento" }).click();
    const d = dialog(page);
    await expect(d.getByRole("heading", { name: "Registrar pagamento" })).toBeVisible();
    await expect(d.getByRole("button", { name: "Fiado", exact: true })).toHaveCount(0);
    await methodBtn(page, "Dinheiro").click();
    await expect(d.getByLabel(/^Valor em Dinheiro/)).toHaveValue("50,00");
    await confirmPayment(page, "Registrar pagamento");
    await expect(d).toBeHidden();
    await expect(badge(page)).toHaveText("Pago");
    await expect(balance(page)).toHaveText(brl(0));
    await expect(paid(page)).toHaveText(brl(8000));
    await expect(page.getByRole("button", { name: "Registrar pagamento" })).toHaveCount(0);

    await page.goto("/caixa");
    const rows = (await cashRows(page)).filter((r) => r.text.includes(cliente));
    expect(rows.map((r) => r.cents).sort((a, b) => a - b)).toEqual([3000, 5000]);
  });

  test("(d) misto com duas formas (R$ 50 dinheiro + R$ 30 Pix) = Pago; soma acima bloqueada", async ({
    page,
  }) => {
    await login(page);
    const tk = token();
    const s = `${tk} Polimento`;
    await createService(page, { name: s, car: "80" });
    const cliente = `${tk} Cliente`;
    await createOrderQuick(page, { name: cliente, services: [s] });

    await openComplete(page);
    const d = dialog(page);
    await methodBtn(page, "Dinheiro").click();
    await d.getByLabel(/^Valor em Dinheiro/).fill("50");
    await expect(d.getByRole("status")).toContainText("fica no fiado");
    await d.getByRole("button", { name: "+ outra forma" }).click();
    // 2ª linha: forma diferente da 1ª, já com o restante
    await expect(d.getByLabel(/^Valor em Pix/)).toHaveValue("30,00");
    await expect(d.getByRole("status")).toHaveCount(0); // nada restando

    // soma acima do total: bloqueia
    await d.getByLabel(/^Valor em Pix/).fill("40");
    await expect(d.getByRole("alert")).toHaveText(
      /A soma passa do total em\s+R\$\s*10,00\.\s*Reduza os valores\./,
    );
    await expect(d.getByRole("button", { name: "Concluir e receber", exact: true })).toBeDisabled();
    await expect(d.getByRole("button", { name: "+ outra forma" })).toBeDisabled();

    // remover a linha 2 volta ao restante no fiado
    await d.getByRole("button", { name: "Remover linha 2" }).click();
    await expect(d.getByRole("status")).toHaveText(/Restante\s+R\$\s*30,00\s+fica no fiado/);
    await d.getByRole("button", { name: "+ outra forma" }).click();
    await d.getByLabel(/^Valor em Pix/).fill("30");
    await confirmPayment(page, "Concluir e receber");
    await expect(d).toBeHidden();

    await expect(badge(page)).toHaveText("Pago");
    await expect(paid(page)).toHaveText(brl(8000));
    await expect(page.getByRole("list", { name: "Histórico de pagamentos" })).toContainText("Pix");
    await expect(page.getByRole("list", { name: "Histórico de pagamentos" })).toContainText(
      "Dinheiro",
    );

    await page.goto("/caixa");
    const rows = (await cashRows(page)).filter((r) => r.text.includes(cliente));
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.text.includes("Dinheiro"))?.cents).toBe(5000);
    expect(rows.find((r) => r.text.includes("Pix"))?.cents).toBe(3000);
  });
});

test.describe("pagamentos: regras", () => {
  test("pagamento maior que o saldo: bloqueado no diálogo e rejeitado pelo servidor", async ({
    page,
    context,
  }) => {
    await login(page);
    const tk = token();
    const s = `${tk} Polimento`;
    await createService(page, { name: s, car: "80" });
    const cliente = `${tk} Cliente`;
    const id = await createOrderQuick(page, { name: cliente, services: [s] });
    await completeWith(page, "Pix"); // pago 80
    // estorna para ter um saldo conhecido? não: crie parcial via segundo atendimento
    expect(id).toBeGreaterThan(0);

    const s2 = `${tk} Cera`;
    await createService(page, { name: s2, car: "80" });
    const id2 = await createOrderQuick(page, { name: `${tk} Outro`, services: [s2] });
    await completeFiado(page);
    await expect(balance(page)).toHaveText(brl(8000));

    // 1) no diálogo: valor acima do saldo
    await page.getByRole("button", { name: "Registrar pagamento" }).click();
    const d = dialog(page);
    await methodBtn(page, "Pix").click();
    await d.getByLabel(/^Valor em Pix/).fill("80,01");
    await expect(d.getByRole("alert")).toContainText("A soma passa do total");
    await expect(
      d.getByRole("button", { name: "Registrar pagamento", exact: true }),
    ).toBeDisabled();
    // zero e vazio também não confirmam
    await d.getByLabel(/^Valor em Pix/).fill("0");
    await expect(
      d.getByRole("button", { name: "Registrar pagamento", exact: true }),
    ).toBeDisabled();
    await d.getByLabel(/^Valor em Pix/).fill("");
    await expect(
      d.getByRole("button", { name: "Registrar pagamento", exact: true }),
    ).toBeDisabled();

    // 2) servidor: diálogo "velho" aberto enquanto outra aba paga R$ 30
    await d.getByLabel(/^Valor em Pix/).fill("80");
    const other = await context.newPage();
    await other.goto(`/atendimentos/${id2}`);
    await other.waitForLoadState("networkidle");
    await other.getByRole("button", { name: "Registrar pagamento" }).click();
    await methodBtn(other, "Débito").click();
    await other.getByLabel(/^Valor em Débito/).fill("30");
    await confirmPayment(other, "Registrar pagamento");
    await expect(badge(other)).toHaveText("Parcial");
    await other.close();

    await confirmPayment(page, "Registrar pagamento");
    await expect(d.getByRole("alert").first()).toContainText(
      /maior que o saldo|quitado|não pode ser maior/,
    );
    await expect(d).toBeVisible(); // permanece aberto para corrigir
    await d.getByRole("button", { name: "Cancelar" }).click();
    await page.reload();
    await expect(paid(page)).toHaveText(brl(3000)); // nada além dos R$ 30 da outra aba
    await expect(balance(page)).toHaveText(brl(5000));
  });

  test("estorno devolve o saldo e tira do caixa; cancelar com pagamento é bloqueado", async ({
    page,
  }) => {
    await login(page);
    const tk = token();
    const s = `${tk} Polimento`;
    await createService(page, { name: s, car: "80" });
    const cliente = `${tk} Cliente`;
    await createOrderQuick(page, { name: cliente, services: [s] });
    const detailUrl = page.url();
    await openComplete(page);
    await methodBtn(page, "Pix").click();
    await dialog(page)
      .getByLabel(/^Valor em Pix/)
      .fill("30");
    await confirmPayment(page, "Concluir e receber");
    await expect(badge(page)).toHaveText("Parcial");

    // cancelar com pagamento: erro do servidor e continua concluído
    await page.getByRole("button", { name: "Cancelar atendimento", exact: true }).click();
    await expect(
      dialog(page).getByRole("heading", { name: "Cancelar atendimento?" }),
    ).toBeVisible();
    await dialog(page).getByRole("button", { name: "Cancelar atendimento", exact: true }).click();
    await expect(dialog(page)).toContainText(
      "Não é possível cancelar um atendimento com pagamentos. Estorne-os antes.",
    );
    await dialog(page).getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(badge(page)).toHaveText("Parcial");

    // estorno (com confirmação; cancelar no diálogo não estorna)
    const estornar = page.getByRole("button", { name: "Estornar pagamento de R$ 30,00 em Pix" });
    await estornar.click();
    await expect(dialog(page).getByRole("heading", { name: "Estornar pagamento?" })).toBeVisible();
    await dialog(page).getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(paid(page)).toHaveText(brl(3000));
    await estornar.click();
    await dialog(page).getByRole("button", { name: "Estornar", exact: true }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(paid(page)).toHaveText(brl(0));
    await expect(balance(page)).toHaveText(brl(8000));
    await expect(badge(page)).toHaveText("Não pago");

    await page.goto("/caixa");
    await expect(page.getByRole("heading", { name: "Extrato" })).toBeVisible();
    await expect(page.getByText(cliente)).toHaveCount(0);

    // agora o cancelamento é permitido (a OS concluída, sem pagamentos)
    await page.goto(detailUrl);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Cancelar atendimento", exact: true }).click();
    await dialog(page).getByRole("button", { name: "Cancelar atendimento", exact: true }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(badge(page)).toHaveText("Cancelado");
    await expect(page.getByRole("button", { name: "Registrar pagamento" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Concluir", exact: true })).toHaveCount(0);
    await expect(balance(page)).toHaveCount(0);
  });

  test("cancelar atendimento em andamento", async ({ page }) => {
    await login(page);
    const tk = token();
    const s = `${tk} Lavagem`;
    await createService(page, { name: s, car: "20" });
    const cliente = `${tk} Cliente`;
    await createOrderQuick(page, { name: cliente, services: [s] });
    await page.getByRole("button", { name: "Cancelar atendimento", exact: true }).click();
    await dialog(page).getByRole("button", { name: "Cancelar atendimento", exact: true }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(badge(page)).toHaveText("Cancelado");
    await page.goto("/atendimentos?status=CANCELED");
    await expect(listRow(page, cliente).locator("[data-slot=order-status]")).toHaveText(
      "Cancelado",
    );
    // não conta no total de atendimentos ativos nem aparece em "Concluídos"
    await page.goto("/atendimentos?status=DONE");
    await expect(page.getByText(cliente)).toHaveCount(0);
  });

  test("duplo clique em 'Concluir e receber' não duplica o pagamento", async ({ page }) => {
    await login(page);
    const tk = token();
    const s = `${tk} Lavagem`;
    await createService(page, { name: s, car: "40" });
    const id = await createOrderQuick(page, { name: `${tk} Cliente`, services: [s] });
    await openComplete(page);
    await methodBtn(page, "Pix").click();
    await dialog(page)
      .getByRole("button", { name: "Concluir e receber", exact: true })
      .dblclick({ delay: 10 })
      .catch(() => undefined); // o diálogo fecha entre os cliques
    await expect(badge(page)).toHaveText("Pago");
    await expect(paid(page)).toHaveText(brl(4000));
    await expect(
      page.getByRole("list", { name: "Histórico de pagamentos" }).locator("li"),
    ).toHaveCount(1);
    expect(dbNum("select count(*) from CashEntry where serviceOrderId = ?", id)).toBe(1);
  });
});

test.describe("itens, desconto e preços", () => {
  test("preço sugerido por tipo do veículo (carro x moto), editável; serviço só de um tipo", async ({
    page,
  }) => {
    await login(page);
    const tk = token();
    const both = `${tk} Ambos`;
    const onlyCar = `${tk} SoCarro`;
    const onlyMoto = `${tk} SoMoto`;
    await createService(page, { name: both, car: "40", moto: "25" });
    await createService(page, { name: onlyCar, car: "10" });
    await createService(page, { name: onlyMoto, moto: "15" });

    await startQuick(page, { name: `${tk} Cliente`, type: "Carro" });
    await expect(tile(page, both)).toContainText("R$ 40,00");
    await expect(tile(page, onlyCar)).toBeVisible();
    await expect(tile(page, onlyMoto)).toHaveCount(0);

    // trocar o tipo troca a lista e os preços
    await page.getByRole("radio", { name: "Moto", exact: true }).click();
    await expect(tile(page, both)).toContainText("R$ 25,00");
    await expect(tile(page, onlyMoto)).toBeVisible();
    await expect(tile(page, onlyCar)).toHaveCount(0);

    await pickServices(page, [both]);
    await expect(page.getByTestId("order-total")).toHaveText(brl(2500));
    // preço editável no item
    await page.getByLabel(`Preço unitário de ${both}`).fill("22,5");
    await expect(page.getByTestId("order-total")).toHaveText(brl(2250));
    // quantidade
    await page.getByRole("button", { name: "Aumentar quantidade" }).click();
    await expect(page.getByTestId("order-total")).toHaveText(brl(4500));
    await page.getByRole("button", { name: "Diminuir quantidade" }).click();
    await page.getByRole("button", { name: "Criar atendimento", exact: true }).click();
    await orderIdFromUrl(page);
    await expect(total(page)).toHaveText(brl(2250));
    await expect(page.getByRole("list", { name: "Itens do atendimento" })).toContainText(
      /1 ×\s*R\$\s*22,50/,
    );
    await expect(badge(page)).toHaveText("Em andamento");

    // editar o item no detalhe: quantidade 2 e preço 20 => total 40
    await page.getByRole("button", { name: `Editar ${both}` }).click();
    await dialog(page).getByRole("button", { name: "Aumentar quantidade" }).click();
    await dialog(page).getByLabel("Preço unitário").fill("20");
    await dialog(page).getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(total(page)).toHaveText(brl(4000));
  });

  test("desconto: total = subtotal - desconto; desconto acima do subtotal rejeitado", async ({
    page,
  }) => {
    await login(page);
    const tk = token();
    const s = `${tk} Lavagem`;
    await createService(page, { name: s, car: "100" });
    await startQuick(page, { name: `${tk} Cliente`, type: "Carro" });
    await pickServices(page, [s]);
    await page.getByRole("button", { name: "Desconto e observação" }).click();
    await page.locator("#order-discount").fill("150");
    await expect(page.getByText("O desconto não pode ser maior que o subtotal")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Criar atendimento", exact: true }),
    ).toBeDisabled();
    await expect(page.getByRole("button", { name: "Criar e concluir" })).toBeDisabled();
    await page.locator("#order-discount").fill("100"); // igual ao subtotal: permitido (total zero)
    await expect(page.getByTestId("order-total")).toHaveText(brl(0));
    await page.locator("#order-discount").fill("10,50");
    await expect(page.getByTestId("order-total")).toHaveText(brl(8950));
    await page.getByLabel("Observação").fill("Cliente pediu capricho");
    await page.getByRole("button", { name: "Criar atendimento", exact: true }).click();
    await orderIdFromUrl(page);
    await expect(total(page)).toHaveText(brl(8950));
    await expect(page.getByText("Cliente pediu capricho")).toBeVisible();

    // edição no detalhe: acima do subtotal bloqueia; válido recalcula
    await page.getByRole("button", { name: "Desconto e observação" }).click();
    await dialog(page).getByLabel("Desconto").fill("100,01");
    await expect(
      dialog(page).getByText("O desconto não pode ser maior que o subtotal"),
    ).toBeVisible();
    await expect(dialog(page).getByRole("button", { name: "Salvar", exact: true })).toBeDisabled();
    await dialog(page).getByLabel("Desconto").fill("20");
    await dialog(page).getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(total(page)).toHaveText(brl(8000));

    // desconto integral (total R$ 0) conclui sem cobrar
    await page.getByRole("button", { name: "Desconto e observação" }).click();
    await dialog(page).getByLabel("Desconto").fill("100");
    await dialog(page).getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(total(page)).toHaveText(brl(0));
    await openComplete(page);
    await expect(dialog(page)).toContainText("O total é R$ 0,00");
    await confirmPayment(page, "Concluir e receber");
    await expect(badge(page)).toHaveText("Pago");
  });

  test("adicionar e remover serviço no detalhe; OS concluída não fica sem itens", async ({
    page,
  }) => {
    await login(page);
    const tk = token();
    const a = `${tk} Alfa`;
    const b = `${tk} Beta`;
    await createService(page, { name: a, car: "30" });
    await createService(page, { name: b, car: "20" });
    await createOrderQuick(page, { name: `${tk} Cliente`, services: [a] });
    await page.getByRole("button", { name: "Adicionar serviço", exact: true }).click();
    await tile(page, b).click();
    await expect(total(page)).toHaveText(brl(5000));
    await page.getByRole("button", { name: `Remover ${b}` }).click();
    await expect(dialog(page).getByRole("heading", { name: "Remover serviço?" })).toBeVisible();
    await dialog(page).getByRole("button", { name: "Remover", exact: true }).click();
    await expect(total(page)).toHaveText(brl(3000));

    await completeWith(page, "Dinheiro");
    // o último item de uma OS concluída não pode ser removido
    await page.getByRole("button", { name: `Remover ${a}` }).click();
    await dialog(page).getByRole("button", { name: "Remover", exact: true }).click();
    await expect(dialog(page)).toContainText("precisa de ao menos um item");
    await dialog(page).getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(total(page)).toHaveText(brl(3000));
    // não dá para reduzir o total abaixo do já pago
    await page.getByRole("button", { name: `Editar ${a}` }).click();
    await dialog(page).getByLabel("Preço unitário").fill("10");
    await dialog(page).getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(dialog(page).getByRole("alert")).toContainText("menor que o valor já pago");
  });
});

test.describe("cliente existente", () => {
  test("busca por nome e por placa; único veículo já vem selecionado; 'Outro veículo'", async ({
    page,
  }) => {
    await login(page);
    const tk = token();
    const s = `${tk} Lavagem`;
    await createService(page, { name: s, car: "30", moto: "20" });
    const cliente = `${tk} Cliente`;
    const plate = `${"BCD"}${Math.floor(Math.random() * 10)}${"F"}${Math.floor(Math.random() * 100)
      .toString()
      .padStart(2, "0")}`;
    await createOrderQuick(page, { name: cliente, type: "Carro", services: [s], plate });
    const href = await page.locator('a[href^="/clientes/"]').first().getAttribute("href");
    expect(href).toMatch(/^\/clientes\/\d+$/);

    // por nome
    await page.goto("/atendimentos/novo");
    await page.waitForLoadState("networkidle");
    const box = page.getByRole("searchbox");
    await typeSearch(page, box, cliente);
    const found = page.getByRole("list", { name: "Clientes encontrados" }).getByRole("link");
    await expect(found).toHaveCount(1);
    await expect(found).toContainText("1 veículo");
    await found.click();
    await expect(page).toHaveURL(/cliente=\d+/);
    // veículo pré-selecionado, serviços à mostra, sem campos de veículo novo
    await expect(page.getByRole("radio", { name: /Outro veículo/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await expect(page.getByRole("radiogroup").first().getByRole("radio").first()).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(tile(page, s)).toContainText("R$ 30,00");
    await expect(page.getByLabel("Placa (opcional)")).toHaveCount(0);

    // "Outro veículo": escolher Moto troca o preço sugerido
    await page.getByRole("radio", { name: /Outro veículo/ }).click();
    await page.getByRole("radio", { name: "Moto", exact: true }).click();
    await expect(tile(page, s)).toContainText("R$ 20,00");

    // por placa (com ou sem hífen/minúsculas)
    await page.goto(`/atendimentos/novo?q=${plate.toLowerCase()}`);
    await expect(
      page.getByRole("list", { name: "Clientes encontrados" }).getByRole("link", { name: cliente }),
    ).toBeVisible();

    // volta ao veículo original e faz o fluxo até o fim (2º atendimento do mesmo cliente)
    await page.goto(href!.replace("/clientes/", "/atendimentos/novo?cliente="));
    await pickServices(page, [s]);
    await page.getByRole("button", { name: "Criar atendimento", exact: true }).click();
    await orderIdFromUrl(page);
    await expect(
      page.getByRole("link", { name: new RegExp(plate.slice(0, 3)) }).first(),
    ).toBeVisible();
  });
});

test.describe("lista de atendimentos", () => {
  test("filtro por status e por dia", async ({ page }) => {
    await login(page);
    const tk = token();
    const s = `${tk} Lavagem`;
    await createService(page, { name: s, car: "20" });
    const aberto = `${tk} Aberto`;
    const pago = `${tk} Pago`;
    const fiado = `${tk} Fiado`;
    await createOrderQuick(page, { name: aberto, services: [s] });
    await createOrderQuick(page, { name: pago, services: [s] });
    await completeWith(page, "Pix");
    await createOrderQuick(page, { name: fiado, services: [s] });
    await completeFiado(page);

    await page.goto("/atendimentos");
    await page.waitForLoadState("networkidle");
    await expect(listRow(page, aberto).locator("[data-slot=order-status]")).toHaveText(
      "Em andamento",
    );
    await expect(listRow(page, pago).locator("[data-slot=order-status]")).toHaveText("Pago");
    await expect(listRow(page, fiado).locator("[data-slot=order-status]")).toHaveText("Não pago");

    await page.getByRole("button", { name: "Concluídos", exact: true }).click();
    await expect(page).toHaveURL(/status=DONE/);
    await expect(page.getByRole("button", { name: "Concluídos", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(listRow(page, pago)).toBeVisible();
    await expect(page.getByText(aberto)).toHaveCount(0);
    await page.getByRole("button", { name: "Em andamento", exact: true }).click();
    await expect(page).toHaveURL(/status=OPEN/);
    await expect(listRow(page, aberto)).toBeVisible();
    await expect(page.getByText(pago)).toHaveCount(0);

    // dia anterior: não mostra os de hoje; "Hoje" volta
    await page.getByRole("link", { name: "Dia anterior" }).click();
    await expect(page).toHaveURL(/data=\d{4}-\d{2}-\d{2}/);
    await expect(page.getByText(aberto)).toHaveCount(0);
    await page.getByRole("link", { name: "Hoje", exact: true }).click();
    await expect(page).not.toHaveURL(/data=/);
    await expect(listRow(page, aberto)).toBeVisible();
    // data inválida cai em hoje sem quebrar
    await page.goto("/atendimentos?data=2026-02-31&status=xyz");
    await expect(page.getByRole("heading", { level: 1, name: "Atendimentos" })).toBeVisible();
  });
});
