import { defineConfig, devices } from "@playwright/test";
import { TEST_AUTH_SECRET, TEST_DB_URL } from "./e2e/constants";

const PORT = 3100; // porta própria: não conflita com `npm run dev` (3000)
const baseURL = `http://localhost:${PORT}`;

// Banco isolado dos testes e2e (recriado por e2e/setup-db.ts a cada execução).

export default defineConfig({
  testDir: "./e2e",
  // Fluxos longos (várias buscas/navegações) levam 15-50 s no servidor de dev sob carga de 3 workers (cada página/RSC
  // renderiza em 2-5 s); 30 s (padrão) estourava só no projeto mobile, que roda por último.
  timeout: 90_000,
  // Esperas por evento (URL/diálogo/toast após server action + navegação RSC) ficavam entre 5 e 10 s no
  // servidor de dev sob carga (ex.: toast "Serviço cadastrado" já visível e a URL ainda em /servicos/novo).
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Um único arquivo SQLite de teste: muitos workers escrevendo juntos geram SocketTimeout no driver.
  workers: 3,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // Pixel 7 (412px) é Chromium; sobrescreve para ~375px de largura.
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], viewport: { width: 375, height: 812 } },
    },
  ],
  webServer: {
    command: "npx tsx e2e/setup-db.ts && npx next dev -p " + PORT,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATABASE_URL: process.env.E2E_PG_URL ?? TEST_DB_URL,
      AUTH_SECRET: TEST_AUTH_SECRET,
    },
  },
});
