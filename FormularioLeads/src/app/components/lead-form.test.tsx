import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

describe("LeadForm", () => {
  const envOriginal = {...process.env};

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    process.env = {...envOriginal, NEXT_PUBLIC_N8N_BASE: "http://n8n.local"};
  });

  afterEach(() => {
    process.env = {...envOriginal};
  });

  async function renderForm(espacio = "estudio-ana") {
    const {default: LeadForm} = await import("./lead-form");

    return render(<LeadForm espacio={espacio} />);
  }

  async function llenarValido(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText(/^Nombre/), "Juan Pérez");
    await user.type(screen.getByLabelText(/^Email/), "juan@test.com");
    await user.click(screen.getByLabelText(/^Desarrollo Web/));
    await user.click(screen.getByLabelText("US$ 1.000 – 2.000"));
    await user.type(screen.getByLabelText(/Contanos tu proyecto/), "x".repeat(25));
    await user.click(screen.getByLabelText(/He leído y acepto/));
  }

  it("no manda nada si faltan los campos requeridos", async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();

    await renderForm();
    await user.click(screen.getByRole("button", {name: /Enviar consulta/i}));

    expect(await screen.findByText(/al menos 2 caracteres/)).toBeInTheDocument();
    expect(screen.getByText(/formato válido/)).toBeInTheDocument();
    expect(screen.getByText(/Debés seleccionar un servicio/)).toBeInTheDocument();
    expect(screen.getByText(/Elegí un rango de presupuesto/)).toBeInTheDocument();
    expect(screen.getByText(/al menos 20 caracteres/)).toBeInTheDocument();
    expect(screen.getByText(/Debés aceptar la Política/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rechaza un email con formato inválido", async () => {
    vi.stubGlobal("fetch", vi.fn());

    const user = userEvent.setup();

    await renderForm();
    await user.type(screen.getByLabelText(/^Email/), "no-es-un-email");
    await user.click(screen.getByRole("button", {name: /Enviar consulta/i}));

    expect(await screen.findByText(/formato válido/)).toBeInTheDocument();
  });

  it("rechaza un nombre con un enlace", async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();

    await renderForm();
    await llenarValido(user);
    await user.clear(screen.getByLabelText(/^Nombre/));
    await user.type(screen.getByLabelText(/^Nombre/), "Visitá www.estafa.test");
    await user.click(screen.getByRole("button", {name: /Enviar consulta/i}));

    expect(await screen.findByText(/no puede incluir enlaces/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("envía el formulario con datos válidos y muestra la pantalla de éxito", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, {status: 200}));

    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();

    await renderForm();
    await llenarValido(user);
    await user.click(screen.getByRole("button", {name: /Enviar consulta/i}));

    expect(await screen.findByText("¡Gracias!")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://n8n.local/webhook/lead-nuevo",
      expect.objectContaining({method: "POST"}),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);

    expect(body.nombre).toBe("Juan Pérez");
    expect(body.email).toBe("juan@test.com");
    expect(body.servicio).toBe("Desarrollo Web");
    expect(body.fuente).toBe("formulario_web");
    expect(body.espacio).toBe("estudio-ana");
    // El rango, no un importe: n8n guarda el piso para el scoring.
    expect(body.presupuesto_rango).toBe("1000_2000");
    expect(body).not.toHaveProperty("presupuesto");
    expect(body.urgencia).toBe("media");
    // La casilla de la bolsa es opcional y arranca sin marcar (ley 25.326).
    expect(body.compartir_bolsa).toBe(false);
  });

  it("si el cliente marca la casilla de la bolsa, lo manda", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, {status: 200}));

    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();

    await renderForm();
    await llenarValido(user);
    await user.click(screen.getByLabelText(/compártanlo con otros desarrolladores/));
    await user.click(screen.getByRole("button", {name: /Enviar consulta/i}));

    expect(await screen.findByText("¡Gracias!")).toBeInTheDocument();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(init.body as string).compartir_bolsa).toBe(true);
  });

  it("si el campo trampa viene completo, muestra el éxito sin mandar nada", async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();

    const {container} = await renderForm();

    await llenarValido(user);
    // Una persona no lo ve ni llega con el tabulador; un bot lo completa.
    await user.type(container.querySelector<HTMLInputElement>("#sitio_web")!, "http://spam.test");
    await user.click(screen.getByRole("button", {name: /Enviar consulta/i}));

    expect(await screen.findByText("¡Gracias!")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("un doble click no manda dos peticiones (deuda S6 de la Tabla 11)", async () => {
    let resolverFetch: (v: Response) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolverFetch = resolve;
        }),
    );

    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();

    await renderForm();
    await llenarValido(user);

    const boton = screen.getByRole("button", {name: /Enviar consulta/i});

    await user.click(boton);
    await user.click(boton);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolverFetch(new Response(null, {status: 200}));
  });

  it("si el servidor responde con error, avisa y no pasa a la pantalla de éxito", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, {status: 500})));

    const user = userEvent.setup();

    await renderForm();
    await llenarValido(user);
    await user.click(screen.getByRole("button", {name: /Enviar consulta/i}));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Error del servidor/);
    expect(screen.queryByText("¡Gracias!")).not.toBeInTheDocument();
  });

  it("si falta NEXT_PUBLIC_N8N_BASE, avisa sin llegar a llamar a fetch", async () => {
    process.env.NEXT_PUBLIC_N8N_BASE = "";

    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();

    await renderForm();
    await llenarValido(user);
    await user.click(screen.getByRole("button", {name: /Enviar consulta/i}));

    expect(await screen.findByText(/Falta la variable/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
