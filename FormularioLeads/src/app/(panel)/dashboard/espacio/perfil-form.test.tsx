import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach, describe, expect, it, vi} from "vitest";

const update = vi.fn();

vi.mock("next/navigation", () => ({useRouter: () => ({refresh: vi.fn()})}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      update: (datos: unknown) => (
        update(datos),
        {
          eq: () => ({
            select: async () => ({data: [{id: "e1"}], error: null}),
          }),
        }
      ),
    }),
  }),
}));

const {default: PerfilForm} = await import("./perfil-form");

const ESPACIO = {
  id: "e1",
  slug: "lucia",
  presentacion: null,
  habilidades: [],
  portfolio_urls: [],
};

describe("PerfilForm", () => {
  beforeEach(() => update.mockReset());

  it("guarda las habilidades limpias y sin repetir, y sólo los enlaces cargados", async () => {
    const user = userEvent.setup();

    render(<PerfilForm espacio={ESPACIO} />);
    await user.type(screen.getByLabelText("Habilidades"), "React, Next.js, react,  , Diseño UX");
    await user.type(screen.getByLabelText("Enlace 2 del portfolio"), "https://lucia.dev");
    await user.click(screen.getByRole("button", {name: "Guardar perfil"}));

    expect(update).toHaveBeenCalledWith({
      presentacion: null,
      habilidades: ["React", "Next.js", "Diseño UX"],
      portfolio_urls: ["https://lucia.dev"],
    });
    expect(await screen.findByText("Guardamos tu perfil.")).toBeInTheDocument();
  });

  it("no deja guardar un enlace que no es http(s)", async () => {
    const user = userEvent.setup();

    render(<PerfilForm espacio={ESPACIO} />);
    await user.type(screen.getByLabelText("Enlace 1 del portfolio"), "javascript:alert(1)");

    expect(screen.getByRole("alert")).toHaveTextContent("tienen que empezar con http://");
    expect(screen.getByRole("button", {name: "Guardar perfil"})).toBeDisabled();
  });
});
