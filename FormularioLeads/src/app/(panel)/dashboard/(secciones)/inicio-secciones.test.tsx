import {render, screen, within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach, describe, expect, it, vi} from "vitest";

const abrirLead = vi.fn();
let hitosPendientes: unknown[] = [];
let porEnviar: unknown[] = [];

vi.mock("../panel-datos", () => ({
  usePanelDatos: () => ({
    cargando: false,
    metrics: null,
    facturas: [],
    pedidos: [],
    porEnviar,
    trabajos: [],
    hitosPendientes,
    abrirLead,
    cerrarProyecto: vi.fn(),
  }),
}));

const {default: InicioSecciones} = await import("./inicio-secciones");

const crearHito = (extra = {}) => ({
  id: "h1",
  lead_id: "LD-1",
  orden: 2,
  titulo: "Desarrollo",
  monto: 500.5,
  estado: "FONDEADO",
  disputa_motivo: null,
  cliente: "Marta Gómez",
  ...extra,
});

function listaAtencion() {
  return within(screen.getByRole("list"));
}

describe("Requiere tu atención", () => {
  beforeEach(() => {
    abrirLead.mockClear();
    hitosPendientes = [];
    porEnviar = [];
  });

  it("un hito pagado dice cuánto está retenido hasta la entrega", () => {
    hitosPendientes = [crearHito()];
    render(<InicioSecciones cobrosActivos />);

    expect(listaAtencion().getByText(/2\. Desarrollo · US\$ 500,50 retenidos/)).toBeInTheDocument();
  });

  it("«Entregar» abre el proyecto del hito pagado", async () => {
    const user = userEvent.setup();

    hitosPendientes = [crearHito()];
    render(<InicioSecciones cobrosActivos />);
    await user.click(listaAtencion().getByRole("button", {name: "Entregar"}));

    expect(abrirLead).toHaveBeenCalledWith("LD-1");
  });

  it("un hito disputado va primero, como urgente, con el motivo", () => {
    hitosPendientes = [
      crearHito(),
      crearHito({
        id: "h2",
        estado: "EN_DISPUTA",
        disputa_motivo: "No calcula los envíos",
      }),
    ];
    render(<InicioSecciones cobrosActivos />);
    const filas = listaAtencion().getAllByRole("listitem");

    expect(filas[0]).toHaveTextContent(/Hito en disputa.*“No calcula los envíos”/);
  });

  it("sin motivo, el hito disputado no muestra una cita vacía", () => {
    hitosPendientes = [crearHito({estado: "EN_DISPUTA"})];
    render(<InicioSecciones cobrosActivos />);

    expect(listaAtencion().getByText("2. Desarrollo · US$ 500,50")).toBeInTheDocument();
  });

  it("«Ver proyecto» abre el proyecto del hito disputado", async () => {
    const user = userEvent.setup();

    hitosPendientes = [crearHito({estado: "EN_DISPUTA"})];
    render(<InicioSecciones cobrosActivos />);
    await user.click(listaAtencion().getByRole("button", {name: "Ver proyecto"}));

    expect(abrirLead).toHaveBeenCalledWith("LD-1");
  });

  it("al admin le avisa de las disputas que puede resolver, con el enlace", () => {
    render(<InicioSecciones cobrosActivos cantidadDisputasAbiertas={2} />);

    expect(listaAtencion().getByRole("link", {name: "Revisar"})).toHaveAttribute(
      "href",
      "/dashboard/disputas",
    );
  });

  it.each([
    [1, "Un cliente disputó un hito"],
    [2, "2 hitos en disputa"],
  ])("con %i disputa(s) dice «%s»", (cantidad, texto) => {
    render(<InicioSecciones cobrosActivos cantidadDisputasAbiertas={cantidad} />);

    expect(listaAtencion().getByText(texto)).toBeInTheDocument();
  });

  it("sin nada pendiente, está al día", () => {
    render(<InicioSecciones cobrosActivos cantidadDisputasAbiertas={0} />);

    expect(screen.getByText("Estás al día.")).toBeInTheDocument();
  });

  it("muestra el nombre legible del servicio en propuestas por enviar", () => {
    porEnviar = [
      {
        lead_id: "LD-2",
        nombre: "Marta",
        servicio: "ecommerce",
        tier: "HOT",
        score: 80,
        presupuesto: 1000,
        presupuesto_rango: "1000_2000",
        fecha_ingreso: "2026-09-01",
      },
    ];
    render(<InicioSecciones cobrosActivos />);

    expect(listaAtencion().getByText(/HOT · Tienda online · declaró/)).toBeInTheDocument();
  });
});
