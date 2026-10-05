import {describe, expect, it, vi} from "vitest";

import {cargarPanel} from "./panel-loader";

function clientConFallo(tablaFallida: string) {
  const from = vi.fn((tabla: string) => {
    const respuesta =
      tabla === tablaFallida
        ? {data: null, error: new Error("Fallo controlado")}
        : {data: [], error: null};
    const consulta: Record<string, unknown> = {};

    for (const metodo of ["select", "order", "limit", "eq", "in", "not"]) {
      consulta[metodo] = () => consulta;
    }
    consulta.then = (resolver: (valor: typeof respuesta) => void) =>
      Promise.resolve(respuesta).then(resolver);

    return consulta;
  });

  return {from} as unknown as Parameters<typeof cargarPanel>[0];
}

describe("cargarPanel", () => {
  it("conserva las secciones válidas si falla la consulta de métricas", async () => {
    const {datos, errores} = await cargarPanel(clientConFallo("metrics_mensuales"));

    expect(datos.metrics).toBeUndefined();
    expect(datos.leads).toEqual([]);
    expect(datos.facturas).toEqual([]);
    expect(errores).toEqual(["metrics: Fallo controlado"]);
  });

  it("no publica facturas incompletas si falla una de sus dos fuentes", async () => {
    const {datos, errores} = await cargarPanel(clientConFallo("facturas"));

    expect(datos.facturas).toBeUndefined();
    expect(datos.trabajos).toEqual([]);
    expect(errores).toEqual(["facturas: Fallo controlado"]);
  });
});
