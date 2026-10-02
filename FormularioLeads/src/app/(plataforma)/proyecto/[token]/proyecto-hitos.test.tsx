import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach, describe, expect, it, vi} from "vitest";

const rpc = vi.fn();

vi.mock("@/lib/supabase/client", () => ({createClient: () => ({rpc})}));
process.env.NEXT_PUBLIC_N8N_BASE = "http://n8n.local";

const {default: ProyectoHitos} = await import("./proyecto-hitos");

const TOKEN = "76b8f230-df5c-41b1-b295-e04e5ed34786";

const hito = (extra = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  orden: 1,
  titulo: "Diseño de la tienda",
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

const proyecto = (hitos: ReturnType<typeof hito>[]) => ({
  rol: "cliente",
  lead_id: "LD-1",
  estado: "ACEPTADO",
  cobro_modo: "hitos",
  servicio: "ecommerce",
  cliente_nombre: "Marta",
  espacio_nombre: "Pablo Dev",
  alcance: "Tienda online con pagos.",
  plazo: "4 semanas",
  de_plataforma: true,
  hitos,
});

describe("ProyectoHitos", () => {
  beforeEach(() => rpc.mockReset());

  it("con un token que no es un UUID no consulta nada", async () => {
    render(<ProyectoHitos recienPagado={false} token="cualquiera" />);

    expect(await screen.findByText("Enlace no válido")).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("muestra los hitos y el botón de pago sólo en el que toca, hacia n8n con el token", async () => {
    rpc.mockResolvedValue({
      data: proyecto([
        hito({puede_pagar: true}),
        hito({
          id: "22222222-2222-4222-8222-222222222222",
          orden: 2,
          titulo: "Desarrollo",
          monto: 500.5,
        }),
      ]),
      error: null,
    });

    render(<ProyectoHitos recienPagado={false} token={TOKEN} />);

    expect(await screen.findByText("Hola, Marta.")).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("ver_proyecto", {
      p_lead: null,
      p_token: TOKEN,
    });
    const pagar = screen.getAllByRole("link", {name: /^Pagar/});

    expect(pagar).toHaveLength(1);
    expect(pagar[0]).toHaveAttribute(
      "href",
      `http://n8n.local/webhook/hito-pagar?h=11111111-1111-4111-8111-111111111111&t=${TOKEN}`,
    );
    expect(screen.getAllByText("Sin pagar")).toHaveLength(2);
  });

  it("un hito pagado muestra la plata retenida y su línea de tiempo", async () => {
    rpc.mockResolvedValue({
      data: proyecto([
        hito({
          estado: "FONDEADO",
          fondeado_en: "2026-09-28T15:00:00Z",
          eventos: [
            {
              tipo: "fondeado",
              actor: "cliente",
              detalle: null,
              creado_en: "2026-09-28T15:00:00Z",
            },
          ],
        }),
      ]),
      error: null,
    });

    render(<ProyectoHitos recienPagado={false} token={TOKEN} />);

    expect(await screen.findByText("Pagado, en curso")).toBeInTheDocument();
    expect(screen.getByText(/Pagado: la plata queda retenida/)).toBeInTheDocument();
    expect(screen.queryByRole("link", {name: /^Pagar/})).not.toBeInTheDocument();
  });

  it("si la base rechaza el token, avisa que el enlace no es válido", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {message: "No tenés acceso a este proyecto"},
    });

    render(<ProyectoHitos recienPagado={false} token={TOKEN} />);

    expect(await screen.findByText("Enlace no válido")).toBeInTheDocument();
  });

  it("al volver de pagar, confirma el pago cuando el hito aparece fondeado", async () => {
    rpc.mockResolvedValue({
      data: proyecto([hito({estado: "FONDEADO", fondeado_en: new Date().toISOString()})]),
      error: null,
    });

    render(<ProyectoHitos recienPagado token={TOKEN} />);

    expect(await screen.findByText(/El pago quedó registrado/)).toBeInTheDocument();
  });

  it("la clienta aprueba un hito entregado con el token, confirmando antes", async () => {
    const entregado = hito({
      estado: "ENTREGADO",
      fondeado_en: "2026-09-20T00:00:00Z",
      libera_en: "2026-10-05T12:00:00Z",
      entrega_nota: "Figma listo",
    });

    rpc.mockImplementation((fn: string) =>
      Promise.resolve(
        fn === "ver_proyecto"
          ? {data: proyecto([entregado]), error: null}
          : {data: null, error: null},
      ),
    );
    const user = userEvent.setup();

    render(<ProyectoHitos recienPagado={false} token={TOKEN} />);

    expect(await screen.findByText(/se libera solo el/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", {name: /Aprobar y liberar/}));
    expect(rpc).not.toHaveBeenCalledWith("aprobar_hito", expect.anything());
    await user.click(screen.getByRole("button", {name: "Sí, liberar"}));

    expect(rpc).toHaveBeenCalledWith("aprobar_hito", {
      p_hito: entregado.id,
      p_token: TOKEN,
    });
    // Después de aprobar, vuelve a pedir el proyecto.
    expect(rpc.mock.calls.filter(([fn]) => fn === "ver_proyecto").length).toBeGreaterThanOrEqual(2);
  });

  it("una disputa pide un motivo de al menos 10 caracteres", async () => {
    rpc.mockImplementation((fn: string) =>
      Promise.resolve(
        fn === "ver_proyecto"
          ? {
              data: proyecto([
                hito({
                  estado: "FONDEADO",
                  fondeado_en: "2026-09-20T00:00:00Z",
                }),
              ]),
              error: null,
            }
          : {data: null, error: null},
      ),
    );
    const user = userEvent.setup();

    render(<ProyectoHitos recienPagado={false} token={TOKEN} />);
    await user.click(await screen.findByRole("button", {name: "Algo no está bien"}));
    const abrir = screen.getByRole("button", {name: "Abrir disputa"});

    await user.type(screen.getByLabelText("Qué pasó con este hito"), "mal");
    expect(abrir).toBeDisabled();
    await user.type(screen.getByLabelText("Qué pasó con este hito"), " hecho el carrito");
    await user.click(abrir);

    expect(rpc).toHaveBeenCalledWith("disputar_hito", {
      p_hito: "11111111-1111-4111-8111-111111111111",
      p_motivo: "mal hecho el carrito",
      p_token: TOKEN,
    });
  });
});
