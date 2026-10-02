// Rangos de presupuesto del formulario. Los cortes son los del scoring
// (SCORING_PRESUPUESTO: 300/1000/2000/5000), así que elegir un rango define
// el puntaje sin ambigüedad. n8n guarda el rango en `leads.presupuesto_rango`
// y el piso en `leads.presupuesto` (Code - Normalizar Lead tiene la misma
// tabla: si cambia una, cambia la otra).
export const RANGOS_PRESUPUESTO = [
  {clave: "hasta_300", etiqueta: "Menos de US$ 300"},
  {clave: "300_1000", etiqueta: "US$ 300 – 1.000"},
  {clave: "1000_2000", etiqueta: "US$ 1.000 – 2.000"},
  {clave: "2000_5000", etiqueta: "US$ 2.000 – 5.000"},
  {clave: "mas_5000", etiqueta: "Más de US$ 5.000"},
] as const;

export type RangoPresupuesto = (typeof RANGOS_PRESUPUESTO)[number]["clave"];

const formatoUsd = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

// Lo que declaró el cliente: el rango si lo eligió en el formulario, o el
// importe suelto en los leads anteriores a los rangos o llegados por otra vía.
export function presupuestoDeclarado(rango: string | null | undefined, importe: number): string {
  const encontrado = RANGOS_PRESUPUESTO.find((r) => r.clave === rango);

  return encontrado ? encontrado.etiqueta : formatoUsd.format(importe);
}
