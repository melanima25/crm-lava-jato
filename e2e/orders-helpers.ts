import { expect, test as base, type Locator, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { TEST_DB_URL, TEST_USER } from "./constants";

// Helpers compartilhados pelos e2e de atendimentos/caixa. Desktop e mobile rodam em paralelo no
// mesmo banco: cada teste usa nomes únicos e assere por linha do atendimento, nunca por totais
// globais do dia.

const LETTERS = "BCDFGHJKLMNPQRSTVWXZ";
const rnd = (n: number) => Math.floor(Math.random() * n);
const letters = (n: number) =>
  Array.from({ length: n }, () => LETTERS[rnd(LETTERS.length)]).join("");
export const token = () => `Zq${letters(8)}`.toLowerCase().replace(/^./, (c) => c.toUpperCase());

export const test = base.extend<{ problems: string[] }>({
  problems: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("console", (m) => {
        if (m.type() !== "error" && m.type() !== "warning") return;
        const text = m.text();
        if (text.includes("status of 404")) return; // recurso 404 esperado (id inexistente)
        problems.push(`${m.type()}: ${text}`);
      });
      page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
      await use(problems);
      expect(problems).toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

export async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(TEST_USER.email);
  await page.getByLabel("Senha").fill(TEST_USER.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Bem-vindo" })).toBeVisible();
}

/**
 * Espera o React hidratar o elemento (o React grava __reactProps$/__reactFiber$ no nó ao hidratar). Em dev
 * o primeiro input pode chegar antes da hidratação e o texto digitado se perderia.
 */
export async function waitHydrated(loc: Locator) {
  await expect
    .poll(
      () =>
        loc.evaluate((el) =>
          Object.keys(el).some(
            (k) => k.startsWith("__reactProps$") || k.startsWith("__reactFiber$"),
          ),
        ),
      { message: "elemento ainda não hidratado" },
    )
    .toBe(true);
}

/**
 * page.goto + espera o React hidratar o primeiro controle de `main` (input/botão/formulário). Em dev, sob
 * carga, clicar/digitar antes disso perde o evento: o submit nativo ou o clique somem e o teste só falha
 * adiante (ex.: URL que nunca muda após "Cadastrar").
 */
export async function gotoReady(page: Page, url: string) {
  const res = await page.goto(url);
  const first = page
    .locator("main input:visible, main textarea:visible, main button:visible")
    .first();
  if (await first.count()) await waitHydrated(first);
  return res;
}

/**
 * Digita UMA vez numa busca com debounce (ListSearch etc.) e espera a URL refletir `q=`. Não repete o
 * preenchimento por timeout: cada digitação dispara um router.replace e o novo cancela o anterior; com o
 * servidor de dev lento (carga), re-digitar a cada poucos segundos impedia qualquer navegação de concluir.
 */
export async function typeSearch(page: Page, box: Locator, text: string) {
  await waitHydrated(box);
  await box.fill(text);
  await expect(page).toHaveURL(/q=/, { timeout: 20_000 });
}

export const dialog = (page: Page) => page.getByRole("dialog");

export const noHScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

/** Regex que casa "R$ 1.234,56" (aceita espaço comum ou NBSP). */
export function brl(cents: number): RegExp {
  const reais = Math.floor(cents / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const c = String(cents % 100).padStart(2, "0");
  return new RegExp(`R\\$\\s*${reais.replace(/\./g, "\\.")},${c}(?!\\d)`);
}

/** Todos os valores "R$ x" de um texto, em centavos. */
export function centsIn(text: string): number[] {
  return [...text.matchAll(/R\$\s*(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})/g)].map(
    (m) => Number(m[1].replace(/\./g, "")) * 100 + Number(m[2]),
  );
}

export async function readCents(loc: Locator): Promise<number> {
  const [c] = centsIn((await loc.innerText()).trim());
  return c;
}

// ---------------------------------------------------------------- cadastros (UI)

export async function createService(page: Page, d: { name: string; car?: string; moto?: string }) {
  await gotoReady(page, "/servicos/novo");
  await page.getByLabel("Nome", { exact: true }).fill(d.name);
  if (d.car !== undefined) await page.getByLabel("Preço Carro (opcional)").fill(d.car);
  if (d.moto !== undefined) await page.getByLabel("Preço Moto (opcional)").fill(d.moto);
  await page.getByRole("button", { name: "Cadastrar serviço" }).click();
  // toast primeiro: dura ~4 s e some se a navegação (dev sob carga) demorar
  await expect(page.getByText("Serviço cadastrado")).toBeVisible();
  await expect(page).toHaveURL(/\/servicos$/);
}

// ---------------------------------------------------------------- atendimento (UI)

export const tile = (page: Page, service: string) =>
  page.getByRole("button", { name: `Adicionar ${service}`, exact: true });

/** Abre o cadastro rápido, preenche cliente + veículo (tipo) e devolve. */
export async function startQuick(
  page: Page,
  d: { name: string; type?: "Carro" | "Moto"; plate?: string },
) {
  await gotoReady(page, "/atendimentos/novo?rapido=1");
  await page.waitForLoadState("networkidle"); // hidratação (dev)
  await page.getByLabel("Nome", { exact: true }).fill(d.name);
  await page.getByRole("radio", { name: d.type ?? "Carro", exact: true }).click();
  if (d.plate) await page.getByLabel("Placa (opcional)").fill(d.plate);
}

export async function pickServices(page: Page, services: string[]) {
  const items = page.getByRole("list", { name: "Serviços do atendimento" }).getByRole("listitem");
  for (const s of services) {
    const added = items.filter({ hasText: s });
    // Só clica se o item ainda não entrou (evita perder o clique antes da hidratação sem duplicar).
    await expect(async () => {
      if (!(await added.count())) await tile(page, s).click();
      await expect(added).toHaveCount(1, { timeout: 1500 });
    }).toPass({ timeout: 15_000 });
  }
}

export async function orderIdFromUrl(page: Page): Promise<number> {
  await expect(page).toHaveURL(/\/atendimentos\/\d+$/);
  return Number(new URL(page.url()).pathname.split("/").pop());
}

/** Cadastro rápido -> cria o atendimento (em andamento) e cai no detalhe. */
export async function createOrderQuick(
  page: Page,
  d: { name: string; type?: "Carro" | "Moto"; services: string[]; plate?: string },
): Promise<number> {
  await startQuick(page, d);
  await pickServices(page, d.services);
  await page.getByRole("button", { name: "Criar atendimento", exact: true }).click();
  const id = await orderIdFromUrl(page);
  await expect(page.getByRole("heading", { level: 1, name: `Atendimento #${id}` })).toBeVisible();
  return id;
}

// ---------------------------------------------------------------- diálogo de pagamento

export const methodBtn = (page: Page, label: string) =>
  dialog(page).getByRole("button", { name: label, exact: true });

export async function confirmPayment(page: Page, label: string) {
  await dialog(page).getByRole("button", { name: label, exact: true }).click();
}

/** Abre "Concluir" no detalhe e devolve o diálogo. */
export async function openComplete(page: Page) {
  await page.getByRole("button", { name: "Concluir", exact: true }).click();
  await expect(dialog(page).getByRole("heading", { name: "Concluir e receber" })).toBeVisible();
}

export async function completeWith(page: Page, method: "Dinheiro" | "Pix" | "Débito" | "Crédito") {
  await openComplete(page);
  await methodBtn(page, method).click();
  await confirmPayment(page, "Concluir e receber");
  await expect(dialog(page)).toBeHidden();
}

export async function completeFiado(page: Page) {
  await openComplete(page);
  await methodBtn(page, "Fiado").click();
  await confirmPayment(page, "Concluir no fiado");
  await expect(dialog(page)).toBeHidden();
}

export const badge = (page: Page) => page.locator("[data-slot=order-status]:visible").first();

// ---------------------------------------------------------------- caixa / lista

/** Linhas visíveis (cartão no celular, tr no desktop) do caixa/lista que contêm o texto. */
export const listRow = (page: Page, text: string): Locator =>
  page.locator("li:visible, tr:visible").filter({ hasText: text }).first();

export async function cashRows(page: Page) {
  const rows = page
    .getByRole("region", { name: "Extrato" })
    .locator("li:visible, tbody tr:visible");
  const n = await rows.count();
  const out: { text: string; cents: number; dir: "IN" | "OUT" }[] = [];
  for (let i = 0; i < n; i++) {
    const text = await rows.nth(i).innerText();
    const cs = centsIn(text);
    // E7: o extrato traz entradas e saídas; `cents` é sempre o valor absoluto, `dir` o sentido.
    const dir = (await rows
      .nth(i)
      .locator("[data-direction]")
      .first()
      .getAttribute("data-direction")) as "IN" | "OUT";
    if (cs.length) out.push({ text, cents: cs[cs.length - 1], dir });
  }
  return out;
}

// ---------------------------------------------------------------- banco de teste (só leitura/setup)

// SQL direto no prisma/test.db (o cliente Prisma gerado é ESM e não carrega no runner CJS do
// Playwright). Uma conexão por chamada: nunca segura o banco aberto enquanto o servidor escreve.
const DB_FILE = path.resolve(__dirname, "..", TEST_DB_URL.replace(/^file:/, ""));

// Com E2E_PG_URL (npm run test:e2e:pg) o mesmo SQL roda no Postgres: identificadores camelCase e nomes de
// tabela são citados ("ServiceOrder", "orderId"), "?" vira $n e INSERT devolve o id (RETURNING).
const PG_URL = process.env.E2E_PG_URL;

function toPgSql(sql: string): string {
  let n = 0;
  return sql
    .replace(
      /\b(ServiceOrderItem|ServiceOrder|StockMovement|CashEntry|CashCategory|Product|Customer|Vehicle|Service|User)\b/g,
      '"$1"',
    )
    .replace(/\b([a-z]+[A-Z][A-Za-z]*)\b/g, '"$1"')
    .replace(/\?/g, () => "$" + ++n);
}

function pgQuery(sql: string, params: unknown[]): Record<string, unknown>[] {
  const out = execFileSync(process.execPath, [path.join(__dirname, "pg-sql.mjs")], {
    input: JSON.stringify({ url: PG_URL, sql: toPgSql(sql), params }),
    encoding: "utf8",
    // TIMESTAMP(3) do Prisma guarda UTC sem fuso; o driver pg o lê como hora local da máquina.
    env: { ...process.env, TZ: "UTC" },
  });
  return JSON.parse(out);
}

export function dbAll(sql: string, ...params: unknown[]): Record<string, unknown>[] {
  if (PG_URL) return pgQuery(sql, params);
  const d = new Database(DB_FILE, { timeout: 10_000 });
  try {
    return d.prepare(sql).all(...params);
  } finally {
    d.close();
  }
}

export function dbRun(sql: string, ...params: unknown[]): number | bigint {
  if (PG_URL) {
    const isInsert = /^\s*insert/i.test(sql);
    const rows = pgQuery(isInsert ? `${sql} returning id` : sql, params);
    return isInsert ? Number(rows[0].id) : 0;
  }
  const d = new Database(DB_FILE, { timeout: 10_000 });
  try {
    return d.prepare(sql).run(...params).lastInsertRowid;
  } finally {
    d.close();
  }
}

/**
 * Vários INSERT/UPDATE do mesmo SQL numa única conexão e transação (um único lock de escrita, curto).
 * Seeds de dezenas de linhas com uma conexão por linha mantêm o arquivo SQLite travado por segundos e
 * o servidor (transação leitura->escrita) toma SQLITE_BUSY/SocketTimeout.
 */
export function dbRunMany(sql: string, rows: unknown[][]): void {
  if (PG_URL) {
    for (const r of rows) dbRun(sql, ...r);
    return;
  }
  const d = new Database(DB_FILE, { timeout: 10_000 });
  try {
    const stmt = d.prepare(sql);
    d.transaction(() => {
      for (const r of rows) stmt.run(...r);
    })();
  } finally {
    d.close();
  }
}

export const dbNum = (sql: string, ...params: unknown[]): number =>
  Number(Object.values(dbAll(sql, ...params)[0] ?? { v: 0 })[0] ?? 0);
