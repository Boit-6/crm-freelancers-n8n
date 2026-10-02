"use client";

import {useState} from "react";

import {ghostButtonClass} from "@/lib/constants";
import {leerImporte} from "@/lib/moneda";

const MENSAJE_MIN = 10;
const MENSAJE_MAX = 1000;

// Postulación a un pedido de la bolsa: lo que el cliente va a ver para
// elegir (mensaje, precio estimado y plazo). Las reglas (abierto, sin vencer,
// no propio, una por espacio, tope) las valida postularme() en la base.
export default function FormPostulacion({
  onEnviar,
  onCancelar,
}: {
  onEnviar: (mensaje: string, precio: number, plazo: string) => Promise<void>;
  onCancelar: () => void;
}) {
  const [mensaje, setMensaje] = useState("");
  const [precio, setPrecio] = useState("");
  const [plazo, setPlazo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const importe = leerImporte(precio);
  const largo = mensaje.trim().length;
  const valido =
    largo >= MENSAJE_MIN && largo <= MENSAJE_MAX && importe !== null && plazo.trim().length > 0;

  const campoClass =
    "ease border-rule bg-paper text-ink placeholder-mist focus:border-ochre w-full border px-3 py-2.5 text-[14px] transition duration-200 outline-none";
  const etiquetaClass = "text-faint mb-1.5 block text-[10px] tracking-[0.16em] uppercase";

  return (
    <form
      className="border-rule-soft mt-4 flex flex-col gap-4 border-t pt-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valido || enviando || importe === null) return;
        setEnviando(true);
        setError(null);
        try {
          await onEnviar(mensaje.trim(), importe, plazo.trim());
        } catch (err) {
          setError(err instanceof Error ? err.message : "No se pudo enviar la postulación.");
        } finally {
          setEnviando(false);
        }
      }}
    >
      <label>
        <span className={etiquetaClass}>Mensaje para el cliente</span>
        <textarea
          className={`${campoClass} resize-y leading-relaxed`}
          maxLength={MENSAJE_MAX}
          placeholder="Contale por qué sos una buena opción y cómo lo encararías."
          rows={4}
          value={mensaje}
          onChange={(e) => setMensaje(e.target.value)}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label>
          <span className={etiquetaClass}>Precio estimado (USD)</span>
          <input
            className={campoClass}
            inputMode="decimal"
            placeholder="1500"
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
          />
        </label>
        <label>
          <span className={etiquetaClass}>Plazo</span>
          <input
            className={campoClass}
            maxLength={80}
            placeholder="3 semanas"
            value={plazo}
            onChange={(e) => setPlazo(e.target.value)}
          />
        </label>
      </div>
      <p className="text-muted text-[12px] leading-relaxed">
        Es una estimación: si el cliente te elige, recibís sus datos y le mandás la propuesta formal
        desde tu panel.
      </p>
      {error && (
        <p className="text-brick text-[13px]" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          className="ease bg-ink text-paper hover:bg-ochre px-5 py-3 text-[11px] tracking-[0.14em] uppercase transition duration-200 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!valido || enviando}
          type="submit"
        >
          {enviando ? "Enviando…" : "Enviar postulación"}
        </button>
        <button className={ghostButtonClass} type="button" onClick={onCancelar}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
