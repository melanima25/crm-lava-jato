// Sem sessão, as actions de exclusão redirecionam para /login e não tocam no banco (D-33, D-47).
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

import { deleteCustomerAction } from "@/server/customers/actions";
import { deleteOrderAction } from "./actions";

describe("exclusões exigem sessão", () => {
  it("deleteCustomerAction e deleteOrderAction redirecionam para /login", async () => {
    await expect(deleteCustomerAction(1)).rejects.toThrow("REDIRECT:/login");
    await expect(deleteOrderAction(1)).rejects.toThrow("REDIRECT:/login");
    expect(touched).not.toHaveBeenCalled();
  });
});
