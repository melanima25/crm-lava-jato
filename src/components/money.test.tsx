// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Money } from "./money";

afterEach(cleanup);

describe("Money", () => {
  it("formata centavos em BRL", () => {
    render(<Money cents={123456} />);
    expect(screen.getByText("R$ 1.234,56")).toBeTruthy();
  });

  it("exibe 1 centavo", () => {
    render(<Money cents={1} />);
    expect(screen.getByText("R$ 0,01")).toBeTruthy();
  });

  it("destaca negativo só quando pedido", () => {
    const { rerender } = render(<Money cents={-500} />);
    expect(screen.getByText("-R$ 5,00").className).not.toContain("text-destructive");
    rerender(<Money cents={-500} highlightNegative />);
    expect(screen.getByText("-R$ 5,00").className).toContain("text-destructive");
    rerender(<Money cents={500} highlightNegative />);
    expect(screen.getByText("R$ 5,00").className).not.toContain("text-destructive");
  });
});
