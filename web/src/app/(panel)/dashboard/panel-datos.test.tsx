import {render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {useState} from "react";
import {beforeEach, describe, expect, it, vi} from "vitest";

const {cargarPanel} = vi.hoisted(() => ({cargarPanel: vi.fn()}));

vi.mock("./panel-loader", () => ({cargarPanel}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: () => {
      const canal = {on: () => canal, subscribe: () => canal};

      return canal;
    },
    removeChannel: vi.fn(),
  }),
}));
vi.mock("@/app/components/confirm-dialog", () => ({
  useConfirm: () => [async () => true, () => null],
}));
vi.mock("./lead-detalle", () => {
  function DetalleFalso({
    onAceptarCambio,
    onCerrar,
  }: {
    onAceptarCambio: (id: string) => Promise<boolean>;
    onCerrar: () => void;
  }) {
    const [resultado, setResultado] = useState("");

    return (
      <div role="dialog">
        <button
          onClick={async () => {
            if (await onAceptarCambio("lead-1")) onCerrar();
            else setResultado("Sigue abierto");
          }}
        >
          Aceptar cambio
        </button>
        <span>{resultado}</span>
      </div>
    );
  }

  return {default: DetalleFalso};
});

import PanelDatosProvider, {usePanelDatos} from "./panel-datos";

function Abridor() {
  const {abrirLead} = usePanelDatos();

  return <button onClick={() => abrirLead("lead-1")}>Abrir lead</button>;
}

describe("PanelDatosProvider", () => {
  beforeEach(() => {
    cargarPanel.mockResolvedValue({datos: {}, errores: []});
    vi.unstubAllGlobals();
  });

  it("mantiene abierto el detalle si la confirmación fue aceptada pero la API falló", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ok: false, error: "Fallo API"}), {
            status: 500,
          }),
      ),
    );
    const user = userEvent.setup();

    render(
      <PanelDatosProvider>
        <Abridor />
      </PanelDatosProvider>,
    );

    await user.click(screen.getByRole("button", {name: "Abrir lead"}));
    await user.click(screen.getByRole("button", {name: "Aceptar cambio"}));

    expect(await screen.findByText("Sigue abierto")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Fallo API"));
  });

  it("cierra el detalle sólo cuando la API confirma el cambio", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ok: true}))),
    );
    const user = userEvent.setup();

    render(
      <PanelDatosProvider>
        <Abridor />
      </PanelDatosProvider>,
    );

    await user.click(screen.getByRole("button", {name: "Abrir lead"}));
    await user.click(screen.getByRole("button", {name: "Aceptar cambio"}));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
