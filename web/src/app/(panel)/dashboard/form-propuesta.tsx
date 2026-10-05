"use client";

import {useState} from "react";

import {
  type HitoBorrador,
  MAX_HITOS,
  hitosParaEnviar,
  leerMonto,
  problemaHitos,
  totalHitos,
  usd,
} from "@/lib/hitos";
import {leerImporte} from "@/lib/moneda";

export type HitosPropuesta = {titulo: string; monto: number}[] | null;

// Términos de una propuesta pendiente. El precio arranca vacío a propósito:
// el presupuesto que declaró el interesado se muestra como referencia en el
// detalle del lead, pero escribirlo es una decisión del profesional, no un
// valor que el sistema arrastre por omisión.
//
// Cobro (etapa 11): factura única o por hitos con pago protegido. Los
// proyectos que llegaron por la plataforma se cobran siempre por hitos; con
// un cliente propio, elige el desarrollador. Con hitos, el precio es la suma.
export default function FormPropuesta({
  dePlataforma,
  onEnviar,
}: {
  dePlataforma: boolean;
  onEnviar: (
    precio: number,
    plazo: string,
    alcance: string,
    hitos: HitosPropuesta,
  ) => Promise<void>;
}) {
  const [porHitos, setPorHitos] = useState(dePlataforma);
  const [precio, setPrecio] = useState("");
  const [hitos, setHitos] = useState<HitoBorrador[]>([{titulo: "", monto: ""}]);
  const [plazo, setPlazo] = useState("");
  const [alcance, setAlcance] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const conHitos = dePlataforma || porHitos;
  const importe = conHitos ? null : leerImporte(precio);
  const valor = conHitos ? totalHitos(hitos) : (importe ?? 0);
  const problema = conHitos ? problemaHitos(hitos) : null;
  const valido = conHitos ? problema === null : importe !== null;
  // El problema se muestra recién cuando el hito ya tiene algo escrito: un
  // formulario recién abierto no arranca con un error en rojo.
  const tocado = hitos.some((h) => h.titulo.trim() || h.monto.trim());

  const campoBase =
    "ease border-rule bg-card text-ink placeholder-mist focus:border-ochre border px-3 py-2.5 text-[14px] transition duration-200 outline-none";
  const campoClass = `${campoBase} w-full`;
  const etiquetaClass = "text-faint mb-1.5 block text-[10px] tracking-[0.16em] uppercase";
  const opcionClass = (activa: boolean) =>
    `ease flex-1 px-3 py-2.5 text-[11px] tracking-[0.12em] uppercase transition duration-200 ${
      activa ? "bg-ink text-paper" : "text-muted hover:text-ink"
    }`;

  function cambiarHito(i: number, campo: keyof HitoBorrador, texto: string) {
    setHitos((prev) => prev.map((h, j) => (j === i ? {...h, [campo]: texto} : h)));
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valido || enviando) return;
        setEnviando(true);
        setError(null);
        try {
          await onEnviar(
            valor,
            plazo.trim(),
            alcance.trim(),
            conHitos ? hitosParaEnviar(hitos) : null,
          );
        } catch (err) {
          setError(err instanceof Error ? err.message : "No se pudo enviar la propuesta.");
        } finally {
          setEnviando(false);
        }
      }}
    >
      {dePlataforma ? (
        <p className="border-rule-soft text-ink-soft border-l-2 pl-3 text-[13px] leading-relaxed">
          Llegó por la plataforma: se cobra por hitos, con pago protegido.
        </p>
      ) : (
        <div aria-label="Cómo cobrás" className="border-rule flex border" role="radiogroup">
          <button
            aria-checked={!porHitos}
            className={opcionClass(!porHitos)}
            role="radio"
            type="button"
            onClick={() => setPorHitos(false)}
          >
            Factura única
          </button>
          <button
            aria-checked={porHitos}
            className={opcionClass(porHitos)}
            role="radio"
            type="button"
            onClick={() => setPorHitos(true)}
          >
            Por hitos
          </button>
        </div>
      )}

      {conHitos ? (
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className={etiquetaClass}>Hitos</legend>
          {hitos.map((h, i) => (
            // El orden es la identidad del hito mientras se edita.
            <div key={i} className="flex items-start gap-2">
              <span className="text-mist w-5 pt-2.5 text-right text-[12px] tabular-nums">
                {i + 1}.
              </span>
              <input
                aria-label={`Título del hito ${i + 1}`}
                className={`${campoBase} min-w-0 flex-1`}
                maxLength={120}
                placeholder={i === 0 ? "Diseño" : "Qué se entrega"}
                value={h.titulo}
                onChange={(e) => cambiarHito(i, "titulo", e.target.value)}
              />
              <input
                aria-invalid={h.monto.trim() !== "" && leerMonto(h.monto) === null}
                aria-label={`Monto del hito ${i + 1} en USD`}
                className={`${campoBase} w-28 shrink-0 text-right tabular-nums`}
                inputMode="decimal"
                placeholder="USD"
                value={h.monto}
                onChange={(e) => cambiarHito(i, "monto", e.target.value)}
              />
              <button
                aria-label={`Quitar el hito ${i + 1}`}
                className="text-mist hover:text-brick px-1 pt-2.5 text-[13px] disabled:invisible"
                disabled={hitos.length === 1}
                type="button"
                onClick={() => setHitos((prev) => prev.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between pt-1">
            <button
              className="text-ochre hover:text-ochre-deep text-[11px] tracking-[0.14em] uppercase disabled:opacity-40"
              disabled={hitos.length >= MAX_HITOS}
              type="button"
              onClick={() => setHitos((prev) => [...prev, {titulo: "", monto: ""}])}
            >
              + Agregar hito
            </button>
            <span className="text-ink text-[14px] tabular-nums">
              Total <b>{usd(valor)}</b>
            </span>
          </div>
          {tocado && problema && <p className="text-brick text-[12.5px]">{problema}</p>}
        </fieldset>
      ) : null}

      <div className={conHitos ? "" : "grid grid-cols-2 gap-3"}>
        {!conHitos && (
          <label>
            <span className={etiquetaClass}>Precio (USD)</span>
            <input
              className={campoClass}
              inputMode="decimal"
              placeholder="1500"
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
            />
          </label>
        )}
        <label>
          <span className={etiquetaClass}>Plazo</span>
          <input
            className={campoClass}
            placeholder="2 semanas"
            value={plazo}
            onChange={(e) => setPlazo(e.target.value)}
          />
        </label>
      </div>
      <label>
        <span className={etiquetaClass}>Alcance</span>
        <textarea
          className={`${campoClass} resize-y`}
          placeholder="Qué incluye la propuesta"
          rows={3}
          value={alcance}
          onChange={(e) => setAlcance(e.target.value)}
        />
      </label>
      {error && (
        <p className="text-brick text-[13px]" role="alert">
          {error}
        </p>
      )}
      <button
        className="ease bg-ink text-paper hover:bg-ochre py-3.5 text-[11px] tracking-[0.16em] uppercase transition duration-200 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!valido || enviando}
        type="submit"
      >
        {enviando ? "Enviando…" : "Enviar propuesta"}
      </button>
      <p className="text-mist text-[12px] leading-relaxed">
        {conHitos
          ? "El cliente paga cada hito por adelantado y la plataforma retiene la plata hasta que aprueba la entrega. Al liberarse, recibís el monto menos la comisión de la plataforma."
          : "Ese precio es el que se factura cuando el cliente acepta."}
      </p>
    </form>
  );
}
