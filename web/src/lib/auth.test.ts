import {redirect} from "next/navigation";
import {beforeEach, describe, expect, it, vi} from "vitest";

import {getPanelStatus, getPanelUser, requirePanel} from "./auth";

import {createClient} from "@/lib/supabase/server";

// `vi.mock` queda hoisteado por Vitest al tope del archivo, antes que
// cualquier import — no hace falta escribirlo primero a mano.
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((ruta: string) => {
    throw new Error(`REDIRECT:${ruta}`);
  }),
}));

const ESPACIO = {
  id: "esp-1",
  slug: "mi-espacio",
  nombre: "Mi espacio",
  email_contacto: null,
  telegram_chat_id: null,
  stripe_account_id: null,
  stripe_cobros_activos: false,
  configurado_en: null,
};

// Reproduce sólo la parte de la cadena de Supabase que usa getPanelStatus:
// `.from("espacios").select(...).eq("dueno_id", ...).maybeSingle()`.
function mockSupabase(options: {user: {id: string} | null; espacio?: typeof ESPACIO}) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({data: {user: options.user}}),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({data: options.espacio ?? null}),
        }),
      }),
    }),
  };
}

describe("getPanelStatus", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
  });

  it("marca supabaseDisponible en false si faltan las variables de Supabase", async () => {
    vi.mocked(createClient).mockResolvedValue(null);

    const estado = await getPanelStatus();

    expect(estado).toEqual({
      user: null,
      espacio: null,
      supabaseDisponible: false,
    });
  });

  it("no llega a buscar el espacio si no hay sesión", async () => {
    const supabase = mockSupabase({user: null});

    vi.mocked(createClient).mockResolvedValue(supabase as any);

    const estado = await getPanelStatus();

    expect(estado).toEqual({
      user: null,
      espacio: null,
      supabaseDisponible: true,
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("devuelve el espacio del usuario, buscado por dueno_id", async () => {
    const user = {id: "user-1"};
    const supabase = mockSupabase({user, espacio: ESPACIO});

    vi.mocked(createClient).mockResolvedValue(supabase as any);

    const estado = await getPanelStatus();

    expect(estado).toEqual({
      user,
      espacio: ESPACIO,
      supabaseDisponible: true,
    });
    expect(supabase.from).toHaveBeenCalledWith("espacios");
    expect(supabase.from("espacios").select("").eq).toHaveBeenCalledWith("dueno_id", "user-1");
  });

  it("espacio es null para una cuenta sin espacio (sin confirmar)", async () => {
    const user = {id: "user-2"};
    const supabase = mockSupabase({user});

    vi.mocked(createClient).mockResolvedValue(supabase as any);

    const estado = await getPanelStatus();

    expect(estado.espacio).toBeNull();
  });
});

describe("getPanelUser", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
    vi.mocked(redirect).mockClear();
  });

  it("redirige a /login sin sesión", async () => {
    vi.mocked(createClient).mockResolvedValue(null);

    await expect(getPanelUser()).rejects.toThrow("REDIRECT:/login");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("redirige a / con sesión pero sin espacio", async () => {
    const supabase = mockSupabase({user: {id: "u"}});

    vi.mocked(createClient).mockResolvedValue(supabase as any);

    await expect(getPanelUser()).rejects.toThrow("REDIRECT:/");
    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("devuelve el usuario y su espacio, sin redirigir", async () => {
    const user = {id: "dev-1"};
    const supabase = mockSupabase({user, espacio: ESPACIO});

    vi.mocked(createClient).mockResolvedValue(supabase as any);

    await expect(getPanelUser()).resolves.toEqual({user, espacio: ESPACIO});
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("requirePanel", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
  });

  it("500 si faltan las variables de Supabase en el servidor", async () => {
    vi.mocked(createClient).mockResolvedValue(null);

    expect((await requirePanel())?.status).toBe(500);
  });

  it("401 sin sesión", async () => {
    vi.mocked(createClient).mockResolvedValue(mockSupabase({user: null}) as never);

    expect((await requirePanel())?.status).toBe(401);
  });

  it("403 con sesión pero sin espacio", async () => {
    vi.mocked(createClient).mockResolvedValue(mockSupabase({user: {id: "u1"}}) as never);

    expect((await requirePanel())?.status).toBe(403);
  });

  it("null (deja pasar) con sesión y espacio", async () => {
    vi.mocked(createClient).mockResolvedValue(
      mockSupabase({user: {id: "u1"}, espacio: ESPACIO}) as never,
    );

    expect(await requirePanel()).toBeNull();
  });
});
