import {describe, expect, it} from "vitest";

import {redirectSeguro} from "./login-form";

// Regresión de F0.1: un `startsWith("/")` no alcanza para evitar el open
// redirect, porque `/\evil.com` también empieza con "/" y los navegadores
// normalizan `\` a `/` al resolver la URL, terminando en `https://evil.com`.
describe("redirectSeguro (login)", () => {
  it("sin valor, va al dashboard", () => {
    expect(redirectSeguro(null)).toBe("/dashboard");
  });

  it("deja pasar una ruta relativa propia", () => {
    expect(redirectSeguro("/dashboard/tickets")).toBe("/dashboard/tickets");
  });

  it("conserva query y hash de una ruta propia", () => {
    expect(redirectSeguro("/dashboard?tab=leads#top")).toBe("/dashboard?tab=leads#top");
  });

  it("bloquea una URL absoluta a otro origen", () => {
    expect(redirectSeguro("https://evil.com")).toBe("/dashboard");
  });

  it("bloquea el bypass de barra invertida (`/\\evil.com`)", () => {
    expect(redirectSeguro("/\\evil.com")).toBe("/dashboard");
  });

  it("bloquea protocol-relative (`//evil.com`)", () => {
    expect(redirectSeguro("//evil.com")).toBe("/dashboard");
  });

  it("no explota con un valor que ni siquiera parsea como URL", () => {
    expect(redirectSeguro("http://[")).toBe("/dashboard");
  });
});
