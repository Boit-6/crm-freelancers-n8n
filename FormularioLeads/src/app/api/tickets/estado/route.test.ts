import {NextRequest} from "next/server";
import {beforeEach, describe, expect, it, vi} from "vitest";

import {requirePanel} from "@/lib/auth";
import {createClient} from "@/lib/supabase/server";

vi.mock("@/lib/auth", () => ({requirePanel: vi.fn()}));
vi.mock("@/lib/supabase/server", () => ({createClient: vi.fn()}));

const ID = "0f0e0d0c-0b0a-4090-8080-707060605050";

function pedido(body: unknown) {
  return new NextRequest("http://localhost/api/tickets/estado", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// Cliente de Supabase mínimo: registra el update y devuelve las filas que se le digan.
function supabaseFalso(filas: {id: string}[] = [{id: ID}]) {
  const update = vi.fn(() => ({
    eq: () => ({select: async () => ({data: filas, error: null})}),
  }));

  vi.mocked(createClient).mockResolvedValue({
    from: () => ({update}),
  } as never);

  return update;
}

describe("POST /api/tickets/estado", () => {
  beforeEach(() => {
    vi.mocked(requirePanel).mockResolvedValue(null);
  });

  it("403 sin espacio, sin tocar la base", async () => {
    vi.mocked(requirePanel).mockResolvedValue(Response.json({ok: false}, {status: 403}) as never);
    const update = supabaseFalso();
    const {POST} = await import("./route");

    expect((await POST(pedido({ticket_id: ID, estado: "HECHO"}))).status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });

  it("400 con un estado fuera de la escala", async () => {
    const update = supabaseFalso();
    const {POST} = await import("./route");

    expect((await POST(pedido({ticket_id: ID, estado: "ARCHIVADO"}))).status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it("400 si no hay nada que cambiar", async () => {
    supabaseFalso();
    const {POST} = await import("./route");

    expect((await POST(pedido({ticket_id: ID}))).status).toBe(400);
  });

  it("mueve el ticket normalizando a mayúsculas", async () => {
    const update = supabaseFalso();
    const {POST} = await import("./route");
    const res = await POST(pedido({ticket_id: ID, estado: "en_curso", prioridad: "alta"}));

    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith({
      estado: "EN_CURSO",
      prioridad: "ALTA",
    });
  });

  it("404 si el ticket no existe (o la RLS no lo deja ver)", async () => {
    supabaseFalso([]);
    const {POST} = await import("./route");

    expect((await POST(pedido({ticket_id: ID, estado: "HECHO"}))).status).toBe(404);
  });
});
