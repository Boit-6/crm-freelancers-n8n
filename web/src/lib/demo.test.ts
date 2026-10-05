import {afterEach, describe, expect, it, vi} from "vitest";

import {cuentasDemo, modoDemo} from "./demo";

describe("modo demo", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("está apagado si NEXT_PUBLIC_DEMO no es 1", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO", "");
    vi.stubEnv("NEXT_PUBLIC_DEMO_DESARROLLADOR_EMAIL", "demo@example.test");
    vi.stubEnv("NEXT_PUBLIC_DEMO_DESARROLLADOR_CLAVE", "clave");

    expect(modoDemo()).toBe(false);
    expect(cuentasDemo()).toEqual([]);
  });

  it("ofrece sólo las cuentas que tienen correo y clave", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO", "1");
    vi.stubEnv("NEXT_PUBLIC_DEMO_DESARROLLADOR_EMAIL", "demo@example.test");
    vi.stubEnv("NEXT_PUBLIC_DEMO_DESARROLLADOR_CLAVE", "clave");
    vi.stubEnv("NEXT_PUBLIC_DEMO_CLIENTE_EMAIL", "cliente@example.test");
    vi.stubEnv("NEXT_PUBLIC_DEMO_CLIENTE_CLAVE", "");

    expect(cuentasDemo()).toEqual([
      {rol: "Desarrollador", email: "demo@example.test", clave: "clave"},
    ]);
  });
});
