import {render, screen, within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach, describe, expect, it, vi} from "vitest";

const rpc = vi.fn();

vi.mock("@/lib/supabase/client", () => ({createClient: () => ({rpc})}));
process.env.NEXT_PUBLIC_N8N_BASE = "http://n8n.local";

const {default: MisProyectos} = await import("./mis-proyectos");

const TOKEN = "3612ed49-2ec7-47c0-9c85-648a594c8df2";

const proyecto = (extra = {}) => ({
  id: "p1",
  titulo: "App para reservar canchas",
  resumen: "Reservas, seña y recordatorios.",
  servicio: "app_movil",
  urgencia: "alta",
  presupuesto_rango: "mas_5000",
  estado: "ABIERTO",
  postulaciones: 1,
  tope_postulaciones: 15,
  publicado_en: new Date().toISOString(),
  vence_en: new Date(Date.now() + 5 * 86_400_000).toISOString(),
  elegido_nombre: null,
  detalle: [
    {
      id: "po1",
      espacio: "Lucía Estudio",
      mensaje: "Hice apps de turnos.",
      precio: 6000,
      plazo: "8 semanas",
      slug: "lucia-estudio",
      promedio: 4.5,
      calificaciones: 3,
    },
  ],
  eleccion_token: TOKEN,
  ...extra,
});

describe("MisProyectos", () => {
  beforeEach(() => {
    rpc.mockReset();
    vi.unstubAllGlobals();
  });

  it("muestra el proyecto con sus postulaciones y elige por el webhook con el token", async () => {
    let elegido = false;

    rpc.mockImplementation(async () => ({
      data: [
        elegido ? proyecto({estado: "ASIGNADO", elegido_nombre: "Lucía Estudio"}) : proyecto(),
      ],
      error: null,
    }));

    const fetchMock = vi.fn(async () => {
      elegido = true;

      return new Response(JSON.stringify({status: "ok", espacio_nombre: "Lucía Estudio"}));
    });

    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();

    render(<MisProyectos />);

    const tarjeta = (
      await screen.findByRole("heading", {name: "App para reservar canchas"})
    ).closest("li")!;

    expect(within(tarjeta).getByText("1/15 postulaciones", {exact: false})).toBeInTheDocument();
    await user.click(within(tarjeta).getByRole("button", {name: "Elegir a Lucía Estudio"}));
    await user.click(within(tarjeta).getByRole("button", {name: "Sí, elegir"}));

    expect(fetchMock).toHaveBeenCalledWith(
      "http://n8n.local/webhook/bolsa-elegir",
      expect.objectContaining({
        body: JSON.stringify({t: TOKEN, postulacion_id: "po1"}),
      }),
    );
    // Recarga: el proyecto queda asignado y ya no ofrece elegir.
    expect(await screen.findByText("Quedó con Lucía Estudio")).toBeInTheDocument();
    expect(screen.queryByRole("button", {name: /Elegir a/})).not.toBeInTheDocument();
  });

  it("sin postulaciones, avisa que le va a llegar un correo", async () => {
    rpc.mockResolvedValue({
      data: [proyecto({postulaciones: 0, detalle: []})],
      error: null,
    });

    render(<MisProyectos />);

    expect(await screen.findByText(/Todavía no se postuló nadie/)).toBeInTheDocument();
  });

  it("sin proyectos, invita a publicar", async () => {
    rpc.mockResolvedValue({data: [], error: null});

    render(<MisProyectos />);

    expect(await screen.findByText(/Todavía no publicaste ningún proyecto/)).toBeInTheDocument();
  });
});
