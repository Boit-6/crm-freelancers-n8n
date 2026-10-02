import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach, describe, expect, it, vi} from "vitest";

const signInWithOtp = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({auth: {signInWithOtp}}),
}));

const {default: EntrarClienteForm} = await import("./entrar-form");

describe("EntrarClienteForm", () => {
  beforeEach(() => {
    signInWithOtp.mockReset();
  });

  it("pide el enlace mágico como cuenta de cliente y vuelve a /cliente", async () => {
    signInWithOtp.mockResolvedValue({error: null});

    const user = userEvent.setup();

    render(<EntrarClienteForm />);
    await user.type(screen.getByRole("textbox", {name: "Tu correo"}), "marta@gmail.com");
    await user.click(screen.getByRole("button", {name: "Mandame el enlace"}));

    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "marta@gmail.com",
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm?next=/cliente`,
        // La base marca la cuenta como cliente y no le crea espacio.
        data: {tipo: "cliente"},
      },
    });
    expect(await screen.findByText("Revisá tu correo.")).toBeInTheDocument();
  });

  it("no manda nada con un correo sin formato válido", async () => {
    const user = userEvent.setup();

    render(<EntrarClienteForm />);
    await user.type(screen.getByRole("textbox", {name: "Tu correo"}), "no-es-un-correo");

    expect(screen.getByRole("button", {name: "Mandame el enlace"})).toBeDisabled();
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("si Supabase falla, avisa sin pasar a «revisá tu correo»", async () => {
    signInWithOtp.mockResolvedValue({error: new Error("rate limit")});

    const user = userEvent.setup();

    render(<EntrarClienteForm />);
    await user.type(screen.getByRole("textbox", {name: "Tu correo"}), "marta@gmail.com");
    await user.click(screen.getByRole("button", {name: "Mandame el enlace"}));

    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos mandar el enlace");
    expect(screen.queryByText("Revisá tu correo.")).not.toBeInTheDocument();
  });
});
