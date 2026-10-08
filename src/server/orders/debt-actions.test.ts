// Sem sessão, receiveFromCustomerAction e as queries de fiado redirecionam para /login (D-33).
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

import { receiveFromCustomerAction } from "./actions";
import { getCustomerDebt, listDebtors } from "./queries";

describe("fiado exige sessão", () => {
  it("action e queries redirecionam para /login e não tocam no banco", async () => {
    await expect(receiveFromCustomerAction(1, { amountCents: 100, method: "PIX" })).rejects.toThrow(
      "REDIRECT:/login",
    );
    await expect(listDebtors()).rejects.toThrow("REDIRECT:/login");
    await expect(getCustomerDebt(1)).rejects.toThrow("REDIRECT:/login");
    expect(touched).not.toHaveBeenCalled();
  });
});
