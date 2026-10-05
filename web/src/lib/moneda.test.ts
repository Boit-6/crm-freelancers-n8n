import {describe, expect, it} from "vitest";

import {leerCentavos, leerImporte, MAX_CENTAVOS_NUMERIC_12_2} from "./moneda";

describe("leerImporte", () => {
  it("acepta centavos exactos con punto o coma y el máximo de NUMERIC(12,2)", () => {
    expect(leerImporte("0.01")).toBe(0.01);
    expect(leerImporte(" 1500,50 ")).toBe(1500.5);
    expect(leerImporte("9999999999.99")).toBe(9_999_999_999.99);
    expect(leerCentavos("9999999999,99")).toBe(MAX_CENTAVOS_NUMERIC_12_2);
  });

  it.each([
    "",
    "0",
    "0.001",
    "0.006",
    "-1",
    "NaN",
    "Infinity",
    "1e3",
    "1.000,50",
    "9999999999.999",
    "10000000000",
    "9999999999.999999",
  ])("rechaza %s sin redondear ni interpretar formatos ambiguos", (texto) => {
    expect(leerImporte(texto)).toBeNull();
  });

  it("conserva el mínimo y tope de dígitos de hitos y disputas", () => {
    expect(leerCentavos("0", {minimo: 0, maxDigitosEnteros: 9})).toBe(0);
    expect(leerCentavos("0,99", {minimo: 100, maxDigitosEnteros: 9})).toBeNull();
    expect(leerCentavos("1", {minimo: 100, maxDigitosEnteros: 9})).toBe(100);
    expect(leerCentavos("999999999,99", {minimo: 100, maxDigitosEnteros: 9})).toBe(99_999_999_999);
    expect(leerCentavos("1000000000", {minimo: 100, maxDigitosEnteros: 9})).toBeNull();
  });
});
