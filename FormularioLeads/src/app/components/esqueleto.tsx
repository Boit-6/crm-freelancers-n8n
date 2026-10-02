import type {ReactNode} from "react";

// Bloque gris que ocupa el lugar de un dato mientras carga. El tamaño lo da
// quien lo usa (h-*, w-*), para que la pantalla no salte cuando llega el dato.
// Titila sólo si el sistema no pide reducir el movimiento.
export function Esqueleto({className = ""}: {className?: string}) {
  return (
    <span
      aria-hidden="true"
      className={`bg-rule-soft block motion-safe:animate-pulse ${className}`}
    />
  );
}

// Contenedor de una pantalla o sección en carga: los lectores de pantalla
// escuchan «Cargando…» (o `etiqueta`) una vez, en vez de una lista de bloques
// vacíos.
export function Cargando({
  children,
  etiqueta = "Cargando…",
  className = "",
}: {
  children: ReactNode;
  etiqueta?: string;
  className?: string;
}) {
  return (
    <div aria-busy="true" className={className} role="status">
      <span className="sr-only">{etiqueta}</span>
      {children}
    </div>
  );
}
