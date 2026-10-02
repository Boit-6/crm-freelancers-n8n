import {render, screen, waitFor, within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach, describe, expect, it, vi} from "vitest";

const rpc = vi.fn();

vi.mock("@/lib/supabase/client", () => ({createClient: () => ({rpc})}));

const {default: DisputasTablero} = await import("./disputas-tablero");

const disputaAbierta = {
  id: "h2",
  lead_id: "LD-1",
  titulo: "Desarrollo",
  monto: 500.5,
  disputa_motivo: "El carrito no calcula los envíos.",
  disputa_abierta_en: "2026-09-28T15:00:00Z",
  entrega_nota: "Tienda en el dominio de prueba",
  espacio_nombre: "Pablo Dev",
  cliente_nombre: "Marta",
  servicio: "ecommerce",
  puede_resolver: true,
};

const crearResuelta = (extra = {}) => ({
  id: "h9",
  lead_id: "LD-2",
  titulo: "Diseño",
  monto: 300,
  disputa_motivo: "No era lo pedido",
  monto_liberado: 100,
  monto_reembolsado: 200,
  resolucion_nota: "Se entregó un tercio",
  cerrado_en: "2026-09-27T10:00:00Z",
  cierre: "resuelto",
  resuelto_por: "admin@tesis.local",
  transferido_en: null,
  reembolsado_en: null,
  espacio_nombre: "Lucía Estudio",
  cliente_nombre: "Ana",
  servicio: "desarrollo_web",
  ...extra,
});

const crearDetalle = (extra = {}) => ({
  hito: {
    id: "h2",
    orden: 2,
    titulo: "Desarrollo",
    descripcion: null,
    monto: 500.5,
    estado: "EN_DISPUTA",
    comision_porcentaje: 5,
    fondeado_en: null,
    entrega_nota: "Tienda en el dominio de prueba",
    entregado_en: null,
    disputa_motivo: "El carrito no calcula los envíos.",
    disputa_abierta_en: null,
    monto_liberado: 0,
    monto_reembolsado: 0,
    comision: 0,
    resolucion_nota: null,
    cerrado_en: null,
    transferido_en: null,
    reembolsado_en: null,
    resuelto_por: null,
  },
  proyecto: {
    lead_id: "LD-1",
    servicio: "ecommerce",
    cliente_nombre: "Marta",
    espacio_nombre: "Pablo Dev",
    espacio_slug: "pablo-dev",
    de_plataforma: true,
    hitos: [
      {orden: 1, titulo: "Diseño", monto: 300, estado: "LIBERADO"},
      {orden: 2, titulo: "Desarrollo", monto: 500.5, estado: "EN_DISPUTA"},
    ],
  },
  eventos: [
    {
      tipo: "fondeado",
      actor: "cliente",
      detalle: null,
      creado_en: "2026-09-28T12:00:00Z",
    },
    {
      tipo: "disputado",
      actor: "cliente",
      detalle: "El carrito no calcula los envíos.",
      creado_en: "2026-09-28T15:00:00Z",
    },
  ],
  mensajes: [
    {
      autor: "cliente",
      texto: "¿Y el envío a Córdoba?",
      creado_en: "2026-09-28T14:00:00Z",
    },
  ],
  puede_resolver: true,
  ...extra,
});

interface Escenario {
  detalle?: ReturnType<typeof crearDetalle>;
  resueltas?: ReturnType<typeof crearResuelta>[];
  errorAlResolver?: string;
}

// Responde cada RPC como la base. Después de resolver, la disputa pasa de las
// abiertas a las resueltas, como pasaría de verdad.
function mockearRpc({
  detalle = crearDetalle(),
  resueltas = [crearResuelta()],
  errorAlResolver,
}: Escenario = {}) {
  let resuelta = false;

  rpc.mockImplementation((nombreRpc: string) => {
    switch (nombreRpc) {
      case "disputas_abiertas":
        return Promise.resolve({
          data: resuelta ? [] : [disputaAbierta],
          error: null,
        });
      case "disputas_resueltas":
        return Promise.resolve({
          data: resuelta ? [crearResuelta({id: "h2"}), ...resueltas] : resueltas,
          error: null,
        });
      case "disputa_detalle":
        return Promise.resolve({data: detalle, error: null});
      case "resolver_disputa":
        if (errorAlResolver)
          return Promise.resolve({
            data: null,
            error: {message: errorAlResolver},
          });
        resuelta = true;

        return Promise.resolve({data: null, error: null});
      default:
        return Promise.resolve({data: null, error: null});
    }
  });
}

async function abrirDetalle(user: ReturnType<typeof userEvent.setup>) {
  render(<DisputasTablero />);
  await user.click(await screen.findByRole("button", {name: "Revisar y resolver"}));
}

async function elegirPartir(user: ReturnType<typeof userEvent.setup>, monto: string) {
  await user.click(await screen.findByLabelText("Partir"));
  await user.type(screen.getByLabelText(/Para el desarrollador/), monto);
}

describe("DisputasTablero", () => {
  beforeEach(() => rpc.mockReset());

  describe("disputas abiertas", () => {
    it("muestran el motivo del cliente y la entrega del desarrollador", async () => {
      mockearRpc();
      render(<DisputasTablero />);

      expect(await screen.findByText("El carrito no calcula los envíos.")).toBeInTheDocument();
      expect(screen.getByText("Tienda en el dominio de prueba")).toBeInTheDocument();
    });

    it("sin disputas, lo dice", async () => {
      rpc.mockResolvedValue({data: [], error: null});
      render(<DisputasTablero />);

      expect(await screen.findByText("No hay disputas abiertas.")).toBeInTheDocument();
    });

    it("si la carga falla, muestra el error y no el vacío", async () => {
      rpc.mockResolvedValue({
        data: null,
        error: {message: "Sólo el admin ve las disputas"},
      });
      render(<DisputasTablero />);

      expect(await screen.findByRole("alert")).toHaveTextContent("Sólo el admin ve las disputas");
      expect(screen.queryByText("No hay disputas abiertas.")).not.toBeInTheDocument();
    });
  });

  describe("detalle", () => {
    it("trae el historial y la conversación del hito", async () => {
      const user = userEvent.setup();

      mockearRpc();
      await abrirDetalle(user);

      expect(await screen.findByText("¿Y el envío a Córdoba?")).toBeInTheDocument();
      expect(screen.getByText("Pagado: la plata queda retenida")).toBeInTheDocument();
    });

    it("con un cliente propio avisa que no hay conversación", async () => {
      const user = userEvent.setup();
      const base = crearDetalle();

      mockearRpc({
        detalle: crearDetalle({
          mensajes: [],
          proyecto: {...base.proyecto, de_plataforma: false},
        }),
      });
      await abrirDetalle(user);

      expect(await screen.findByText(/no hay conversación en la plataforma/)).toBeInTheDocument();
    });

    it("en un proyecto propio del admin no aparece el formulario", async () => {
      const user = userEvent.setup();

      mockearRpc({detalle: crearDetalle({puede_resolver: false})});
      await abrirDetalle(user);

      expect(await screen.findByText(/Es un proyecto tuyo/)).toBeInTheDocument();
      expect(screen.queryByRole("button", {name: "Resolver"})).not.toBeInTheDocument();
    });
  });

  describe("resolver", () => {
    it("partir muestra el reparto y lo que le llega al desarrollador", async () => {
      const user = userEvent.setup();

      mockearRpc();
      await abrirDetalle(user);
      await elegirPartir(user, "200");

      expect(screen.getByText(/Al desarrollador/)).toHaveTextContent(
        /US\$ 200.*le llegan US\$ 190.*Vuelve al cliente: US\$ 300,50/,
      );
    });

    it("un monto igual al total no deja resolver y explica el rango", async () => {
      const user = userEvent.setup();

      mockearRpc();
      await abrirDetalle(user);
      await elegirPartir(user, "500,50");
      await user.type(screen.getByLabelText("Nota para las dos partes"), "Todo al desarrollador");

      expect(screen.getByLabelText(/Para el desarrollador/)).toHaveAccessibleDescription(
        /más de US\$\s0 y menos de US\$\s500,50/,
      );
      expect(screen.getByRole("button", {name: "Resolver"})).toBeDisabled();
    });

    it.each([
      ["4 caracteres", "abcd", true],
      ["5 caracteres", "abcde", false],
    ])("con una nota de %s, «Resolver» deshabilitado = %s", async (_, nota, deshabilitado) => {
      const user = userEvent.setup();

      mockearRpc();
      await abrirDetalle(user);
      await user.click(await screen.findByLabelText("Reembolsar todo al cliente"));
      await user.type(screen.getByLabelText("Nota para las dos partes"), nota);

      expect(screen.getByRole("button", {name: "Resolver"}).hasAttribute("disabled")).toBe(
        deshabilitado,
      );
    });

    it("pide confirmar antes de mover la plata", async () => {
      const user = userEvent.setup();

      mockearRpc();
      await abrirDetalle(user);
      await elegirPartir(user, "200");
      await user.type(screen.getByLabelText("Nota para las dos partes"), "Se entregó la mitad");
      await user.click(screen.getByRole("button", {name: "Resolver"}));

      expect(rpc).not.toHaveBeenCalledWith("resolver_disputa", expect.anything());
    });

    it("«Volver» cancela la confirmación sin resolver", async () => {
      const user = userEvent.setup();

      mockearRpc();
      await abrirDetalle(user);
      await elegirPartir(user, "200");
      await user.type(screen.getByLabelText("Nota para las dos partes"), "Se entregó la mitad");
      await user.click(screen.getByRole("button", {name: "Resolver"}));
      await user.click(screen.getByRole("button", {name: "Volver"}));

      await waitFor(() => expect(screen.getByRole("button", {name: "Resolver"})).toHaveFocus());
    });

    it.each([
      ["Liberar todo al desarrollador", 500.5],
      ["Reembolsar todo al cliente", 0],
      ["Partir", 200],
    ])("«%s» manda p_liberar = %s", async (opcion, liberar) => {
      const user = userEvent.setup();

      mockearRpc();
      await abrirDetalle(user);
      if (opcion === "Partir") await elegirPartir(user, "200");
      else await user.click(await screen.findByLabelText(opcion));
      await user.type(screen.getByLabelText("Nota para las dos partes"), "Motivo de la decisión");
      await user.click(screen.getByRole("button", {name: "Resolver"}));
      await user.click(screen.getByRole("button", {name: "Sí, resolver"}));

      expect(rpc).toHaveBeenCalledWith("resolver_disputa", {
        p_hito: "h2",
        p_liberar: liberar,
        p_nota: "Motivo de la decisión",
      });
    });

    it("al resolver, recarga las listas y pasa a las resueltas con un aviso", async () => {
      const user = userEvent.setup();

      mockearRpc();
      await abrirDetalle(user);
      await user.click(await screen.findByLabelText("Liberar todo al desarrollador"));
      await user.type(screen.getByLabelText("Nota para las dos partes"), "Entregó lo pactado");
      await user.click(screen.getByRole("button", {name: "Resolver"}));
      await user.click(screen.getByRole("button", {name: "Sí, resolver"}));

      expect(await screen.findByRole("tab", {name: "Resueltas · 2"})).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(screen.getByRole("tab", {name: "Abiertas · 0"})).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("Disputa resuelta");
    });

    it("si la base rechaza la resolución, muestra el error y sigue abierta", async () => {
      const user = userEvent.setup();

      mockearRpc({errorAlResolver: "Este hito no está en disputa"});
      await abrirDetalle(user);
      await user.click(await screen.findByLabelText("Liberar todo al desarrollador"));
      await user.type(screen.getByLabelText("Nota para las dos partes"), "Entregó lo pactado");
      await user.click(screen.getByRole("button", {name: "Resolver"}));
      await user.click(screen.getByRole("button", {name: "Sí, resolver"}));

      expect(await screen.findByRole("alert")).toHaveTextContent("Este hito no está en disputa");
      expect(screen.getByRole("tab", {name: "Abiertas · 1"})).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
  });

  describe("disputas resueltas", () => {
    async function verResueltas(resuelta: ReturnType<typeof crearResuelta>) {
      const user = userEvent.setup();

      mockearRpc({resueltas: [resuelta]});
      render(<DisputasTablero />);
      await user.click(await screen.findByRole("tab", {name: "Resueltas · 1"}));

      return within(screen.getByText("Diseño").closest("li")!);
    }

    it("dicen quién resolvió y cuánto fue a cada parte", async () => {
      const tarjeta = await verResueltas(crearResuelta());

      expect(tarjeta.getByText(/Resuelta por admin@tesis.local/)).toHaveTextContent(
        /US\$ 100 al desarrollador · US\$ 200 al cliente/,
      );
    });

    it("sin los movimientos en Stripe, quedan pendientes", async () => {
      const tarjeta = await verResueltas(crearResuelta());

      expect(tarjeta.getByText("Pendiente de mover en Stripe")).toBeInTheDocument();
    });

    it("con la transferencia y el reembolso hechos, ya se movió", async () => {
      const tarjeta = await verResueltas(
        crearResuelta({
          transferido_en: "2026-09-27T10:05:00Z",
          reembolsado_en: "2026-09-27T10:05:00Z",
        }),
      );

      expect(tarjeta.getByText("Ya se movió en Stripe")).toBeInTheDocument();
    });

    it("si todo se reembolsó, no espera una transferencia", async () => {
      const tarjeta = await verResueltas(
        crearResuelta({
          monto_liberado: 0,
          monto_reembolsado: 300,
          reembolsado_en: "2026-09-27T10:05:00Z",
        }),
      );

      expect(tarjeta.getByText("Ya se movió en Stripe")).toBeInTheDocument();
    });

    it("la que cerró el desarrollador devolviendo lo dice", async () => {
      const tarjeta = await verResueltas(crearResuelta({cierre: "devuelto", resuelto_por: null}));

      expect(tarjeta.getByText(/La cerró el desarrollador devolviendo/)).toBeInTheDocument();
    });
  });
});
