import {render, screen} from "@testing-library/react";
import {describe, expect, it} from "vitest";

import {Cargando, Esqueleto} from "./esqueleto";

describe("Esqueleto", () => {
  it("un lector de pantalla escucha la etiqueta una vez, no los bloques vacíos", () => {
    const {container} = render(
      <Cargando etiqueta="Cargando los leads…">
        <Esqueleto className="h-4 w-20" />
        <Esqueleto className="h-4 w-32" />
      </Cargando>,
    );

    const estado = screen.getByRole("status");

    expect(estado).toHaveAttribute("aria-busy", "true");
    expect(estado).toHaveTextContent("Cargando los leads…");
    for (const bloque of container.querySelectorAll("span[aria-hidden]")) {
      expect(bloque).toHaveClass("motion-safe:animate-pulse");
    }
  });
});
