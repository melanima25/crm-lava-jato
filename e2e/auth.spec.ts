import { expect, test, type Page } from "@playwright/test";
import { TEST_USER } from "./constants";

const INVALID = "E-mail ou senha inválidos";
const LOCKED = "Muitas tentativas. Tente novamente em alguns minutos.";

// O rate limit é global do processo (em memória): cada teste de erro usa e-mail próprio,
// único por teste e por projeto (desktop/mobile), para nunca bloquear o usuário seed.
let seq = 0;
function uniqueEmail(projectName: string, tag: string) {
  return `${tag}-${projectName}-${Date.now()}-${seq++}@e2e.test`;
}

async function fillAndSubmit(page: Page, email: string, password: string) {
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  const done = page.waitForResponse((r) => r.request().method() === "POST");
  await page.getByRole("button", { name: "Entrar" }).click();
  await done;
}

async function login(page: Page) {
  await page.goto("/login");
  await fillAndSubmit(page, TEST_USER.email, TEST_USER.password);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1, name: "Bem-vindo" })).toBeVisible();
}

test.describe("login", () => {
  test("credenciais válidas levam à página inicial", async ({ page }) => {
    await login(page);
    const nav = page.getByRole("navigation", { name: "Navegação principal" });
    await expect(nav.getByRole("link", { name: "Início" })).toHaveAttribute("aria-current", "page");
  });

  test("senha errada mostra mensagem genérica", async ({ page }) => {
    await page.goto("/login");
    await fillAndSubmit(page, TEST_USER.email, "senha-errada-xyz");
    await expect(page.locator("[data-slot=field-error]")).toHaveText(INVALID);
    await expect(page).toHaveURL(/\/login$/);
  });

  test("e-mail inexistente mostra a mesma mensagem", async ({ page }, testInfo) => {
    await page.goto("/login");
    await fillAndSubmit(page, uniqueEmail(testInfo.project.name, "naoexiste"), "qualquer-coisa");
    await expect(page.locator("[data-slot=field-error]")).toHaveText(INVALID);
  });

  test("e-mail é case-insensitive e ignora espaços", async ({ page }) => {
    await page.goto("/login");
    await fillAndSubmit(page, TEST_USER.email.toUpperCase(), TEST_USER.password);
    await expect(page).toHaveURL(/\/$/);
  });

  test("bloqueio após 5 erros seguidos no mesmo e-mail", async ({ page }, testInfo) => {
    const email = uniqueEmail(testInfo.project.name, "bloqueio");
    await page.goto("/login");
    for (let i = 0; i < 5; i++) {
      await fillAndSubmit(page, email, `errada-${i}`);
      // React 19 reseta o formulário após a action: espera o reset antes de preencher de novo.
      await expect(page.getByLabel("Senha")).toHaveValue("");
      await expect(page.locator("[data-slot=field-error]")).toHaveText(INVALID);
    }
    await fillAndSubmit(page, email, "errada-6");
    await expect(page.locator("[data-slot=field-error]")).toHaveText(LOCKED);
  });
});

test.describe("proteção de rotas", () => {
  for (const route of ["/", "/clientes", "/caixa", "/qualquer/coisa", "/atendimentos/1"]) {
    test(`sem sessão, ${route} redireciona para /login`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole("heading", { level: 1, name: "TZ Auto Estética" })).toBeVisible();
    });
  }

  test("com sessão, /login redireciona para /", async ({ page }) => {
    await login(page);
    await page.goto("/login");
    await expect(page).toHaveURL(/\/$/);
  });

  test("cookie adulterado é tratado como sem sessão", async ({ page, context, baseURL }) => {
    await login(page);
    const [session] = (await context.cookies()).filter((c) => c.name === "session");
    const tampered =
      session.value.slice(0, -4) + (session.value.endsWith("AAAA") ? "BBBB" : "AAAA");
    await context.clearCookies();
    await context.addCookies([{ name: "session", value: tampered, url: baseURL! }]);
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);

    await context.clearCookies();
    await context.addCookies([{ name: "session", value: "lixo", url: baseURL! }]);
    await page.goto("/clientes");
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("sessão", () => {
  test("cookie é httpOnly, sameSite=lax e persistente (~30 dias)", async ({ page, context }) => {
    await login(page);
    const cookie = (await context.cookies()).find((c) => c.name === "session");
    expect(cookie).toBeDefined();
    expect(cookie!.httpOnly).toBe(true);
    expect(cookie!.sameSite).toBe("Lax");
    expect(cookie!.secure).toBe(false); // secure só em produção (http em dev/e2e)
    const days = (cookie!.expires - Date.now() / 1000) / 86400;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    // Não acessível via JS
    expect(await page.evaluate(() => document.cookie)).not.toContain("session=");
  });

  test("sessão persiste ao fechar e reabrir o navegador", async ({ browser, page }, testInfo) => {
    await login(page);
    const state = await page.context().storageState();
    await page.context().close();

    const context2 = await browser.newContext({
      ...testInfo.project.use,
      storageState: state,
    });
    const page2 = await context2.newPage();
    await page2.goto("/");
    await expect(page2).toHaveURL(/\/$/);
    await expect(page2.getByRole("heading", { level: 1, name: "Bem-vindo" })).toBeVisible();
    await context2.close();
  });

  test("Sair encerra a sessão e volta a proteger as rotas", async ({ page, context }) => {
    await login(page);
    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await context.cookies()).find((c) => c.name === "session")).toBeUndefined();
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/clientes");
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("layout responsivo", () => {
  test("sem scroll horizontal no /login e na home; barra inferior não cobre conteúdo", async ({
    page,
  }, testInfo) => {
    const noHScroll = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      );
    await page.goto("/login");
    expect(await noHScroll()).toBe(true);

    await login(page);
    expect(await noHScroll()).toBe(true);

    if (testInfo.project.name === "mobile") {
      expect(page.viewportSize()!.width).toBe(375);
      const nav = page.getByRole("navigation", { name: "Navegação principal" });
      const navBox = (await nav.boundingBox())!;
      // Rola ao fim: o último conteúdo da página deve ficar acima da barra inferior.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      const lastBox = (await page.getByTestId("home-estoque").boundingBox())!;
      expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(navBox.y);
    }
  });
});

test.describe("console", () => {
  test("sem console.error/pageerror no login e na home", async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") problems.push(`${m.type()}: ${m.text()}`);
    });
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    await page.goto("/login");
    await fillAndSubmit(page, TEST_USER.email, TEST_USER.password);
    await expect(page.getByRole("heading", { level: 1, name: "Bem-vindo" })).toBeVisible();
    await page.waitForTimeout(1500);
    expect(problems).toEqual([]);
  });
});
