import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import TrabajoEstadoSelect from "./trabajo-estado-select";

describe("TrabajoEstadoSelect", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("arranca mostrando el estado inicial", () => {
    render(<TrabajoEstadoSelect inicial="PENDIENTE" leadId="LD-1" />);

    expect(screen.getByRole("combobox")).toHaveValue("PENDIENTE");
  });

  it("elegir el mismo valor no llama a fetch", async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();

    render(<TrabajoEstadoSelect inicial="PENDIENTE" leadId="LD-1" />);
    await user.selectOptions(screen.getByRole("combobox"), "PENDIENTE");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("optimista: aplica el cambio en pantalla antes de que fetch resuelva", async () => {
    let resolverFetch: (v: Response) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolverFetch = resolve;
        }),
    );

    vi.stubGlobal("fetch", fetchMock);

    const onCambio = vi.fn();
    const user = userEvent.setup();

    render(<TrabajoEstadoSelect inicial="PENDIENTE" leadId="LD-1" onCambio={onCambio} />);
    await user.selectOptions(screen.getByRole("combobox"), "EN_PROGRESO");

    // Ya se ve EN_PROGRESO aunque el fetch todavía no resolvió.
    expect(screen.getByRole("combobox")).toHaveValue("EN_PROGRESO");
    expect(onCambio).toHaveBeenCalledWith("EN_PROGRESO");
    expect(screen.getByRole("combobox")).toBeDisabled();

    resolverFetch(new Response(JSON.stringify({ok: true}), {status: 200}));
    await vi.waitFor(() => expect(screen.getByRole("combobox")).not.toBeDisabled());
    expect(screen.getByRole("combobox")).toHaveValue("EN_PROGRESO");
  });

  it("manda lead_id y el nuevo estado en el body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ok: true}), {status: 200}));

    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();

    render(<TrabajoEstadoSelect inicial="PENDIENTE" leadId="LD-42" />);
    await user.selectOptions(screen.getByRole("combobox"), "ENTREGADO");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/crm/trabajo-estado",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({lead_id: "LD-42", estado: "ENTREGADO"}),
      }),
    );
  });

  it("si el servidor responde ok:false, revierte al valor anterior", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ok: false, error: "no autorizado"}), {
          status: 200,
        }),
      ),
    );

    const onCambio = vi.fn();
    const user = userEvent.setup();

    render(<TrabajoEstadoSelect inicial="PENDIENTE" leadId="LD-1" onCambio={onCambio} />);
    await user.selectOptions(screen.getByRole("combobox"), "EN_PROGRESO");

    await vi.waitFor(() => expect(screen.getByRole("combobox")).toHaveValue("PENDIENTE"));
    expect(onCambio).toHaveBeenLastCalledWith("PENDIENTE");
  });

  it("si el fetch falla (red caída), revierte al valor anterior", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const user = userEvent.setup();

    render(<TrabajoEstadoSelect inicial="EN_PROGRESO" leadId="LD-1" />);
    await user.selectOptions(screen.getByRole("combobox"), "ENTREGADO");

    await vi.waitFor(() => expect(screen.getByRole("combobox")).toHaveValue("EN_PROGRESO"));
  });
});
