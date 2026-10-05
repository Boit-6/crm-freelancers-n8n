import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {describe, expect, it, vi} from "vitest";

import RechazoPedido from "./rechazo-pedido";

const DESCRIPCION = "Tienda online para una pyme de indumentaria, con stock y pagos.";

describe("RechazoPedido", () => {
  it("con consentimiento, propone la bolsa con la descripción como resumen", async () => {
    const onRechazar = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(<RechazoPedido compartirBolsa descripcion={DESCRIPCION} onRechazar={onRechazar} />);
    await user.click(screen.getByRole("button", {name: "No puedo tomarlo"}));

    expect(screen.getByRole("radio", {name: /Mandarlo a la bolsa/})).toBeChecked();

    const resumen = screen.getByRole("textbox", {
      name: /Resumen para la bolsa/,
    });

    expect(resumen).toHaveValue(DESCRIPCION);

    // El desarrollador le saca un dato personal antes de publicar.
    await user.clear(resumen);
    await user.type(resumen, "Tienda online con stock y pagos para una pyme.");
    await user.click(screen.getByRole("button", {name: "Mandar a la bolsa"}));

    expect(onRechazar).toHaveBeenCalledWith(
      "bolsa",
      "Tienda online con stock y pagos para una pyme.",
    );
  });

  it("sin consentimiento, la bolsa queda deshabilitada y sólo se puede descartar", async () => {
    const onRechazar = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <RechazoPedido compartirBolsa={false} descripcion={DESCRIPCION} onRechazar={onRechazar} />,
    );
    await user.click(screen.getByRole("button", {name: "No puedo tomarlo"}));

    expect(screen.getByRole("radio", {name: /Mandarlo a la bolsa/})).toBeDisabled();
    expect(screen.getByRole("radio", {name: /Descartarlo/})).toBeChecked();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", {name: "Descartar"}));

    expect(onRechazar).toHaveBeenCalledWith("descartar", DESCRIPCION);
  });

  it("no deja mandar a la bolsa un resumen de menos de 20 caracteres", async () => {
    const user = userEvent.setup();

    render(<RechazoPedido compartirBolsa descripcion="Corto" onRechazar={vi.fn()} />);
    await user.click(screen.getByRole("button", {name: "No puedo tomarlo"}));

    expect(screen.getByRole("button", {name: "Mandar a la bolsa"})).toBeDisabled();
  });

  it("si falla, muestra el error y deja reintentar", async () => {
    const onRechazar = vi.fn().mockRejectedValue(new Error("El pedido ya avanzó."));
    const user = userEvent.setup();

    render(<RechazoPedido compartirBolsa descripcion={DESCRIPCION} onRechazar={onRechazar} />);
    await user.click(screen.getByRole("button", {name: "No puedo tomarlo"}));
    await user.click(screen.getByRole("button", {name: "Mandar a la bolsa"}));

    expect(await screen.findByRole("alert")).toHaveTextContent("El pedido ya avanzó.");
    expect(screen.getByRole("button", {name: "Mandar a la bolsa"})).toBeEnabled();
  });
});
