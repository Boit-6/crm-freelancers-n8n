import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach, describe, expect, it, vi} from "vitest";

const rpc = vi.fn();
const signInWithOtp = vi.fn();
const push = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({rpc, auth: {signInWithOtp}}),
}));
vi.mock("next/navigation", () => ({useRouter: () => ({push})}));

const {default: PublicarForm} = await import("./publicar-form");

const BORRADOR = "formularioleads:borrador-proyecto";

async function completar(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^Título/), "Tienda online para mi marca");
  await user.type(
    screen.getByLabelText(/^¿Qué necesitás\?/),
    "Catálogo de 200 productos, carrito y pagos con tarjeta.",
  );
  await user.click(screen.getByLabelText("Tienda online"));
  await user.click(screen.getByLabelText("US$ 2.000 – 5.000"));
  await user.type(screen.getByLabelText(/^Tu nombre/), "Marta Gómez");
  await user.click(screen.getByLabelText(/Acepto que el proyecto se publique/));
}

describe("PublicarForm", () => {
  beforeEach(() => {
    rpc.mockReset();
    signInWithOtp.mockReset();
    push.mockReset();
    localStorage.clear();
  });

  it("con sesión de cliente, publica con publicar_proyecto() y va a «Mis proyectos»", async () => {
    rpc.mockResolvedValue({data: "id-nuevo", error: null});

    const user = userEvent.setup();

    render(<PublicarForm tipo="cliente" />);
    await completar(user);
    await user.click(screen.getByRole("button", {name: "Publicar proyecto"}));

    expect(rpc).toHaveBeenCalledWith("publicar_proyecto", {
      p_titulo: "Tienda online para mi marca",
      p_descripcion: "Catálogo de 200 productos, carrito y pagos con tarjeta.",
      p_servicio: "ecommerce",
      p_urgencia: "media",
      p_presupuesto_rango: "2000_5000",
      p_nombre: "Marta Gómez",
      p_telefono: null,
      p_etiquetas: [],
    });
    expect(push).toHaveBeenCalledWith("/cliente?publicado=1");
  });

  it("sin sesión, guarda el borrador y manda el enlace mágico que vuelve a /publicar", async () => {
    signInWithOtp.mockResolvedValue({error: null});

    const user = userEvent.setup();

    render(<PublicarForm tipo={null} />);
    await completar(user);
    await user.type(screen.getByLabelText(/^Tu correo/), "marta@gmail.com");
    await user.click(screen.getByRole("button", {name: "Continuar con mi correo"}));

    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "marta@gmail.com",
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm?next=/publicar`,
        data: {tipo: "cliente"},
      },
    });
    expect(JSON.parse(localStorage.getItem(BORRADOR)!).titulo).toBe("Tienda online para mi marca");
    expect(await screen.findByText("Revisá tu correo.")).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("al volver del enlace, recupera el borrador listo para publicar", async () => {
    localStorage.setItem(
      BORRADOR,
      JSON.stringify({
        titulo: "Tienda online para mi marca",
        nombre: "Marta Gómez",
      }),
    );

    render(<PublicarForm tipo="cliente" />);

    expect(
      await screen.findByText("Ya entraste. Revisá tu proyecto y publicalo."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Título/)).toHaveValue("Tienda online para mi marca");
    expect(screen.getByLabelText(/^Tu nombre/)).toHaveValue("Marta Gómez");
  });

  it("descarta un borrador de formato incompatible sin romper el formulario", async () => {
    localStorage.setItem(BORRADOR, JSON.stringify({titulo: "Proyecto viejo", etiquetas: null}));

    render(<PublicarForm tipo="cliente" />);

    expect(screen.getByLabelText(/^Título/)).toHaveValue("");
    expect(screen.getByLabelText(/^Habilidades que buscás/)).toHaveValue("");
    expect(
      screen.queryByText("Ya entraste. Revisá tu proyecto y publicalo."),
    ).not.toBeInTheDocument();
  });

  it("no recupera opciones inválidas guardadas por otra versión", () => {
    localStorage.setItem(BORRADOR, JSON.stringify({servicio: "servicio_antiguo"}));

    render(<PublicarForm tipo="cliente" />);

    expect(screen.getByLabelText(/^Título/)).toHaveValue("");
    expect(
      screen.queryByText("Ya entraste. Revisá tu proyecto y publicalo."),
    ).not.toBeInTheDocument();
  });

  it("no publica sin la aceptación ni con campos faltantes", async () => {
    const user = userEvent.setup();

    render(<PublicarForm tipo="cliente" />);
    await user.click(screen.getByRole("button", {name: "Publicar proyecto"}));

    expect(screen.getByText(/al menos 5 caracteres/)).toBeInTheDocument();
    expect(screen.getByText("Elegí qué tipo de trabajo es.")).toBeInTheDocument();
    expect(screen.getByText(/Necesitamos tu aceptación/)).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("si la base lo rechaza (por ejemplo, 5 abiertos), muestra su mensaje", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Ya tenés 5 proyectos abiertos: elegí o esperá a que cierre alguno",
      },
    });

    const user = userEvent.setup();

    render(<PublicarForm tipo="cliente" />);
    await completar(user);
    await user.click(screen.getByRole("button", {name: "Publicar proyecto"}));

    expect(await screen.findByRole("alert")).toHaveTextContent("Ya tenés 5 proyectos abiertos");
    expect(push).not.toHaveBeenCalled();
  });

  it("con una cuenta de desarrollador, explica que hace falta una de cliente", () => {
    render(<PublicarForm tipo="desarrollador" />);

    expect(screen.getByText("Tu cuenta es de desarrollador.")).toBeInTheDocument();
    expect(screen.queryByRole("button", {name: /Publicar/})).not.toBeInTheDocument();
  });
});
