import type {Ticket} from "@/lib/tickets";

import {render, screen, waitFor, within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeAll, beforeEach, describe, expect, it, vi} from "vitest";

import TicketsBoard from "./tickets-board";

const ticket = (id: string, titulo: string, estado: Ticket["estado"]): Ticket => ({
  ticket_id: id,
  titulo,
  estado,
  prioridad: "MEDIA",
  prioridad_inicial: "MEDIA",
  score: 50,
  etiquetas: [],
  origen: "MANUAL",
  lead_id: null,
  cliente: null,
  notas: "",
  vence: null,
  creado: "2026-09-20T10:00:00Z",
  ultimo_movimiento: "2026-09-20T10:00:00Z",
  escaladas: 0,
  dias_abierto: 4,
  dias_quieto: 4,
  dias_para_escalar: 3,
});

const respuesta = (tickets: Ticket[]) =>
  new Response(
    JSON.stringify({
      ok: true,
      total: tickets.length,
      truncado: false,
      estados: ["BACKLOG", "EN_CURSO", "BLOQUEADO", "HECHO"],
      prioridades: ["BAJA", "MEDIA", "ALTA", "CRITICA"],
      tickets,
    }),
  );

describe("TicketsBoard", () => {
  beforeAll(() => {
    // jsdom no implementa showModal/close de <dialog>.
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function () {
      this.open = false;
    };
  });

  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("mueve un ticket con el selector «Mover a», que también sirve con el teclado", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/tickets/estado") {
        return new Response(JSON.stringify({ok: true}));
      }

      // Después de mover se recarga: la base es la que recalcula el score.
      const movido = fetchMock.mock.calls.some(([u]) => u === "/api/tickets/estado");

      return respuesta([ticket("t1", "Revisar contrato", movido ? "EN_CURSO" : "BACKLOG")]);
    });

    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();

    render(<TicketsBoard />);

    const tarjeta = (await screen.findByText("Revisar contrato")).closest("article")!;

    await user.selectOptions(within(tarjeta).getByRole("combobox"), "EN_CURSO");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tickets/estado",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ticket_id: "t1", estado: "EN_CURSO"}),
      }),
    );

    const columna = screen.getByRole("region", {name: "EN CURSO"});

    expect(within(columna).getByText("Revisar contrato")).toBeInTheDocument();
  });

  it("las pestañas del celular muestran cuántos tickets hay en cada estado", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respuesta([
          ticket("t1", "Uno", "BACKLOG"),
          ticket("t2", "Dos", "BACKLOG"),
          ticket("t3", "Tres", "HECHO"),
        ]),
      ),
    );

    render(<TicketsBoard />);

    const backlog = await screen.findByRole("tab", {name: /BACKLOG/});

    expect(backlog).toHaveAttribute("aria-selected", "true");
    expect(backlog).toHaveTextContent("2");
    expect(screen.getByRole("tab", {name: /HECHO/})).toHaveTextContent("1");
  });

  it("crea un ticket desde el diálogo y lo cierra", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(JSON.stringify({ok: true}));

      return respuesta([]);
    });

    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();

    render(<TicketsBoard />);

    await user.click(await screen.findByRole("button", {name: "+ Nuevo ticket"}));

    const dialogo = screen.getByRole("dialog", {name: "Nuevo ticket"});

    await user.type(within(dialogo).getByPlaceholderText("¿Qué hay pendiente?"), "Llamar a Ana");
    await user.click(within(dialogo).getByRole("button", {name: "Crear ticket"}));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tickets",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          titulo: "Llamar a Ana",
          prioridad: "MEDIA",
          etiquetas: [],
        }),
      }),
    );
    expect(dialogo).not.toHaveAttribute("open");
  });

  it("con movimientos simultáneos y respuestas fuera de orden conserva el éxito aunque otro falle", async () => {
    let resolverA!: (response: Response) => void;
    let resolverB!: (response: Response) => void;
    const respuestaA = new Promise<Response>((resolve) => {
      resolverA = resolve;
    });
    const respuestaB = new Promise<Response>((resolve) => {
      resolverB = resolve;
    });
    let recargas = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/tickets/estado") {
        const id = JSON.parse(String(init?.body)).ticket_id;

        return id === "a" ? respuestaA : respuestaB;
      }
      recargas++;

      return respuesta([
        ticket("a", "Primero", recargas > 1 ? "EN_CURSO" : "BACKLOG"),
        ticket("b", "Segundo", "BACKLOG"),
      ]);
    });

    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<TicketsBoard />);

    const primero = (await screen.findByText("Primero")).closest("article")!;
    const segundo = screen.getByText("Segundo").closest("article")!;

    await user.selectOptions(within(primero).getByRole("combobox"), "EN_CURSO");
    await user.selectOptions(within(segundo).getByRole("combobox"), "HECHO");
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/tickets/estado")).toHaveLength(2);

    resolverB(
      new Response(JSON.stringify({ok: false, error: "Falló segundo"}), {
        status: 500,
      }),
    );
    await screen.findByRole("alert");
    resolverA(new Response(JSON.stringify({ok: true})));

    await waitFor(() => expect(recargas).toBe(2));
    expect(
      within(screen.getByRole("region", {name: "EN CURSO"})).getByText("Primero"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", {name: "BACKLOG"})).getByText("Segundo"),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Falló segundo");
  });
});
