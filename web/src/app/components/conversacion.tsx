"use client";

import type {Conversacion as DatosConversacion, Mensaje} from "@/types/supabase";

import {useEffect, useRef, useState} from "react";

import {Cargando, Esqueleto} from "./esqueleto";

import {createClient} from "@/lib/supabase/client";

// Sin sesión (cliente con el token del enlace) no hay tiempo real: se consulta
// cada tanto mientras la conversación está abierta.
const SONDEO_MS = 10_000;

const hora = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

// Conversación entre el cliente y un postulante, en un panel lateral (a
// pantalla completa en el celular). Las reglas (quién es quién, si está
// abierta, ocultar datos antes de elegir) las decide la base; acá se muestra.
// Con sesión, los mensajes nuevos llegan por el tiempo real de Supabase.
export default function Conversacion({
  postulacionId,
  token,
  con,
  onCerrar,
}: {
  postulacionId: string;
  // Clientes sin cuenta: el token del enlace del correo.
  token?: string;
  // Con quién se habla (para el título).
  con: string;
  onCerrar: () => void;
}) {
  const [supabase] = useState(() => createClient());
  const [datos, setDatos] = useState<DatosConversacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [version, setVersion] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const finRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    if (!supabase) return;

    let vigente = true;

    supabase
      .rpc("abrir_conversacion", {
        p_postulacion: postulacionId,
        p_token: token ?? null,
      })
      .then(({data, error: err}) => {
        if (!vigente) return;
        if (err) setError(err.message);
        else setDatos(data);
      });

    return () => {
      vigente = false;
    };
  }, [supabase, postulacionId, token, version]);

  // Mensajes nuevos: tiempo real con sesión, sondeo sin sesión.
  useEffect(() => {
    if (!supabase) return;

    if (token) {
      const intervalo = setInterval(() => setVersion((v) => v + 1), SONDEO_MS);

      return () => clearInterval(intervalo);
    }

    const client = supabase;
    const canal = client
      .channel(`mensajes-${postulacionId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "mensajes",
          filter: `postulacion_id=eq.${postulacionId}`,
        },
        () => setVersion((v) => v + 1),
      )
      .subscribe();

    return () => {
      client.removeChannel(canal);
    };
  }, [supabase, postulacionId, token]);

  const cantidad = datos?.mensajes.length ?? 0;

  useEffect(() => {
    finRef.current?.scrollIntoView?.({block: "end"});
  }, [cantidad]);

  async function enviar() {
    if (!supabase || !texto.trim() || enviando) return;

    setEnviando(true);
    setError(null);

    const {data, error: err} = await supabase.rpc("enviar_mensaje", {
      p_postulacion: postulacionId,
      p_texto: texto.trim(),
      p_token: token ?? null,
    });

    setEnviando(false);
    if (err) {
      setError(err.message);

      return;
    }
    setTexto("");
    setDatos((actual) =>
      actual && !actual.mensajes.some((m: Mensaje) => m.id === data.id)
        ? {...actual, mensajes: [...actual.mensajes, data]}
        : actual,
    );
  }

  return (
    // El clic en el fondo cae sobre el propio <dialog>: cierra.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={dialogRef}
      aria-labelledby="conversacion-titulo"
      className="bg-paper text-ink backdrop:bg-ink/30 m-0 ml-auto h-dvh max-h-none w-full max-w-none p-0 sm:max-w-md"
      onClick={(e) => {
        if (e.target === dialogRef.current) dialogRef.current?.close();
      }}
      onClose={onCerrar}
    >
      <div className="flex h-full flex-col">
        <div className="border-rule-soft bg-card flex items-center justify-between gap-4 border-b px-5 py-4">
          <h2 className="text-ink truncate font-serif text-[20px]" id="conversacion-titulo">
            {con}
          </h2>
          <button
            className="text-muted hover:text-ochre shrink-0 text-[11px] tracking-[0.16em] uppercase"
            type="button"
            onClick={() => dialogRef.current?.close()}
          >
            Cerrar ✕
          </button>
        </div>

        <div aria-live="polite" className="flex-1 overflow-y-auto px-5 py-5">
          {!datos && !error && (
            <Cargando className="flex flex-col gap-3" etiqueta="Cargando la conversación…">
              <Esqueleto className="h-12 w-3/4" />
              <Esqueleto className="ml-auto h-10 w-2/3" />
              <Esqueleto className="h-16 w-4/5" />
            </Cargando>
          )}
          {datos && datos.mensajes.length === 0 && (
            <p className="text-muted text-[13.5px] leading-relaxed">
              Todavía no hay mensajes.{" "}
              {datos.rol === "cliente"
                ? "Preguntale lo que necesites antes de elegir."
                : "Podés preguntarle al cliente lo que necesites para tu propuesta."}
            </p>
          )}
          {datos && datos.mensajes.length > 0 && (
            <ol className="flex flex-col gap-3">
              {datos.mensajes.map((m: Mensaje) => {
                const propio = m.autor === datos.rol;

                return (
                  <li
                    key={m.id}
                    className={`max-w-[85%] px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-line ${
                      propio
                        ? "bg-ink text-paper ml-auto"
                        : "border-rule-soft bg-card text-ink-soft border"
                    }`}
                  >
                    <span className="sr-only">{propio ? "Vos" : con}: </span>
                    {m.texto}
                    <span
                      className={`mt-1 block text-[11px] ${propio ? "text-paper/60" : "text-mist"}`}
                    >
                      {hora(m.creado_en)}
                      {propio && m.leido_en ? " · Leído" : ""}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          <div ref={finRef} />
        </div>

        {error && (
          <p className="text-brick px-5 pb-2 text-[13px]" role="alert">
            {error}
          </p>
        )}

        {datos && !datos.abierta ? (
          <p className="border-rule-soft text-muted border-t px-5 py-4 text-[13px]">
            La conversación está cerrada: el proyecto ya se asignó o venció.
          </p>
        ) : (
          <form
            className="border-rule-soft bg-card flex items-end gap-3 border-t px-5 py-4"
            onSubmit={(e) => {
              e.preventDefault();
              enviar();
            }}
          >
            <label className="flex-1">
              <span className="sr-only">Mensaje</span>
              <textarea
                className="border-rule text-ink placeholder-mist focus:border-ochre max-h-40 w-full resize-none border bg-transparent px-3 py-2 text-[14px] leading-relaxed outline-none"
                disabled={!datos}
                maxLength={2000}
                placeholder="Escribí un mensaje…"
                rows={2}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => {
                  // Enter envía; Shift+Enter hace un salto de línea.
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    enviar();
                  }
                }}
              />
            </label>
            <button
              className="ease bg-ink text-paper hover:bg-ochre px-4 py-3 text-[11px] tracking-[0.14em] uppercase transition duration-200 disabled:opacity-40"
              disabled={!datos || !texto.trim() || enviando}
              type="submit"
            >
              {enviando ? "…" : "Enviar"}
            </button>
          </form>
        )}
        {datos?.abierta && datos.ocultar && (
          <p className="text-mist bg-card px-5 pb-3 text-[11.5px]">
            Hasta que se elija, los teléfonos, correos y enlaces de mensajería se ocultan.
          </p>
        )}
      </div>
    </dialog>
  );
}
