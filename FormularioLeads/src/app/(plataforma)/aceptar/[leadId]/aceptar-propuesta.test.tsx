import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

describe("AceptarPropuesta", () => {
  const envOriginal = {...process.env};

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    process.env = {...envOriginal, NEXT_PUBLIC_N8N_BASE: "http://n8n.local"};
  });

  afterEach(() => {
    process.env = {...envOriginal};
    vi.restoreAllMocks();
  });

  async function renderComponent(leadId = "LD-1", token = "tok-123") {
    const {default: AceptarPropuesta} = await import("./aceptar-propuesta");

    return render(<AceptarPropuesta leadId={leadId} token={token} />);
  }

  // Responde según la ruta del webhook: la pantalla siempre hace el GET de
  // lead-propuesta al montar, y después un POST según la acción elegida.
  function mockFetch({
    propuesta = {
      status: "ok",
      lead: {nombre: "Juan", servicio: "ecommerce"},
    },
    accion,
  }: {
    propuesta?: Record<string, unknown>;
    accion?: Record<string, unknown>;
  }) {
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
      const body = url.includes("lead-propuesta") ? propuesta : (accion ?? {status: "ok"});

      return Promise.resolve(new Response(JSON.stringify(body), {status: 200}));
    });

    vi.stubGlobal("fetch", fetchMock);

    return fetchMock;
  }

  it("sin leadId/token/N8N_BASE, va directo a inválido sin llamar a fetch", async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);

    await renderComponent("", "");

    expect(await screen.findByText("Enlace no válido")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("muestra la propuesta con los términos que fijó el profesional", async () => {
    mockFetch({
      propuesta: {
        status: "ok",
        lead: {
          nombre: "Juan",
          servicio: "ecommerce",
          precio: 7200,
          plazo: "3 semanas",
        },
      },
    });

    await renderComponent();

    expect(await screen.findByText("Hola, Juan.")).toBeInTheDocument();
    expect(screen.getByText("3 semanas")).toBeInTheDocument();
    expect(screen.getByText("$7.200 USD")).toBeInTheDocument();
  });

  it("por hitos, muestra cada hito, el total y el pago protegido", async () => {
    mockFetch({
      propuesta: {
        status: "ok",
        lead: {
          nombre: "Marta",
          servicio: "ecommerce",
          precio: 1000,
          cobro_modo: "hitos",
          hitos: [
            {orden: 1, titulo: "Diseño", descripcion: "", monto: 300},
            {
              orden: 2,
              titulo: "Desarrollo",
              descripcion: "Carrito y pagos",
              monto: 700,
            },
          ],
        },
      },
    });

    await renderComponent();

    expect(await screen.findByText("1. Diseño")).toBeInTheDocument();
    expect(screen.getByText("Carrito y pagos")).toBeInTheDocument();
    expect(screen.getByText("$700 USD")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByText("$1.000 USD")).toBeInTheDocument();
    expect(screen.getByText(/la plata queda retenida/)).toBeInTheDocument();
  });

  it("aceptada por hitos, lleva a la página del proyecto", async () => {
    mockFetch({
      accion: {
        status: "ok",
        cobro_modo: "hitos",
        proyecto_token: "pt-9",
        mensaje: "Pagá el primer hito.",
      },
    });
    const user = userEvent.setup();

    await renderComponent();
    await user.click(await screen.findByRole("button", {name: /Aceptar propuesta/i}));

    expect(await screen.findByText("Pagá el primer hito.")).toBeInTheDocument();
    expect(screen.getByRole("link", {name: "Ir a tu proyecto"})).toHaveAttribute(
      "href",
      "/proyecto/pt-9",
    );
  });

  it("ya aceptada por hitos, el enlace viejo también lleva al proyecto", async () => {
    mockFetch({
      propuesta: {
        status: "ya_procesado",
        motivo: "token_usado",
        proyecto_token: "pt-9",
        mensaje: "Ya aceptaste.",
      },
    });

    await renderComponent();

    expect(await screen.findByText("Ya aceptaste.")).toBeInTheDocument();
    expect(screen.getByRole("link", {name: "Ir a tu proyecto"})).toHaveAttribute(
      "href",
      "/proyecto/pt-9",
    );
  });

  it("aceptar la propuesta llama a lead-acepta y muestra la pantalla de éxito", async () => {
    const fetchMock = mockFetch({accion: {status: "ok"}});
    const user = userEvent.setup();

    await renderComponent("LD-1", "tok-123");
    await user.click(await screen.findByRole("button", {name: /Aceptar propuesta/i}));

    expect(await screen.findByText("¡Propuesta aceptada!")).toBeInTheDocument();

    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];

    expect(url).toBe("http://n8n.local/webhook/lead-acepta");
    expect(JSON.parse(init.body as string)).toEqual({
      lead_id: "LD-1",
      token: "tok-123",
    });
  });

  it("si el token venció entre medio, muestra 'Oportunidad vencida'", async () => {
    mockFetch({accion: {status: "invalido", motivo: "expirado"}});

    const user = userEvent.setup();

    await renderComponent();
    await user.click(await screen.findByRole("button", {name: /Aceptar propuesta/i}));

    expect(await screen.findByText("Oportunidad vencida")).toBeInTheDocument();
  });

  it("si el token ya rotó (se reenvió la propuesta), muestra 'Enlace desactualizado'", async () => {
    mockFetch({accion: {status: "invalido", motivo: "rotado"}});

    const user = userEvent.setup();

    await renderComponent();
    await user.click(await screen.findByRole("button", {name: /Aceptar propuesta/i}));

    expect(await screen.findByText("Enlace desactualizado")).toBeInTheDocument();
  });

  it("rechazar pide confirmación; si se cancela, no llama al webhook", async () => {
    const fetchMock = mockFetch({});

    vi.spyOn(window, "confirm").mockReturnValue(false);

    const user = userEvent.setup();

    await renderComponent();
    await user.click(await screen.findByRole("button", {name: /^Rechazar$/i}));

    // Sólo el GET inicial de lead-propuesta, ningún POST de rechazo.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Hola, Juan.")).toBeInTheDocument();
  });

  it("rechazar, confirmado, llama a lead-rechaza y muestra 'Propuesta rechazada'", async () => {
    const fetchMock = mockFetch({accion: {status: "ok"}});

    vi.spyOn(window, "confirm").mockReturnValue(true);

    const user = userEvent.setup();

    await renderComponent("LD-1", "tok-123");
    await user.click(await screen.findByRole("button", {name: /^Rechazar$/i}));

    expect(await screen.findByText("Propuesta rechazada")).toBeInTheDocument();

    const [url] = fetchMock.mock.calls.at(-1) as [string, RequestInit];

    expect(url).toBe("http://n8n.local/webhook/lead-rechaza");
  });

  it("pedir cambios: el botón queda deshabilitado hasta escribir al menos 5 caracteres", async () => {
    mockFetch({});

    const user = userEvent.setup();

    await renderComponent();
    await user.click(await screen.findByRole("button", {name: /Pedir cambios/i}));

    const enviar = screen.getByRole("button", {name: /Enviar pedido/i});

    expect(enviar).toBeDisabled();

    await user.type(screen.getByPlaceholderText(/me gustaría ajustar/i), "1234");
    expect(enviar).toBeDisabled();

    await user.type(screen.getByPlaceholderText(/me gustaría ajustar/i), "5");
    expect(enviar).toBeEnabled();
  });

  it("pedir cambios: enviar llama a lead-modifica con el mensaje y muestra 'Pedido recibido'", async () => {
    const fetchMock = mockFetch({accion: {status: "ok"}});
    const user = userEvent.setup();

    await renderComponent("LD-1", "tok-123");
    await user.click(await screen.findByRole("button", {name: /Pedir cambios/i}));
    await user.type(screen.getByPlaceholderText(/me gustaría ajustar/i), "Sumar una pasarela");
    await user.click(screen.getByRole("button", {name: /Enviar pedido/i}));

    expect(await screen.findByText("Pedido recibido")).toBeInTheDocument();

    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];

    expect(url).toBe("http://n8n.local/webhook/lead-modifica");
    expect(JSON.parse(init.body as string)).toEqual({
      lead_id: "LD-1",
      token: "tok-123",
      mensaje: "Sumar una pasarela",
    });
  });

  it("si el GET inicial falla (red caída), muestra la pantalla de error genérica", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await renderComponent();

    expect(await screen.findByText("No pudimos procesar tu solicitud")).toBeInTheDocument();
  });

  it("si n8n devuelve un enlace ya usado sin motivo (backend viejo), cae al cartel genérico", async () => {
    mockFetch({propuesta: {status: "ya_procesado"}});

    await renderComponent();

    expect(await screen.findByText("Enlace ya usado")).toBeInTheDocument();
  });
});
