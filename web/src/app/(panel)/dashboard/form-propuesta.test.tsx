import {fireEvent, render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {describe, expect, it, vi} from "vitest";

import FormPropuesta from "./form-propuesta";

describe("FormPropuesta: precio único", () => {
  it.each(["0.001", "0.006", "-5", "NaN", "Infinity", "1e3", "10000000000"])(
    "no permite enviar %s",
    (precio) => {
      const onEnviar = vi.fn();

      render(<FormPropuesta dePlataforma={false} onEnviar={onEnviar} />);
      fireEvent.change(screen.getByLabelText("Precio (USD)"), {
        target: {value: precio},
      });

      expect(screen.getByRole("button", {name: "Enviar propuesta"})).toBeDisabled();
      expect(onEnviar).not.toHaveBeenCalled();
    },
  );

  it("envía la coma decimal como centavos exactos", async () => {
    const onEnviar = vi.fn().mockResolvedValue(undefined);

    render(<FormPropuesta dePlataforma={false} onEnviar={onEnviar} />);
    fireEvent.change(screen.getByLabelText("Precio (USD)"), {
      target: {value: "1500,50"},
    });
    await userEvent.click(screen.getByRole("button", {name: "Enviar propuesta"}));

    expect(onEnviar).toHaveBeenCalledWith(1500.5, "", "", null);
  });

  it("acepta un centavo y el máximo representable por NUMERIC(12,2)", () => {
    render(<FormPropuesta dePlataforma={false} onEnviar={vi.fn()} />);
    const precio = screen.getByLabelText("Precio (USD)");
    const enviar = screen.getByRole("button", {name: "Enviar propuesta"});

    fireEvent.change(precio, {target: {value: "0,01"}});
    expect(enviar).toBeEnabled();
    fireEvent.change(precio, {target: {value: "9999999999.99"}});
    expect(enviar).toBeEnabled();
    fireEvent.change(precio, {target: {value: "10000000000"}});
    expect(enviar).toBeDisabled();
  });

  it("mantiene el mínimo de US$ 1 para propuestas por hitos", () => {
    render(<FormPropuesta dePlataforma onEnviar={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Título del hito 1"), {
      target: {value: "Diseño"},
    });
    fireEvent.change(screen.getByLabelText("Monto del hito 1 en USD"), {
      target: {value: "0,99"},
    });
    expect(screen.getByRole("button", {name: "Enviar propuesta"})).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Monto del hito 1 en USD"), {
      target: {value: "1,00"},
    });
    expect(screen.getByRole("button", {name: "Enviar propuesta"})).toBeEnabled();
  });
});
