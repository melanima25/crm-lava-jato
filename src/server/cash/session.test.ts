// Sem sessão, actions e queries do caixa redirecionam para /login e não tocam no banco.
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
  createCashCategoryAction,
  createCashEntryAction,
  deleteCashCategoryAction,
  deleteCashEntryAction,
  setCashCategoryActiveAction,
  updateCashCategoryAction,
  updateCashEntryAction,
} from "./actions";
import { getCashEntry, getCashSummary, listCashCategories, listCashEntries } from "./queries";

describe("caixa exige sessão", () => {
  it("todas as actions e queries redirecionam para /login", async () => {
    const calls = [
      () => createCashEntryAction({}),
      () => updateCashEntryAction(1, {}),
      () => deleteCashEntryAction(1),
      () => createCashCategoryAction({}),
      () => updateCashCategoryAction(1, {}),
      () => setCashCategoryActiveAction(1, false),
      () => deleteCashCategoryAction(1),
      () => getCashSummary(),
      () => listCashEntries(),
      () => getCashEntry(1),
      () => listCashCategories(),
    ];
    for (const c of calls) await expect(c()).rejects.toThrow("REDIRECT:/login");
    expect(touched).not.toHaveBeenCalled();
  });
});
