// Estrellas de reputación, del 0 al 5, rellenas en proporción al promedio
// (4,5 = cuatro y media). Los lectores de pantalla escuchan el número.
const RUTA = "M12 2.8l2.8 5.7 6.3.9-4.6 4.4 1.1 6.2L12 17l-5.6 3 1.1-6.2L2.9 9.4l6.3-.9z";

function Estrella({relleno, tamano}: {relleno: number; tamano: number}) {
  const id = `e-${Math.round(relleno * 100)}`;

  return (
    <svg aria-hidden="true" height={tamano} viewBox="0 0 24 24" width={tamano}>
      <defs>
        <linearGradient id={id}>
          <stop offset={`${relleno * 100}%`} stopColor="currentColor" />
          <stop offset={`${relleno * 100}%`} stopColor="transparent" />
        </linearGradient>
      </defs>
      <path d={RUTA} fill={`url(#${id})`} stroke="currentColor" strokeWidth={1.2} />
    </svg>
  );
}

export function textoEstrellas(promedio: number) {
  return `${promedio.toLocaleString("es-AR", {maximumFractionDigits: 1})} de 5 estrellas`;
}

export default function Estrellas({
  promedio,
  tamano = 16,
  className = "",
}: {
  promedio: number;
  tamano?: number;
  className?: string;
}) {
  return (
    <span
      aria-label={textoEstrellas(promedio)}
      className={`text-ochre inline-flex items-center gap-0.5 ${className}`}
      role="img"
    >
      {Array.from({length: 5}, (_, i) => (
        <Estrella key={i} relleno={Math.max(0, Math.min(1, promedio - i))} tamano={tamano} />
      ))}
    </span>
  );
}

// Promedio y cantidad, o «Sin calificaciones todavía» para los nuevos.
export function Reputacion({
  promedio,
  cantidad,
  className = "",
}: {
  promedio: number | null;
  cantidad: number;
  className?: string;
}) {
  if (!cantidad || promedio == null) {
    return (
      <span className={`text-mist text-[12.5px] ${className}`}>Sin calificaciones todavía</span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Estrellas promedio={promedio} />
      <span className="text-ink-soft text-[13px]">
        {promedio.toLocaleString("es-AR", {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })}{" "}
        <span className="text-mist">({cantidad})</span>
      </span>
    </span>
  );
}
