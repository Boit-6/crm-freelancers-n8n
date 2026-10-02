import {NextRequest} from "next/server";
import {describe, expect, it, vi} from "vitest";

import {redirectSeguro} from "./route";

const ORIGIN = "https://miapp.com";

// Regresión de F0.1 (mitad server-side): mismo bypass que en login-form.tsx,
// acá con `origin` explícito en vez de `window.location.origin`.
describe("redirectSeguro (auth/confirm)", () => {
  it("deja pasar una ruta relativa propia", () => {
    expect(redirectSeguro("/dashboard/tickets", ORIGIN).toString()).toBe(
      "https://miapp.com/dashboard/tickets",
    );
  });

  it("bloquea una URL absoluta a otro origen", () => {
    expect(redirectSeguro("https://evil.com", ORIGIN).toString()).toBe(
      "https://miapp.com/dashboard",
    );
  });

  it("bloquea el bypass de barra invertida (`/\\evil.com`)", () => {
    expect(redirectSeguro("/\\evil.com", ORIGIN).toString()).toBe("https://miapp.com/dashboard");
  });

  it("bloquea protocol-relative (`//evil.com`)", () => {
    expect(redirectSeguro("//evil.com", ORIGIN).toString()).toBe("https://miapp.com/dashboard");
  });

  it("no explota con un valor que ni siquiera parsea como URL", () => {
    expect(redirectSeguro("http://[", ORIGIN).toString()).toBe("https://miapp.com/dashboard");
  });
});

// Las dos formas en que Supabase manda el enlace (plantilla personalizada con
// token_hash, o la por defecto con el código PKCE).
describe("GET /auth/confirm", () => {
  async function confirmar(query: string, auth: Record<string, unknown>) {
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({auth}),
    }));

    const {GET} = await import("./route");
    const res = await GET(new NextRequest(`https://miapp.com/auth/confirm?${query}`));

    return res.headers.get("location");
  }

  it("con token_hash, verifica el OTP y va a `next`", async () => {
    const verifyOtp = vi.fn().mockResolvedValue({error: null});

    expect(await confirmar("token_hash=abc&type=email&next=/cliente", {verifyOtp})).toBe(
      "https://miapp.com/cliente",
    );
    expect(verifyOtp).toHaveBeenCalledWith({
      type: "email",
      token_hash: "abc",
    });
  });

  it("con code (plantilla por defecto), canjea el código y va a `next`", async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({error: null});

    expect(await confirmar("code=xyz&next=/cliente", {exchangeCodeForSession})).toBe(
      "https://miapp.com/cliente",
    );
    expect(exchangeCodeForSession).toHaveBeenCalledWith("xyz");
  });

  it("si el código no sirve, manda al login con el error", async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({error: new Error("vencido")});

    expect(await confirmar("code=viejo", {exchangeCodeForSession})).toMatch(
      /^https:\/\/miapp\.com\/login\?error=/,
    );
  });
});
