import type {ReactNode} from "react";

// Título de cada página del panel. `acciones`: enlaces o botones a la derecha.
export default function EncabezadoPagina({
  titulo,
  bajada,
  acciones,
}: {
  titulo: string;
  bajada?: string;
  acciones?: ReactNode;
}) {
  return (
    <div className="border-rule mb-10 flex flex-wrap items-end justify-between gap-5 border-b pb-7">
      <div>
        <h1 className="text-ink font-serif text-[clamp(2.2rem,5vw,3rem)] leading-none tracking-tight">
          {titulo}
          <span className="text-ochre">.</span>
        </h1>
        {bajada && <p className="text-muted mt-3 text-[14px]">{bajada}</p>}
      </div>
      {acciones}
    </div>
  );
}
