import type {PedidoBolsa} from "./bolsa-tablero";

import {render, screen, within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach, describe, expect, it, vi} from "vitest";

const rpc = vi.fn();

vi.mock("@/lib/supabase/client", () => ({createClient: () => ({rpc})}));

const {default: BolsaTablero} = await import("./bolsa-tablero");

const HOY = new Date().toISOString();
const EN_UNA_SEMANA = new Date(Date.now() + 7 * 86_400_000).toISOString();

const pedido = (id: string, extra: Partial<PedidoBolsa> = {}): PedidoBolsa => ({
  id,
  resumen: `Resumen del pedido ${id} sin datos personales.`,
  servicio: "desarrollo_web",
  urgencia: "media",
  presupuesto_rango: "1000_2000",
  presupuesto: 1000,
  estado: "ABIERTO",
  postulaciones: 1,
  tope_postulaciones: 5,
  publicado_en: HOY,
  vence_en: EN_UNA_SEMANA,
  propio: false,
  me_postule: false,
  asignado_a_mi: false,
  titulo: null,
  directo: false,
  mi_postulacion: null,
  etiquetas: [],
  ...extra,
});

describe("BolsaTablero", () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it("separa los abiertos, las postulaciones propias y los publicados por uno", async () => {
    rpc.mockResolvedValue({
      data: [
        pedido("a"),
        pedido("b", {me_postule: true}),
        pedido("c", {propio: true}),
        pedido("d", {
          me_postule: true,
          estado: "ASIGNADO",
          asignado_a_mi: true,
        }),
      ],
      error: null,
    });

    const user = userEvent.setup();

    render(<BolsaTablero />);

    expect(await screen.findByRole("tab", {name: "Abiertos · 1"})).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Resumen del pedido a sin datos personales.")).toBeInTheDocument();
    expect(screen.getByText("US$ 1.000 – 2.000", {selector: "li span"})).toBeInTheDocument();
    expect(screen.getByText("1/5 postulaciones", {exact: false})).toBeInTheDocument();

    await user.click(screen.getByRole("tab", {name: "Mis postulaciones · 2"}));
    expect(screen.getByText("¡Te eligieron!")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", {name: "Publicados por mí · 1"}));
    expect(screen.getByText("Lo publicaste vos")).toBeInTheDocument();
    // A lo propio no se puede postular.
    expect(screen.queryByRole("button", {name: "Postularme"})).not.toBeInTheDocument();
  });

  it("un proyecto publicado por el cliente muestra su título y de dónde viene", async () => {
    rpc.mockResolvedValue({
      data: [pedido("x", {titulo: "Tienda online para mi marca", directo: true})],
      error: null,
    });

    render(<BolsaTablero />);

    expect(
      await screen.findByRole("heading", {
        name: "Tienda online para mi marca",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Lo publicó el cliente")).toBeInTheDocument();
    // El servicio pasa a ser una etiqueta.
    expect(screen.getByText("Desarrollo web", {selector: "li span"})).toBeInTheDocument();
  });

  it("los filtros acotan por texto, tipo de trabajo y «sólo mis servicios»", async () => {
    rpc.mockResolvedValue({
      data: [
        pedido("a", {
          titulo: "Tienda en Shopify",
          servicio: "ecommerce",
          etiquetas: ["Shopify"],
        }),
        pedido("b", {titulo: "Posicionamiento web", servicio: "seo"}),
      ],
      error: null,
    });

    const user = userEvent.setup();

    render(<BolsaTablero misServicios={["ecommerce"]} />);
    await screen.findByRole("heading", {name: "Tienda en Shopify"});

    // Busca también en las etiquetas.
    await user.type(screen.getByRole("searchbox", {name: "Buscar en los pedidos"}), "shopify");
    expect(screen.queryByRole("heading", {name: "Posicionamiento web"})).not.toBeInTheDocument();
    await user.clear(screen.getByRole("searchbox", {name: "Buscar en los pedidos"}));

    await user.selectOptions(screen.getByRole("combobox", {name: "Tipo de trabajo"}), "seo");
    expect(screen.getByRole("heading", {name: "Posicionamiento web"})).toBeInTheDocument();
    expect(screen.queryByRole("heading", {name: "Tienda en Shopify"})).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", {name: "Sólo mis servicios"}));
    expect(await screen.findByText(/Ningún pedido coincide con los filtros/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", {name: "Limpiar filtros"}));
    expect(screen.getByRole("heading", {name: "Tienda en Shopify"})).toBeInTheDocument();
  });

  it("postularse llama a postularme() y pasa a «Mis postulaciones»", async () => {
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "postularme") return {data: null, error: null};

      const postulado = rpc.mock.calls.some(([f]) => f === "postularme");

      return {
        data: [
          pedido("a", {
            me_postule: postulado,
            postulaciones: postulado ? 2 : 1,
          }),
        ],
        error: null,
      };
    });

    const user = userEvent.setup();

    render(<BolsaTablero />);
    await user.click(await screen.findByRole("button", {name: "Postularme"}));

    const tarjeta = screen.getByText("Resumen del pedido a sin datos personales.").closest("li")!;

    await user.type(
      within(tarjeta).getByRole("textbox", {name: "Mensaje para el cliente"}),
      "Hice varios sitios parecidos, lo tengo listo en tres semanas.",
    );
    await user.type(within(tarjeta).getByRole("textbox", {name: /Precio estimado/}), "1500");
    await user.type(within(tarjeta).getByRole("textbox", {name: "Plazo"}), "3 semanas");
    await user.click(within(tarjeta).getByRole("button", {name: "Enviar postulación"}));

    expect(rpc).toHaveBeenCalledWith("postularme", {
      p_pedido: "a",
      p_mensaje: "Hice varios sitios parecidos, lo tengo listo en tres semanas.",
      p_precio: 1500,
      p_plazo: "3 semanas",
    });
    expect(await screen.findByRole("tab", {name: "Mis postulaciones · 1"})).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Te postulaste")).toBeInTheDocument();
  });

  it("si la base rechaza la postulación, muestra su mensaje", async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === "postularme"
        ? {
            data: null,
            error: {message: "El pedido ya no recibe postulaciones"},
          }
        : {data: [pedido("a")], error: null},
    );

    const user = userEvent.setup();

    render(<BolsaTablero />);
    await user.click(await screen.findByRole("button", {name: "Postularme"}));
    await user.type(
      screen.getByRole("textbox", {name: "Mensaje para el cliente"}),
      "Lo puedo hacer sin problema.",
    );
    await user.type(screen.getByRole("textbox", {name: /Precio estimado/}), "900");
    await user.type(screen.getByRole("textbox", {name: "Plazo"}), "2 semanas");
    await user.click(screen.getByRole("button", {name: "Enviar postulación"}));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "El pedido ya no recibe postulaciones",
    );
  });
});
