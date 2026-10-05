import {NextRequest} from "next/server";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {getPanelStatus, requirePanel} from "@/lib/auth";
import {createClient} from "@/lib/supabase/server";

// `vi.mock` queda hoisteado por Vitest al tope del archivo, antes que
// cualquier import — no hace falta escribirlo primero a mano.
vi.mock("@/lib/auth", () => ({
  requirePanel: vi.fn(),
  getPanelStatus: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

// La cadena `.from(tabla).select(campo).eq(campo, valor).maybeSingle()` con la
// que el route handler comprueba que el pedido sea del espacio de quien llama.
// `visibles` son los ids que la RLS le deja ver.
function mockSupabase(visibles: string[]) {
  const eq = vi.fn((_campo: string, valor: string) => ({
    maybeSingle: vi.fn().mockResolvedValue({
      data: visibles.includes(valor) ? {id: valor} : null,
    }),
  }));
  const from = vi.fn(() => ({select: vi.fn(() => ({eq}))}));

  return {from, eq};
}

function post(body: unknown) {
  return new NextRequest("http://localhost/api/crm/cancelar", {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify(body),
  });
}

describe("POST /api/crm/[accion]", () => {
  const envOriginal = {...process.env};

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    process.env = {
      ...envOriginal,
      N8N_BASE: "http://n8n.local",
      CRM_PANEL_TOKEN: "panel-secreto",
    };
    vi.mocked(requirePanel).mockReset();
    vi.mocked(requirePanel).mockResolvedValue(null);
    vi.mocked(createClient).mockResolvedValue(mockSupabase(["LD-1", "FAC-1"]) as never);
  });

  afterEach(() => {
    process.env = {...envOriginal};
  });

  it("respeta lo que devuelva requirePanel() sin llegar a llamar a n8n", async () => {
    const denegado = new Response(JSON.stringify({ok: false, error: "No autenticado."}), {
      status: 401,
    });

    vi.mocked(requirePanel).mockResolvedValue(denegado as never);

    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);

    const {POST} = await import("./route");
    const res = await POST(post({lead_id: "LD-1"}), {
      params: Promise.resolve({accion: "cancelar"}),
    });

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("404 para una acción fuera de la lista blanca", async () => {
    const {POST} = await import("./route");
    const res = await POST(post({}), {
      params: Promise.resolve({accion: "borrar-toda-la-base"}),
    });

    expect(res.status).toBe(404);
  });

  it("503 (fail-closed) si falta CRM_PANEL_TOKEN, aunque el resto esté bien", async () => {
    delete process.env.CRM_PANEL_TOKEN;

    const {POST} = await import("./route");
    const res = await POST(post({lead_id: "LD-1"}), {
      params: Promise.resolve({accion: "cancelar"}),
    });

    expect(res.status).toBe(503);
  });

  it("500 si falta N8N_BASE / NEXT_PUBLIC_N8N_BASE", async () => {
    delete process.env.N8N_BASE;
    delete process.env.NEXT_PUBLIC_N8N_BASE;

    const {POST} = await import("./route");
    const res = await POST(post({lead_id: "LD-1"}), {
      params: Promise.resolve({accion: "cancelar"}),
    });

    expect(res.status).toBe(500);
  });

  it("400 con un body que no es JSON válido", async () => {
    const {POST} = await import("./route");
    const req = new NextRequest("http://localhost/api/crm/cancelar", {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: "esto no es json",
    });
    const res = await POST(req, {
      params: Promise.resolve({accion: "cancelar"}),
    });

    expect(res.status).toBe(400);
  });

  it("404 sin llamar a n8n si el pedido es de otro espacio (la RLS no lo deja ver)", async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);

    const {POST} = await import("./route");
    const res = await POST(post({lead_id: "LD-AJENO"}), {
      params: Promise.resolve({accion: "cancelar"}),
    });

    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("404 sin llamar a n8n si la factura es de otro espacio", async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);

    const {POST} = await import("./route");
    const res = await POST(post({factura_id: "FAC-AJENA"}), {
      params: Promise.resolve({accion: "factura-anular"}),
    });

    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("404 si uno de los dos ids es ajeno, aunque el otro sea propio", async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);

    const {POST} = await import("./route");
    const res = await POST(post({lead_id: "LD-1", factura_id: "FAC-AJENA"}), {
      params: Promise.resolve({accion: "factura-anular"}),
    });

    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("400 sin lead_id ni factura_id, o con uno que no es texto", async () => {
    const {POST} = await import("./route");

    for (const body of [{}, {lead_id: 42}, {lead_id: ""}, ["LD-1"]]) {
      const res = await POST(post(body), {
        params: Promise.resolve({accion: "cancelar"}),
      });

      expect(res.status).toBe(400);
    }
  });

  it("stripe-conectar manda el espacio de la sesión, no el que venga en el cuerpo", async () => {
    vi.mocked(getPanelStatus).mockResolvedValue({
      user: {id: "u1"} as never,
      espacio: {id: "esp-propio"} as never,
      supabaseDisponible: true,
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ok: true, url: "https://stripe"}), {
        status: 200,
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    const {POST} = await import("./route");
    const res = await POST(post({espacio_id: "esp-ajeno"}), {
      params: Promise.resolve({accion: "stripe-conectar"}),
    });

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://n8n.local/webhook/stripe-conectar",
      expect.objectContaining({
        body: JSON.stringify({espacio_id: "esp-propio"}),
      }),
    );
  });

  it("stripe-estado sin espacio en la sesión: 403 sin llamar a n8n", async () => {
    vi.mocked(getPanelStatus).mockResolvedValue({
      user: null,
      espacio: null,
      supabaseDisponible: true,
    });
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);

    const {POST} = await import("./route");
    const res = await POST(post({}), {
      params: Promise.resolve({accion: "stripe-estado"}),
    });

    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("manda el header del panel a n8n y reenvía su respuesta JSON", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ok: true}), {status: 200}));

    vi.stubGlobal("fetch", fetchMock);

    const {POST} = await import("./route");
    const res = await POST(post({lead_id: "LD-1"}), {
      params: Promise.resolve({accion: "cancelar"}),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://n8n.local/webhook/lead-cancelar",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({"x-crm-token": "panel-secreto"}),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ok: true});
  });

  it("502 propio (no expone el token) si n8n rechaza la credencial con 403", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Forbidden", {status: 403})));

    const {POST} = await import("./route");
    const res = await POST(post({lead_id: "LD-1"}), {
      params: Promise.resolve({accion: "cancelar"}),
    });

    expect(res.status).toBe(502);
  });

  it("normaliza a JSON una respuesta vacía de n8n", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", {status: 200})));

    const {POST} = await import("./route");
    const res = await POST(post({lead_id: "LD-1"}), {
      params: Promise.resolve({accion: "cancelar"}),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ok: true});
  });

  it("502 si no se puede contactar a n8n", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const {POST} = await import("./route");
    const res = await POST(post({lead_id: "LD-1"}), {
      params: Promise.resolve({accion: "cancelar"}),
    });

    expect(res.status).toBe(502);
  });
});
