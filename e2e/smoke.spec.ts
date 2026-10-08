import { expect, test } from "@playwright/test";

// O qa refaz os e2e da E1 (login, logout, proteção de rotas). Aqui só o mínimo.
test("sem sessão, a página inicial redireciona para o login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { level: 1, name: "TZ Auto Estética" })).toBeVisible();
});

test("manifest e ícones são públicos (sem sessão)", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest", { maxRedirects: 0 });
  expect(res.status()).toBe(200);
  const manifest = await res.json();
  expect(manifest.name).toBe("TZ Auto Estética");
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
  for (const icon of manifest.icons as { src: string }[]) {
    const r = await request.get(icon.src, { maxRedirects: 0 });
    expect(r.status(), icon.src).toBe(200);
    expect(r.headers()["content-type"]).toContain("image/png");
  }
  for (const path of ["/icon.png", "/apple-icon.png", "/favicon.ico"]) {
    const r = await request.get(path, { maxRedirects: 0 });
    expect(r.status(), path).toBe(200);
  }
});
