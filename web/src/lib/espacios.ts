// Reglas de la dirección pública de un espacio (/f/<slug>). Las mismas que el
// CHECK de `espacios.slug` en db/schema.sql: acá sólo sirven para avisar antes
// de mandar; la que manda es la base.

export const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export const NOMBRE_MAX = 80;

// El slug que la base le pone a un espacio recién creado ("e-" + el id de la
// cuenta). Sirve, pero nadie lo recordaría: el alta propone uno a partir del
// nombre.
export function esSlugProvisorio(slug: string) {
  return /^e-[0-9a-f]{32}$/.test(slug);
}

// "Estudio Ñandú & Cía." -> "estudio-nandu-cia"
export function slugDesde(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

export function errorDeSlug(slug: string): string | null {
  if (slug.length < 3) return "La dirección tiene que tener al menos 3 caracteres.";
  if (slug.length > 40) return "La dirección admite hasta 40 caracteres.";
  if (!SLUG_REGEX.test(slug)) {
    return "Usá sólo minúsculas, números y guiones, sin guion al principio ni al final.";
  }

  return null;
}

export function errorDeNombre(nombre: string): string | null {
  const limpio = nombre.trim();

  if (!limpio) return "Poné el nombre con el que te van a ver tus clientes.";
  if (limpio.length > NOMBRE_MAX) return `El nombre admite hasta ${NOMBRE_MAX} caracteres.`;

  return null;
}

const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function errorDeEmail(email: string): string | null {
  if (!EMAIL_REGEX.test(email.trim())) return "El correo no tiene un formato válido.";

  return null;
}

// Errores de Postgres que puede devolver el UPDATE del alta.
export function mensajeDeErrorDb(codigo: string | undefined): string {
  if (codigo === "23505") return "Esa dirección ya la usa otro espacio. Probá con otra.";
  if (codigo === "23514") return "La dirección, el nombre o el correo no tienen un formato válido.";

  return "No se pudo guardar. Probá de nuevo en un rato.";
}
