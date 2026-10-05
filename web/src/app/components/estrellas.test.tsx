import {render, screen} from "@testing-library/react";
import {describe, expect, it} from "vitest";

import Estrellas, {Reputacion} from "./estrellas";

describe("Estrellas", () => {
  it("se lee como «N de 5 estrellas»", () => {
    render(<Estrellas promedio={4.5} />);

    expect(screen.getByRole("img", {name: "4,5 de 5 estrellas"})).toBeInTheDocument();
  });

  it("la reputación muestra el promedio y la cantidad", () => {
    render(<Reputacion cantidad={12} promedio={4.3} />);

    expect(screen.getByRole("img", {name: "4,3 de 5 estrellas"})).toBeInTheDocument();
    expect(screen.getByText("(12)")).toBeInTheDocument();
  });

  it("sin calificaciones no inventa estrellas", () => {
    render(<Reputacion cantidad={0} promedio={null} />);

    expect(screen.getByText("Sin calificaciones todavía")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
