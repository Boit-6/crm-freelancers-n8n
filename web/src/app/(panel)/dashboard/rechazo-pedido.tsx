"use client";

import {useState} from "react";

import {ghostButtonClass} from "@/lib/constants";

type Destino = "bolsa" | "descartar";

const RESUMEN_MIN = 20;
const RESUMEN_MAX = 2000;

// «No puedo tomarlo»: el desarrollador rechaza el pedido y elige qué pasa con
// él. A la bolsa sólo si el cliente marcó la casilla del formulario; el
// resumen es lo único en texto libre que ven los demás, así que arranca con la
// descripción del cliente para que le saque los datos personales.
export default function RechazoPedido({
  compartirBolsa,
  descripcion,
  onRechazar,
}: {
  compartirBolsa: boolean;
  descripcion: string;
  onRechazar: (destino: Destino, resumen: string) => Promise<void>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [destino, setDestino] = useState<Destino>(compartirBolsa ? "bolsa" : "descartar");
  const [resumen, setResumen] = useState(descripcion.slice(0, RESUMEN_MAX));
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const largo = resumen.trim().length;
  const valido = destino === "descartar" || (largo >= RESUMEN_MIN && largo <= RESUMEN_MAX);

  if (!abierto) {
    return (
      <div className="border-rule-soft border-t pt-6">
        <button className={ghostButtonClass} type="button" onClick={() => setAbierto(true)}>
          No puedo tomarlo
        </button>
      </div>
    );
  }

  const opcionClass = (activa: boolean) =>
    `grid cursor-pointer grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 border px-4 py-3 text-[13.5px] transition duration-200 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ochre ${
      activa ? "border-ochre bg-ochre/5 text-ink" : "border-rule text-ink-soft hover:border-mist"
    }`;

  return (
    <section className="border-rule-soft bg-card flex flex-col gap-4 border px-5 py-5">
      <h3 className="text-ink font-serif text-[20px]">¿Qué hacemos con el pedido?</h3>

      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Destino del pedido</legend>
        <label className={opcionClass(destino === "bolsa")}>
          <input
            checked={destino === "bolsa"}
            className="accent-ochre row-span-2 mt-1"
            disabled={!compartirBolsa}
            name="destino"
            type="radio"
            onChange={() => setDestino("bolsa")}
          />
          Mandarlo a la bolsa
          <span className="text-muted col-start-2 text-[12.5px]">
            {compartirBolsa
              ? "Otros desarrolladores lo ven sin los datos del cliente y se postulan."
              : "El cliente no autorizó compartirlo, así que no puede ir a la bolsa."}
          </span>
        </label>
        <label className={opcionClass(destino === "descartar")}>
          <input
            checked={destino === "descartar"}
            className="accent-ochre row-span-2 mt-1"
            name="destino"
            type="radio"
            onChange={() => setDestino("descartar")}
          />
          Descartarlo
          <span className="text-muted col-start-2 text-[12.5px]">
            Le avisamos al cliente que esta vez no podés tomarlo.
          </span>
        </label>
      </fieldset>

      {destino === "bolsa" && (
        <label className="flex flex-col gap-1.5">
          <span className="text-faint text-[10px] tracking-[0.16em] uppercase">
            Resumen para la bolsa
          </span>
          <textarea
            className="ease border-rule bg-paper text-ink focus:border-ochre w-full resize-y border px-3 py-2.5 text-[14px] leading-relaxed transition duration-200 outline-none"
            maxLength={RESUMEN_MAX}
            rows={5}
            value={resumen}
            onChange={(e) => setResumen(e.target.value)}
          />
          <span className="text-muted text-[12px] leading-relaxed">
            Sacale nombres, teléfonos, correos o direcciones: es lo único que ven los demás.{" "}
            <span className={largo >= RESUMEN_MIN ? "text-moss" : "text-brick"}>
              {largo} / {RESUMEN_MIN} mín.
            </span>
          </span>
        </label>
      )}

      {error && (
        <p className="text-brick text-[13px]" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          className="ease bg-ink text-paper hover:bg-ochre px-5 py-3 text-[11px] tracking-[0.14em] uppercase transition duration-200 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!valido || enviando}
          type="button"
          onClick={async () => {
            setEnviando(true);
            setError(null);
            try {
              await onRechazar(destino, resumen.trim());
            } catch (err) {
              setError(err instanceof Error ? err.message : "No se pudo rechazar el pedido.");
            } finally {
              setEnviando(false);
            }
          }}
        >
          {enviando ? "Enviando…" : destino === "bolsa" ? "Mandar a la bolsa" : "Descartar"}
        </button>
        <button className={ghostButtonClass} type="button" onClick={() => setAbierto(false)}>
          Volver
        </button>
      </div>
    </section>
  );
}
