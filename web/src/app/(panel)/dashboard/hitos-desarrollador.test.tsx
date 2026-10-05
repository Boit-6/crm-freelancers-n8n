import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach, describe, expect, it, vi} from "vitest";

const rpc = vi.fn();

vi.mock("@/lib/supabase/client", () => ({createClient: () => ({rpc})}));

const {default: HitosDesarrollador} = await import("./hitos-desarrollador");

const hito = (extra = {}) => ({
  id: "h1",
  orden: 1,
  titulo: "Diseño",
  descripcion: null,
  monto: 300,
  estado: "PENDIENTE",
  comision_porcentaje: 5,
  fondeado_en: null,
  entrega_nota: null,
  entregado_en: null,
  libera_en: null,
  disputa_motivo: null,
  monto_liberado: 0,
  monto_reembolsado: 0,
  comision: 0,
  resolucion_nota: null,
  cerrado_en: null,
  transferido_en: null,
  reembolsado_en: null,
  puede_pagar: false,
  eventos: [],
  ...extra,
});

const proyecto = (hitos: ReturnType<typeof hito>[], estado = "ACEPTADO") =>
  ({
    rol: "desarrollador",
    lead_id: "LD-1",
    estado,
    cobro_modo: "hitos",
    servicio: "ecommerce",
    cliente_nombre: "Marta",
    espacio_nombre: "Pablo Dev",
    alcance: null,
    plazo: null,
    de_plataforma: true,
    hitos,
  }) as never;

describe("HitosDesarrollador", () => {
  beforeEach(() => rpc.mockReset().mockResolvedValue({data: null, error: null}));

  it("un hito pagado se marca entregado con una nota y recarga", async () => {
    const onCambio = vi.fn();
    const user = userEvent.setup();

    render(
      <HitosDesarrollador proyecto={proyecto([hito({estado: "FONDEADO"})])} onCambio={onCambio} />,
    );
    expect(screen.getByText(/Ya podés empezar/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", {name: "Marcar entregado"}));
    const avisar = screen.getByRole("button", {name: "Avisar al cliente"});

    expect(avisar).toBeDisabled();
    await user.type(screen.getByLabelText("Qué entregaste en el hito 1"), "Figma en el enlace");
    await user.click(avisar);

    expect(rpc).toHaveBeenCalledWith("entregar_hito", {
      p_hito: "h1",
      p_nota: "Figma en el enlace",
    });
    expect(onCambio).toHaveBeenCalled();
  });

  it("devolver la plata pide confirmación", async () => {
    const user = userEvent.setup();

    render(
      <HitosDesarrollador
        proyecto={proyecto([hito({estado: "EN_DISPUTA", disputa_motivo: "No anda el carrito"})])}
        onCambio={() => {}}
      />,
    );
    expect(screen.getByText(/No anda el carrito/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", {name: "Devolver la plata"}));
    await user.click(screen.getByRole("button", {name: "Sí, devolver"}));

    expect(rpc).toHaveBeenCalledWith("devolver_hito", {
      p_hito: "h1",
      p_nota: "",
    });
  });

  it("antes de que el cliente acepte no hay acciones; un liberado muestra lo que le llega", () => {
    render(
      <HitosDesarrollador
        proyecto={proyecto(
          [
            hito(),
            hito({
              id: "h2",
              orden: 2,
              estado: "LIBERADO",
              monto_liberado: 300,
              comision: 15,
            }),
          ],
          "PROPUESTA_ENVIADA",
        )}
        onCambio={() => {}}
      />,
    );

    expect(screen.queryByRole("button", {name: "Anular hito"})).not.toBeInTheDocument();
    expect(screen.getByText(/US\$\s?285 para vos/)).toBeInTheDocument();
  });

  it("muestra el error de la base", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {message: "Sólo se entrega un hito pagado y sin entregar"},
    });
    const user = userEvent.setup();

    render(
      <HitosDesarrollador proyecto={proyecto([hito({estado: "FONDEADO"})])} onCambio={() => {}} />,
    );
    await user.click(screen.getByRole("button", {name: "Marcar entregado"}));
    await user.type(screen.getByLabelText("Qué entregaste en el hito 1"), "algo entregado");
    await user.click(screen.getByRole("button", {name: "Avisar al cliente"}));

    expect(await screen.findByRole("alert")).toHaveTextContent("Sólo se entrega un hito pagado");
  });
});
