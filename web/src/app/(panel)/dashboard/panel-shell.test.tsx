import {render, screen, waitFor} from "@testing-library/react";
import {act} from "react";
import {beforeEach, describe, expect, it, vi} from "vitest";

import {EVENTO_DISPUTAS_CAMBIARON} from "@/lib/hitos";

const rpc = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc,
    channel: () => ({on: () => ({subscribe: () => ({})})}),
    removeChannel: vi.fn(),
  }),
}));
vi.mock("next/navigation", () => ({usePathname: () => "/dashboard"}));

const {default: PanelShell} = await import("./panel-shell");

const disputa = (puede_resolver: boolean) => ({
  id: crypto.randomUUID(),
  puede_resolver,
});

function renderShell(admin: boolean) {
  render(
    <PanelShell
      configurado
      admin={admin}
      email="admin@example.test"
      espacio={{nombre: "Mi espacio", slug: "principal"}}
    >
      contenido
    </PanelShell>,
  );
}

function menuLateral() {
  return screen.getAllByRole("navigation", {name: "Secciones del panel"})[0];
}

describe("PanelShell", () => {
  beforeEach(() => {
    rpc.mockReset().mockImplementation((nombreRpc: string) =>
      Promise.resolve({
        data: nombreRpc === "disputas_abiertas" ? [disputa(true), disputa(false)] : [],
        error: null,
      }),
    );
  });

  it("sin ser admin, no hay sección de disputas", () => {
    renderShell(false);

    expect(screen.queryByRole("link", {name: /Disputas/})).not.toBeInTheDocument();
  });

  it("sin ser admin, no consulta las disputas", () => {
    renderShell(false);

    expect(rpc).not.toHaveBeenCalledWith("disputas_abiertas");
  });

  it("el admin ve la sección con las disputas que puede resolver", async () => {
    renderShell(true);

    await waitFor(() => expect(menuLateral()).toHaveTextContent(/Disputas, disputas abiertas: 1/));
  });

  it("recuenta cuando el tablero avisa que resolvió una", async () => {
    renderShell(true);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    act(() => {
      window.dispatchEvent(new Event(EVENTO_DISPUTAS_CAMBIARON));
    });

    await waitFor(() =>
      expect(rpc.mock.calls.filter(([n]) => n === "disputas_abiertas")).toHaveLength(2),
    );
  });
});
