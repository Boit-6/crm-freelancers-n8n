// Importes ingresados por personas que terminan en columnas NUMERIC(12,2).
// Se parsean como centavos enteros: Number() aceptaría notación científica y
// fracciones de centavo que la base redondearía silenciosamente.
export const MAX_CENTAVOS_NUMERIC_12_2 = 999_999_999_999;

export function leerCentavos(
  texto: string,
  {minimo = 1, maxDigitosEnteros = 10}: {minimo?: number; maxDigitosEnteros?: number} = {},
): number | null {
  const normalizado = texto.trim().replace(",", ".");

  if (!new RegExp(`^\\d{1,${maxDigitosEnteros}}(\\.\\d{1,2})?$`).test(normalizado)) return null;

  const [enteros, decimales = ""] = normalizado.split(".");
  // Con hasta diez dígitos enteros el resultado queda bajo Number.MAX_SAFE_INTEGER.
  const centavos = Number(enteros) * 100 + Number(decimales.padEnd(2, "0"));

  return centavos >= minimo && centavos <= MAX_CENTAVOS_NUMERIC_12_2 ? centavos : null;
}

// Propuesta única y postulación: la base exige un importe positivo, no US$ 1.
export function leerImporte(texto: string): number | null {
  const centavos = leerCentavos(texto);

  return centavos === null ? null : centavos / 100;
}
