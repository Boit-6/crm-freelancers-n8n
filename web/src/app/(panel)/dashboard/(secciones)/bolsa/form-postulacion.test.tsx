import {fireEvent, render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {describe, expect, it, vi} from "vitest";

import FormPostulacion from "./form-postulacion";

function completar(precio: string, onEnviar = vi.fn()) {
  render(<FormPostulacion onCancelar={vi.fn()} onEnviar={onEnviar} />);
  fireEvent.change(screen.getByLabelText("Mensaje para el cliente"), {
    target: {value: "Puedo hacerlo esta semana."},
  });
  fireEvent.change(screen.getByLabelText("Precio estimado (USD)"), {
    target: {value: precio},
  });
  fireEvent.change(screen.getByLabelText("Plazo"), {
    target: {value: "1 semana"},
  });
}

describe("FormPostulacion: precio estimado", () => {
  it.each(["0.001", "0.006", "-5", "NaN", "Infinity", "1e3", "10000000000"])(
    "no permite enviar %s",
    (precio) => {
      completar(precio);
      expect(screen.getByRole("button", {name: "Enviar postulación"})).toBeDisabled();
    },
  );

  it("envía la coma decimal como centavos exactos", async () => {
    const onEnviar = vi.fn().mockResolvedValue(undefined);

    completar("1500,50", onEnviar);
    await userEvent.click(screen.getByRole("button", {name: "Enviar postulación"}));

    expect(onEnviar).toHaveBeenCalledWith("Puedo hacerlo esta semana.", 1500.5, "1 semana");
  });

  it("acepta un centavo y el máximo representable por NUMERIC(12,2)", () => {
    completar("0,01");
    const precio = screen.getByLabelText("Precio estimado (USD)");
    const enviar = screen.getByRole("button", {name: "Enviar postulación"});

    expect(enviar).toBeEnabled();
    fireEvent.change(precio, {target: {value: "9999999999.99"}});
    expect(enviar).toBeEnabled();
    fireEvent.change(precio, {target: {value: "10000000000"}});
    expect(enviar).toBeDisabled();
  });
});
