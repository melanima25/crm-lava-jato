// Sem sessão, actions e queries do estoque redirecionam para /login e não tocam no banco.
import { describe, expect, it, vi } from "vitest";

class Redirect extends Error {
  constructor(public url: string) {
    super(`REDIRECT:${url}`);
  }
}

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const touched = vi.fn();
vi.mock("@/server/db", () => ({
  db: new Proxy({}, { get: () => touched() }),
}));

import {
  adjustStockAction,
  deleteStockMovementAction,
  registerStockInAction,
  registerStockOutAction,
  updateStockMovementAction,
} from "./actions";
import { getLowStock, getProductStock, listStock } from "./queries";

describe("estoque exige sessão", () => {
  it("todas as actions e queries redirecionam para /login", async () => {
    const calls = [
      () => registerStockInAction({}),
      () => registerStockOutAction({}),
      () => adjustStockAction({}),
      () => updateStockMovementAction(1, {}),
      () => deleteStockMovementAction(1),
      () => listStock(),
      () => getProductStock(1),
      () => getLowStock(),
    ];
    for (const c of calls) await expect(c()).rejects.toThrow("REDIRECT:/login");
    expect(touched).not.toHaveBeenCalled();
  });
});
