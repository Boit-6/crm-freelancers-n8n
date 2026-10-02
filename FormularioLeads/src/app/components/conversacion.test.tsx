import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeAll, beforeEach, describe, expect, it, vi} from "vitest";

const rpc = vi.fn();
const canal = {on: vi.fn(), subscribe: vi.fn()};

canal.on.mockReturnValue(canal);
canal.subscribe.mockReturnValue(canal);

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({rpc, channel: () => canal, removeChannel: vi.fn()}),
}));

const {default: Conversacion} = await import("./conversacion");

const POSTULACION = "4029fcc2-2550-4cf1-9dfd-b9cd2b0b6658";
const TOKEN = "09ff9bde-1075-493d-9095-41394e187c10";

const mensaje = (id: string, autor: "cliente" | "desarrollador", texto: string) => ({
  id,
  autor,
  texto,
  creado_en: "2026-09-24T15:00:00Z",
  leido_en: null,
});

describe("Conversacion", () => {
  beforeAll(() => {
    // jsdom no implementa showModal/close de <dialog>.
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function () {
      this.open = false;
    };
  });

  beforeEach(() => rpc.mockReset());

  it("muestra los mensajes y envía con el token del enlace", async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === "abrir_conversacion"
        ? {
            data: {
              rol: "cliente",
              abierta: true,
              ocultar: true,
              mensajes: [mensaje("m1", "desarrollador", "¿Necesitás facturación electrónica?")],
            },
            error: null,
          }
        : {data: mensaje("m2", "cliente", "Sí, la necesito."), error: null},
    );

    const user = userEvent.setup();

    render(
      <Conversacion
        con="Lucía Estudio"
        postulacionId={POSTULACION}
        token={TOKEN}
        onCerrar={vi.fn()}
      />,
    );

    expect(await screen.findByText("¿Necesitás facturación electrónica?")).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("abrir_conversacion", {
      p_postulacion: POSTULACION,
      p_token: TOKEN,
    });
    // Antes de elegir, avisa que los datos de contacto se ocultan.
    expect(screen.getByText(/se ocultan/)).toBeInTheDocument();

    await user.type(screen.getByLabelText("Mensaje"), "Sí, la necesito.");
    await user.click(screen.getByRole("button", {name: "Enviar"}));

    expect(rpc).toHaveBeenCalledWith("enviar_mensaje", {
      p_postulacion: POSTULACION,
      p_texto: "Sí, la necesito.",
      p_token: TOKEN,
    });
    expect(await screen.findByText("Sí, la necesito.", {selector: "li"})).toBeInTheDocument();
  });

  it("con sesión se suscribe al tiempo real de esa conversación", async () => {
    rpc.mockResolvedValue({
      data: {
        rol: "desarrollador",
        abierta: true,
        ocultar: false,
        mensajes: [],
      },
      error: null,
    });

    render(<Conversacion con="Cliente" postulacionId={POSTULACION} onCerrar={vi.fn()} />);

    expect(await screen.findByText(/Todavía no hay mensajes/)).toBeInTheDocument();
    expect(canal.on).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({
        table: "mensajes",
        filter: `postulacion_id=eq.${POSTULACION}`,
      }),
      expect.any(Function),
    );
    // Ya se eligió a este postulante: no hay aviso de datos ocultos.
    expect(screen.queryByText(/se ocultan/)).not.toBeInTheDocument();
  });

  it("una conversación cerrada no deja escribir", async () => {
    rpc.mockResolvedValue({
      data: {
        rol: "desarrollador",
        abierta: false,
        ocultar: true,
        mensajes: [],
      },
      error: null,
    });

    render(<Conversacion con="Cliente" postulacionId={POSTULACION} onCerrar={vi.fn()} />);

    expect(await screen.findByText(/La conversación está cerrada/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Mensaje")).not.toBeInTheDocument();
  });

  it("si la base rechaza el acceso, lo dice", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {message: "No tenés acceso a esta conversación"},
    });

    render(<Conversacion con="X" postulacionId={POSTULACION} token="otro" onCerrar={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("No tenés acceso");
  });
});
