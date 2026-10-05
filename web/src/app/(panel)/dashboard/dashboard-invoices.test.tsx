import type {FacturaPendiente} from "./dashboard-types";

import {render, screen, within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {describe, expect, it, vi} from "vitest";

import DashboardInvoices from "./dashboard-invoices";

const base: Omit<FacturaPendiente, "estado" | "factura_id" | "dias_al_vencimiento"> = {
  cliente: "Cliente",
  servicio: "desarrollo_web",
  monto: 1000,
  moneda: "ARS",
  fecha_vencimiento: "2026-09-01T00:00:00Z",
};

describe("DashboardInvoices", () => {
  it("muestra las vencidas junto a las pendientes, marcadas", () => {
    render(
      <DashboardInvoices
        facturas={[
          {
            ...base,
            estado: "VENCIDA",
            factura_id: "FAC-VENC",
            dias_al_vencimiento: -12,
          },
          {
            ...base,
            estado: "PENDIENTE",
            factura_id: "FAC-PEND",
            dias_al_vencimiento: 5,
          },
        ]}
        onAnular={vi.fn()}
      />,
    );

    const filaVencida = screen.getByText("FAC-VENC").closest("tr")!;
    const filaPendiente = screen.getByText("FAC-PEND").closest("tr")!;

    expect(within(filaVencida).getByText("Vencida")).toBeInTheDocument();
    expect(within(filaVencida).getByText("12 vencida")).toBeInTheDocument();
    expect(within(filaPendiente).queryByText("Vencida")).not.toBeInTheDocument();
    // La tarjeta del celular dice lo mismo en palabras.
    expect(screen.getByText(/vencida hace 12 días/)).toBeInTheDocument();
    expect(screen.getByText(/vence en 5 días/)).toBeInTheDocument();
  });

  it("deja anular una factura vencida", async () => {
    const onAnular = vi.fn();
    const user = userEvent.setup();

    render(
      <DashboardInvoices
        facturas={[
          {
            ...base,
            estado: "VENCIDA",
            factura_id: "FAC-VENC",
            dias_al_vencimiento: -12,
          },
        ]}
        onAnular={onAnular}
      />,
    );

    // Hay dos: el de la tarjeta (celular) y el de la tabla (PC). jsdom no
    // aplica el CSS que esconde uno u otro, así que se prueban los dos.
    const botones = screen.getAllByRole("button", {name: "Anular"});

    expect(botones).toHaveLength(2);
    for (const boton of botones) await user.click(boton);

    expect(onAnular).toHaveBeenCalledTimes(2);
    expect(onAnular).toHaveBeenCalledWith("FAC-VENC");
  });

  it("sin facturas, lo dice", () => {
    render(<DashboardInvoices facturas={[]} onAnular={vi.fn()} />);

    expect(screen.getByText("No hay facturas por cobrar.")).toBeInTheDocument();
  });
});
