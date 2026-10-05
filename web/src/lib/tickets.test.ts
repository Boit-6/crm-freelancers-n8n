import {describe, expect, it} from "vitest";

describe("aTicket", () => {
  const fila = {
    id: "0f0e0d0c-0b0a-4090-8080-707060605050",
    espacio_id: "e5e5e5e5-0000-4000-8000-000000000001",
    titulo: "Kickoff con Cliente",
    estado: "EN_CURSO" as const,
    prioridad: "ALTA" as const,
    prioridad_inicial: "MEDIA" as const,
    etiquetas: ["proyecto"],
    origen: "CRM",
    lead_id: "LD-1",
    notas: null,
    vence: "2026-10-01",
    escaladas: 1,
    ultimo_movimiento: "2026-09-20T10:00:00Z",
    cerrado_en: null,
    creado_en: "2026-09-10T10:00:00Z",
    cliente: "Cliente",
    dias_abierto: 13,
    dias_quieto: 3,
    score: 76,
    dias_para_escalar: 1,
  };

  it("aplana la fila de tickets_tablero al formato del tablero", async () => {
    const {aTicket} = await import("./tickets");

    expect(aTicket(fila)).toMatchObject({
      ticket_id: fila.id,
      estado: "EN_CURSO",
      prioridad: "ALTA",
      prioridad_inicial: "MEDIA",
      cliente: "Cliente",
      notas: "",
      score: 76,
      dias_para_escalar: 1,
    });
  });

  it("descarta la fila sin id o con un estado desconocido", async () => {
    const {aTicket} = await import("./tickets");

    expect(aTicket({...fila, id: null})).toBeNull();
    expect(aTicket({...fila, estado: null})).toBeNull();
  });

  it("esEstado / esPrioridad sólo aceptan los valores de la escala", async () => {
    const {esEstado, esPrioridad} = await import("./tickets");

    expect(esEstado("HECHO")).toBe(true);
    expect(esEstado("hecho")).toBe(false);
    expect(esPrioridad("CRITICA")).toBe(true);
    expect(esPrioridad("URGENTE")).toBe(false);
  });
});
