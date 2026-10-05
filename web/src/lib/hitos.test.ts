import {describe, expect, it} from "vitest";

import {
  comisionDe,
  hitosParaEnviar,
  leerMonto,
  problemaHitos,
  repartoDisputa,
  totalHitos,
  usd,
} from "./hitos";

describe("leerMonto", () => {
  it("acepta enteros, punto y coma decimal", () => {
    expect(leerMonto("300")).toBe(300);
    expect(leerMonto(" 500.5 ")).toBe(500.5);
    expect(leerMonto("1500,75")).toBe(1500.75);
  });

  it("rechaza lo que la base no acepta", () => {
    expect(leerMonto("")).toBeNull();
    expect(leerMonto("0.99")).toBeNull();
    expect(leerMonto("10.555")).toBeNull();
    expect(leerMonto("-5")).toBeNull();
    expect(leerMonto("1e3")).toBeNull();
    expect(leerMonto("1.000,50")).toBeNull();
  });
});

describe("totalHitos", () => {
  it("ignora los montos inválidos y suma sin errores de coma flotante", () => {
    expect(
      totalHitos([
        {titulo: "a", monto: "0.1"},
        {titulo: "b", monto: "1.2"},
      ]),
    ).toBe(1.2);
    expect(
      totalHitos([
        {titulo: "Diseño", monto: "300.10"},
        {titulo: "Desarrollo", monto: "500,20"},
      ]),
    ).toBe(800.3);
  });
});

describe("problemaHitos", () => {
  const bien = {titulo: "Diseño", monto: "300"};

  it("sin problemas, null", () => {
    expect(problemaHitos([bien, {titulo: "Desarrollo", monto: "700"}])).toBeNull();
  });

  it("pide al menos uno y no más de 10", () => {
    expect(problemaHitos([])).toMatch(/al menos un hito/);
    expect(problemaHitos(Array.from({length: 11}, () => bien))).toMatch(/Hasta 10/);
  });

  it("señala el hito con el problema", () => {
    expect(problemaHitos([bien, {titulo: "ab", monto: "10"}])).toMatch(/hito 2 .*título/);
    expect(problemaHitos([bien, {titulo: "Publicación", monto: "0"}])).toMatch(/monto del hito 2/);
  });
});

describe("hitosParaEnviar", () => {
  it("recorta los títulos y convierte los montos", () => {
    expect(hitosParaEnviar([{titulo: "  Diseño ", monto: "1,5"}])).toEqual([
      {titulo: "Diseño", monto: 1.5},
    ]);
  });
});

describe("usd", () => {
  it("sin centavos no muestra decimales; con centavos, siempre dos", () => {
    expect(usd(1000)).toMatch(/^US\$\s?1\.000$/);
    expect(usd(500.5)).toMatch(/^US\$\s?500,50$/);
  });
});

describe("repartoDisputa", () => {
  it("liberar y reembolsar reparten el monto entero", () => {
    expect(repartoDisputa("liberar", "", 500.5)).toEqual({
      liberar: 500.5,
      reembolsar: 0,
    });
    expect(repartoDisputa("reembolsar", "", 500.5)).toEqual({
      liberar: 0,
      reembolsar: 500.5,
    });
  });

  it("partir acepta la coma decimal y cuenta en centavos", () => {
    expect(repartoDisputa("partir", "250,25", 500.5)).toEqual({
      liberar: 250.25,
      reembolsar: 250.25,
    });
    expect(repartoDisputa("partir", "0.1", 0.3)).toEqual({
      liberar: 0.1,
      reembolsar: 0.2,
    });
  });

  it("partir acepta los bordes válidos: un centavo de cada lado", () => {
    expect(repartoDisputa("partir", "0,01", 500.5)).toEqual({
      liberar: 0.01,
      reembolsar: 500.49,
    });
    expect(repartoDisputa("partir", "500,49", 500.5)).toEqual({
      liberar: 500.49,
      reembolsar: 0.01,
    });
  });

  it("partir ignora los espacios alrededor", () => {
    expect(repartoDisputa("partir", " 250 ", 500.5)).toEqual({
      liberar: 250,
      reembolsar: 250.5,
    });
  });

  it("partir no acepta negativos ni separador de miles", () => {
    expect(repartoDisputa("partir", "-5", 500.5)).toBeNull();
    expect(repartoDisputa("partir", "1.000,50", 2000)).toBeNull();
  });

  it("partir necesita más de 0 y menos que el total, con hasta dos decimales", () => {
    expect(repartoDisputa("partir", "0", 500.5)).toBeNull();
    expect(repartoDisputa("partir", "500,50", 500.5)).toBeNull();
    expect(repartoDisputa("partir", "600", 500.5)).toBeNull();
    expect(repartoDisputa("partir", "10.555", 500.5)).toBeNull();
    expect(repartoDisputa("partir", "", 500.5)).toBeNull();
  });
});

describe("comisionDe", () => {
  it("redondea a centavos, como hito_cerrar()", () => {
    expect(comisionDe(200, 5)).toBe(10);
    expect(comisionDe(0.1, 5)).toBe(0.01);
    expect(comisionDe(500.5, 5)).toBe(25.03);
  });
});
