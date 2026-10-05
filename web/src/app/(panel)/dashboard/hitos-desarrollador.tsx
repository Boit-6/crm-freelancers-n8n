"use client";

import type {Hito, Proyecto} from "@/types/supabase";

import {useState} from "react";

import {campoClass, ghostButtonClass, peligroClass, primarioClass} from "@/lib/constants";
import {COLOR_HITO, ESTADO_HITO, usd} from "@/lib/hitos";
import {createClient} from "@/lib/supabase/client";

type Accion = "entregar" | "devolver" | "anular";

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-AR", {day: "numeric", month: "long"});

const enlaceClass = "text-[11px] tracking-[0.14em] uppercase disabled:opacity-40";

// Qué puede hacer el desarrollador con cada hito según su estado: lo mismo
// que valida la base (db/schema.sql §12).
function acciones(hito: Hito, aceptado: boolean): Accion[] {
  switch (hito.estado) {
    case "PENDIENTE":
      return aceptado ? ["anular"] : [];
    case "FONDEADO":
      return ["entregar", "devolver"];
    case "ENTREGADO":
    case "EN_DISPUTA":
      return ["devolver"];
    default:
      return [];
  }
}

function Situacion({hito}: {hito: Hito}) {
  const neto = hito.monto_liberado - hito.comision;

  if (hito.estado === "FONDEADO") {
    return <p className="text-ochre">El cliente pagó: la plata está retenida. Ya podés empezar.</p>;
  }
  if (hito.estado === "ENTREGADO" && hito.libera_en) {
    return (
      <p className="text-faint">
        Esperando que el cliente apruebe. Si no responde, se libera solo el {fecha(hito.libera_en)}.
      </p>
    );
  }
  if (hito.estado === "EN_DISPUTA") {
    return (
      <p className="text-brick">
        El cliente abrió una disputa: «{hito.disputa_motivo}». La plataforma la va a resolver; si le
        das la razón, podés devolverle la plata.
      </p>
    );
  }
  if (hito.estado === "LIBERADO") {
    return (
      <p className="text-moss">
        Liberado: {usd(neto)} para vos ({usd(hito.comision)} de comisión)
        {hito.monto_reembolsado > 0 &&
          `, ${usd(hito.monto_reembolsado)} devueltos al cliente`}.{" "}
        {hito.transferido_en
          ? "Ya está transferido a tu cuenta."
          : "La transferencia sale en minutos."}
      </p>
    );
  }
  if (hito.estado === "REEMBOLSADO") {
    return <p className="text-faint">Devuelto al cliente.</p>;
  }

  return null;
}

function FilaHito({
  hito,
  aceptado,
  onCambio,
}: {
  hito: Hito;
  aceptado: boolean;
  onCambio: () => void;
}) {
  const [supabase] = useState(() => createClient());
  const [abierta, setAbierta] = useState<Accion | null>(null);
  const [nota, setNota] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const posibles = acciones(hito, aceptado);

  async function ejecutar(accion: Accion) {
    if (!supabase) return;
    setEnviando(true);
    setError(null);
    const {error: err} =
      accion === "entregar"
        ? await supabase.rpc("entregar_hito", {p_hito: hito.id, p_nota: nota})
        : accion === "devolver"
          ? await supabase.rpc("devolver_hito", {
              p_hito: hito.id,
              p_nota: nota,
            })
          : await supabase.rpc("anular_hito", {p_hito: hito.id});

    setEnviando(false);
    if (err) {
      setError(err.message);

      return;
    }
    setAbierta(null);
    setNota("");
    onCambio();
  }

  return (
    <li className="flex flex-col gap-2 py-3 text-[14px]">
      <div className="flex items-baseline gap-3">
        <span className="text-mist w-4 text-right text-[12px] tabular-nums">{hito.orden}.</span>
        <span className="text-ink-soft flex-1">{hito.titulo}</span>
        <span className={`text-[11px] tracking-[0.08em] uppercase ${COLOR_HITO[hito.estado]}`}>
          {ESTADO_HITO[hito.estado]}
        </span>
        <span className="text-ink tabular-nums">{usd(hito.monto)}</span>
      </div>
      <div className="flex flex-col gap-2 pl-7 text-[13px] leading-relaxed">
        <Situacion hito={hito} />

        {abierta === null && posibles.length > 0 && (
          <div className="flex flex-wrap gap-4">
            {posibles.includes("entregar") && (
              <button
                className={primarioClass}
                type="button"
                onClick={() => setAbierta("entregar")}
              >
                Marcar entregado
              </button>
            )}
            {posibles.includes("devolver") && (
              <button
                className={`${enlaceClass} text-muted hover:text-brick`}
                type="button"
                onClick={() => setAbierta("devolver")}
              >
                Devolver la plata
              </button>
            )}
            {posibles.includes("anular") && (
              <button
                className={`${enlaceClass} text-muted hover:text-brick`}
                type="button"
                onClick={() => setAbierta("anular")}
              >
                Anular hito
              </button>
            )}
          </div>
        )}

        {abierta === "entregar" && (
          <div className="flex flex-col gap-2">
            <textarea
              aria-label={`Qué entregaste en el hito ${hito.orden}`}
              className={`${campoClass} resize-y`}
              maxLength={2000}
              placeholder="Qué entregaste y dónde verlo (enlace, repositorio, archivo…)"
              rows={3}
              value={nota}
              onChange={(e) => setNota(e.target.value)}
            />
            <div className="flex gap-4">
              <button
                className={primarioClass}
                disabled={enviando || nota.trim().length < 5}
                type="button"
                onClick={() => ejecutar("entregar")}
              >
                {enviando ? "Enviando…" : "Avisar al cliente"}
              </button>
              <button className={ghostButtonClass} type="button" onClick={() => setAbierta(null)}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {(abierta === "devolver" || abierta === "anular") && (
          <div className="border-brick/40 flex flex-col gap-2 border-l-2 pl-3">
            <p className="text-ink-soft">
              {abierta === "devolver"
                ? `¿Devolverle ${usd(hito.monto)} al cliente? No se puede deshacer.`
                : "¿Sacar este hito del proyecto? El cliente ya no va a poder pagarlo."}
            </p>
            {abierta === "devolver" && (
              <textarea
                aria-label="Motivo de la devolución (opcional)"
                className={`${campoClass} resize-y`}
                maxLength={2000}
                placeholder="Motivo, opcional: le llega al cliente"
                rows={2}
                value={nota}
                onChange={(e) => setNota(e.target.value)}
              />
            )}
            <div className="flex gap-4">
              <button
                className={peligroClass}
                disabled={enviando}
                type="button"
                onClick={() => ejecutar(abierta)}
              >
                {enviando ? "…" : abierta === "devolver" ? "Sí, devolver" : "Sí, anular"}
              </button>
              <button className={ghostButtonClass} type="button" onClick={() => setAbierta(null)}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {error && (
          <p className="text-brick" role="alert">
            {error}
          </p>
        )}
      </div>
    </li>
  );
}

// Los hitos de un proyecto en el detalle del lead, con lo que el
// desarrollador puede hacer en cada uno.
export default function HitosDesarrollador({
  proyecto,
  onCambio,
}: {
  proyecto: Proyecto;
  onCambio: () => void;
}) {
  return (
    <div className="mt-5">
      <p className="text-faint mb-2 text-[10px] tracking-[0.16em] uppercase">
        Por hitos · pago protegido
      </p>
      <ol className="border-rule-soft divide-rule-soft divide-y border-y">
        {proyecto.hitos.map((h) => (
          <FilaHito
            key={h.id}
            aceptado={proyecto.estado === "ACEPTADO"}
            hito={h}
            onCambio={onCambio}
          />
        ))}
      </ol>
    </div>
  );
}
