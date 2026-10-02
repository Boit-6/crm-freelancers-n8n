import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach, describe, expect, it, vi} from "vitest";

const rpc = vi.fn();

vi.mock("@/lib/supabase/client", () => ({createClient: () => ({rpc})}));

const {default: CalificarForm} = await import("./calificar-form");

const TOKEN = "11111111-2222-4333-8444-555555555555";
const PENDIENTE = {
  espacio_nombre: "Lucía Estudio",
  cliente_nombre: "Ana",
  ya_calificado: false,
};

describe("CalificarForm", () => {
  beforeEach(() => rpc.mockReset());

  it("califica con estrellas y comentario", async () => {
    rpc.mockResolvedValue({data: "Lucía Estudio", error: null});

    const user = userEvent.setup();

    render(<CalificarForm pendiente={PENDIENTE} token={TOKEN} />);

    expect(screen.getByRole("button", {name: "Enviar calificación"})).toBeDisabled();
    await user.click(screen.getByLabelText("4 estrellas: Muy bien"));
    await user.type(screen.getByLabelText("Comentario (opcional)"), "Muy prolija y rápida.");
    await user.click(screen.getByRole("button", {name: "Enviar calificación"}));

    expect(rpc).toHaveBeenCalledWith("calificar", {
      p_token: TOKEN,
      p_estrellas: 4,
      p_comentario: "Muy prolija y rápida.",
    });
    expect(await screen.findByText("¡Gracias!")).toBeInTheDocument();
  });

  it("si la base lo rechaza, muestra su mensaje", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {message: "Ya calificaste este proyecto"},
    });

    const user = userEvent.setup();

    render(<CalificarForm pendiente={PENDIENTE} token={TOKEN} />);
    await user.click(screen.getByLabelText("5 estrellas: Excelente"));
    await user.click(screen.getByRole("button", {name: "Enviar calificación"}));

    expect(await screen.findByRole("alert")).toHaveTextContent("Ya calificaste este proyecto");
  });

  it("con un enlace inválido o ya calificado, no muestra el formulario", () => {
    const {rerender} = render(<CalificarForm pendiente={null} token="x" />);

    expect(screen.getByText("Este enlace no funciona.")).toBeInTheDocument();
    rerender(<CalificarForm pendiente={{...PENDIENTE, ya_calificado: true}} token={TOKEN} />);
    expect(screen.getByText("Ya calificaste este proyecto.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
