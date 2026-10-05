"use client";

import Link from "next/link";
import {useState} from "react";

import {Reputacion} from "./estrellas";

// Lo que comparten /elegir/<token> (el enlace del correo) y «Mis proyectos»
// (el panel del cliente): cómo se muestra una postulación y cómo se elige.
// Las dos eligen por el mismo webhook de n8n con el token del proyecto.

export const N8N_BASE = process.env.NEXT_PUBLIC_N8N_BASE;

export const HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  ...(process.env.NODE_ENV === "development" ? {"ngrok-skip-browser-warning": "true"} : {}),
};

export interface Postulacion {
  id: string;
  espacio: string;
  mensaje: string;
  precio: number;
  plazo: string;
  // Perfil público y reputación del postulante.
  slug: string;
  promedio: number | null;
  calificaciones: number;
  // Es la que eligió el cliente (la conversación sigue con ella).
  elegida?: boolean;
}

// Botón para abrir la conversación con un postulante, con los no leídos.
export function BotonMensajes({sinLeer = 0, onClick}: {sinLeer?: number; onClick: () => void}) {
  return (
    <button
      className="ease text-ink-soft hover:text-ochre inline-flex items-center gap-2 text-[12.5px] underline underline-offset-2 transition duration-200"
      type="button"
      onClick={onClick}
    >
      Mensajes
      {sinLeer > 0 && (
        <span className="bg-ochre text-paper px-1.5 py-0.5 text-[10.5px] no-underline">
          {sinLeer} {sinLeer === 1 ? "nuevo" : "nuevos"}
        </span>
      )}
    </button>
  );
}

export const tarjetaClass =
  "border-rule-soft bg-card border shadow-[0_1px_2px_rgba(25,23,19,0.04),0_12px_32px_-18px_rgba(25,23,19,0.18)]";

const formatoUsd = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

// Elige una postulación. Devuelve la marca del espacio elegido, o lanza el
// motivo si n8n no pudo (por ejemplo, el proyecto ya se asignó).
export async function elegirPostulacion(token: string, postulacionId: string): Promise<string> {
  return pedirEleccion({t: token, postulacion_id: postulacionId});
}

// «Que lo elija la plataforma»: n8n sortea entre los postulantes, con más
// chances para los mejor calificados (sortear_postulacion() en la base).
export async function elegirAlAzar(token: string): Promise<string> {
  return pedirEleccion({t: token, azar: true});
}

async function pedirEleccion(cuerpo: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${N8N_BASE}/webhook/bolsa-elegir`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(cuerpo),
  });
  const json = await res.json().catch(() => ({}));

  if (!res.ok || json.status !== "ok") {
    throw new Error(json.mensaje ?? "No se pudo elegir. Probá de nuevo en un rato.");
  }

  return json.espacio_nombre;
}

export function TarjetaPostulacion({
  postulacion,
  onElegir,
  onMensajes,
  sinLeer,
}: {
  postulacion: Postulacion;
  onElegir: () => Promise<void>;
  // Abre la conversación con este postulante (etapa 9).
  onMensajes?: () => void;
  sinLeer?: number;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <li className={`${tarjetaClass} flex flex-col gap-3 px-6 py-5`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-ink font-serif text-[23px] leading-tight">{postulacion.espacio}</h3>
        <span className="text-ink font-serif text-[23px]">
          {formatoUsd.format(postulacion.precio)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Reputacion cantidad={postulacion.calificaciones} promedio={postulacion.promedio} />
        <Link
          className="text-ochre hover:text-ochre-deep text-[12.5px] underline underline-offset-2"
          href={`/d/${postulacion.slug}`}
          target="_blank"
        >
          Ver perfil ↗
        </Link>
        {onMensajes && <BotonMensajes sinLeer={sinLeer} onClick={onMensajes} />}
      </div>
      <p className="text-ochre text-[10.5px] tracking-[0.14em] uppercase">
        Plazo estimado: {postulacion.plazo}
      </p>
      <p className="text-ink-soft text-[14.5px] leading-relaxed whitespace-pre-line">
        {postulacion.mensaje}
      </p>

      {error && (
        <p className="text-brick text-[13px]" role="alert">
          {error}
        </p>
      )}

      {confirmando ? (
        <div className="border-rule-soft mt-1 flex flex-col gap-3 border-t pt-4">
          <p className="text-ink-soft text-[14px] leading-relaxed">
            ¿Elegir a <b>{postulacion.espacio}</b>? Le pasamos tus datos de contacto para que te
            mande la propuesta formal. Los demás no reciben nada.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              className="ease bg-ink text-paper hover:bg-ochre px-6 py-3.5 text-[11px] tracking-[0.16em] uppercase transition duration-200 disabled:opacity-40"
              disabled={enviando}
              type="button"
              onClick={async () => {
                setEnviando(true);
                setError(null);
                try {
                  await onElegir();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "No se pudo elegir.");
                  setEnviando(false);
                }
              }}
            >
              {enviando ? "Enviando…" : "Sí, elegir"}
            </button>
            <button
              className="ease text-mist hover:text-ink px-4 py-3.5 text-[11px] tracking-[0.14em] uppercase transition duration-200 disabled:opacity-40"
              disabled={enviando}
              type="button"
              onClick={() => setConfirmando(false)}
            >
              Volver
            </button>
          </div>
        </div>
      ) : (
        <button
          className="ease border-ink text-ink hover:border-ochre hover:text-ochre mt-1 self-start border px-5 py-3 text-[11px] tracking-[0.14em] uppercase transition duration-200"
          type="button"
          onClick={() => setConfirmando(true)}
        >
          Elegir a {postulacion.espacio}
        </button>
      )}
    </li>
  );
}

// El cliente ve las postulaciones a su pedido (sin que nadie haya visto sus
// datos todavía) y elige una. Todo pasa por n8n con el token del enlace.

// Botón «Que lo elija la plataforma», con confirmación. Sólo tiene sentido con
// dos o más postulantes.
export function BotonAlAzar({
  cantidad,
  onElegir,
}: {
  cantidad: number;
  onElegir: () => Promise<void>;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (cantidad < 2) return null;

  return (
    <div className="border-rule-soft flex flex-col gap-3 border border-dashed px-6 py-5">
      {confirmando ? (
        <>
          <p className="text-ink-soft text-[14px] leading-relaxed">
            Sorteamos entre los {cantidad} postulantes: los mejor calificados tienen más chances. Al
            elegido le pasamos tus datos para que te mande la propuesta formal.
          </p>
          {error && (
            <p className="text-brick text-[13px]" role="alert">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              className="ease bg-ink text-paper hover:bg-ochre px-6 py-3.5 text-[11px] tracking-[0.16em] uppercase transition duration-200 disabled:opacity-40"
              disabled={enviando}
              type="button"
              onClick={async () => {
                setEnviando(true);
                setError(null);
                try {
                  await onElegir();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "No se pudo elegir.");
                  setEnviando(false);
                }
              }}
            >
              {enviando ? "Sorteando…" : "Sí, sorteá"}
            </button>
            <button
              className="ease text-mist hover:text-ink px-4 py-3.5 text-[11px] tracking-[0.14em] uppercase transition duration-200 disabled:opacity-40"
              disabled={enviando}
              type="button"
              onClick={() => setConfirmando(false)}
            >
              Volver
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted text-[13.5px]">¿No sabés a quién elegir?</p>
          <button
            className="ease border-ink text-ink hover:border-ochre hover:text-ochre border px-5 py-3 text-[11px] tracking-[0.14em] uppercase transition duration-200"
            type="button"
            onClick={() => setConfirmando(true)}
          >
            Que lo elija la plataforma
          </button>
        </div>
      )}
    </div>
  );
}
