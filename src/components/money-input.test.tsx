// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { MoneyInput } from "./money-input";

afterEach(cleanup);

function Harness({ initial = null }: { initial?: number | null }) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <>
      <MoneyInput aria-label="valor" value={value} onChange={setValue} />
      <output data-testid="cents">{value === null ? "null" : String(value)}</output>
      <button onClick={() => setValue(999)}>set</button>
    </>
  );
}

const cents = () => screen.getByTestId("cents").textContent;

describe("MoneyInput", () => {
  it("usa teclado decimal", () => {
    render(<Harness />);
    expect(screen.getByLabelText("valor").getAttribute("inputmode")).toBe("decimal");
  });

  it.each([
    ["1.234,56", "123456"],
    ["10", "1000"],
    ["0,01", "1"],
    ["10,5", "1050"],
  ])("converte %s em centavos", async (typed, expected) => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText("valor"), typed);
    expect(cents()).toBe(expected);
  });

  it("entrega null quando vazio", async () => {
    const user = userEvent.setup();
    render(<Harness initial={500} />);
    await user.clear(screen.getByLabelText("valor"));
    expect(cents()).toBe("null");
  });

  it("mostra o valor inicial formatado e reformata ao sair do campo", async () => {
    const user = userEvent.setup();
    render(<Harness initial={123456} />);
    const input = screen.getByLabelText<HTMLInputElement>("valor");
    expect(input.value).toBe("1.234,56");
    await user.clear(input);
    await user.type(input, "10");
    await user.tab();
    expect(input.value).toBe("10,00");
  });

  it("mostra erro para valor inválido após sair do campo", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText("valor");
    await user.type(input, "abc");
    await user.tab();
    expect(screen.getByRole("alert").textContent).toBe("Valor inválido.");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(cents()).toBe("NaN"); // inválido não vira vazio
  });

  it("rejeita negativo", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText("valor"), "-5");
    await user.tab();
    expect(screen.getByRole("alert").textContent).toBe("O valor não pode ser negativo.");
  });

  it("emite NaN (e não null) para texto inválido e negativo", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText("valor");
    await user.type(input, "-5");
    expect(cents()).toBe("NaN");
    await user.clear(input);
    expect(cents()).toBe("null");
    await user.type(input, "12,3x");
    expect(cents()).toBe("NaN");
  });

  it("mostra a mensagem específica assim que há erro externo genérico", () => {
    render(<MoneyInput aria-label="valor" value={Number.NaN} error="Preço inválido" />);
    // Texto vazio + NaN vindo de fora: sem texto inválido, vale a mensagem externa.
    expect(screen.getByRole("alert").textContent).toBe("Preço inválido");
  });

  it("erro genérico externo não mascara a mensagem específica do texto", async () => {
    const user = userEvent.setup();
    function WithError() {
      const [v, setV] = useState<number | null>(null);
      return <MoneyInput aria-label="valor" value={v} onChange={setV} error="Preço inválido" />;
    }
    render(<WithError />);
    await user.type(screen.getByLabelText("valor"), "-5");
    expect(screen.getByRole("alert").textContent).toBe("O valor não pode ser negativo.");
  });

  it("sincroniza quando o valor muda por fora", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("set"));
    expect(screen.getByLabelText<HTMLInputElement>("valor").value).toBe("9,99");
  });

  it("prioriza a mensagem de erro externa", () => {
    render(<MoneyInput aria-label="valor" value={null} error="Obrigatório" />);
    expect(screen.getByRole("alert").textContent).toBe("Obrigatório");
  });
});
