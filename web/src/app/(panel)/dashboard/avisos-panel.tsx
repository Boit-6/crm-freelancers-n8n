"use client";

import type {Database} from "@/types/supabase";

import {useCallback, useEffect, useState} from "react";

import {SectionHeader, formatDate} from "./dashboard-shared";

import {createClient} from "@/lib/supabase/client";

type Aviso = Database["public"]["Tables"]["avisos"]["Row"];

const MAX_AVISOS = 8;

// El mensaje viene armado para Telegram (HTML con <b> y saltos de línea, con
// los datos del cliente ya escapados). Acá se muestra como texto: se sacan las
// etiquetas y se decodifican las entidades, y React lo vuelve a escapar.
export function textoDeAviso(mensaje: string) {
  return mensaje
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

// Avisos del espacio que todavía no se leyeron. Los mismos que le llegan al
// desarrollador por correo (los que piden una acción) o por Telegram.
export default function AvisosPanel() {
  const [supabase] = useState(() => createClient());
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [marcando, setMarcando] = useState(false);

  const cargar = useCallback(async () => {
    if (!supabase) return;

    const {data} = await supabase
      .from("avisos")
      .select("*")
      .is("leido_en", null)
      .order("creado_en", {ascending: false})
      .limit(MAX_AVISOS);

    setAvisos(data ?? []);
  }, [supabase]);

  useEffect(() => {
    cargar();

    if (!supabase) return;

    const client = supabase;
    // La RLS filtra los eventos: sólo llegan los del espacio propio.
    const channel = client
      .channel("avisos-rt")
      .on("postgres_changes", {event: "INSERT", schema: "public", table: "avisos"}, () => cargar())
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
  }, [cargar, supabase]);

  async function marcarLeidos() {
    if (!supabase || !avisos.length) return;

    setMarcando(true);
    try {
      await supabase
        .from("avisos")
        .update({leido_en: new Date().toISOString()})
        .in(
          "id",
          avisos.map((a) => a.id),
        );
      await cargar();
    } finally {
      setMarcando(false);
    }
  }

  if (!avisos.length) return null;

  return (
    <section aria-label="Novedades">
      <SectionHeader num="II" title={`Novedades (${avisos.length})`} />
      <ul className="border-rule-soft bg-card divide-rule-soft divide-y border">
        {avisos.map((a) => {
          // El mensaje es el de Telegram, de varias líneas. En el panel alcanza
          // con el título y la primera línea de datos (el cliente): lo que
          // pide una acción ya está arriba, en «Requiere tu atención».
          const [titulo, ...resto] = textoDeAviso(a.mensaje)
            .split("\n")
            .map((linea) => linea.trim())
            .filter(Boolean);

          return (
            <li
              key={a.id}
              className={`flex flex-col gap-0.5 px-5 py-3 sm:flex-row sm:items-baseline sm:gap-4 ${
                a.nivel === "atencion" || a.nivel === "critico" ? "border-l-ochre border-l-2" : ""
              }`}
            >
              <span className="text-faint w-20 shrink-0 text-[11px]">
                {formatDate(a.creado_en)}
              </span>
              <span className="text-ink text-[13.5px]">{titulo}</span>
              {resto[0] && <span className="text-muted truncate text-[13px]">{resto[0]}</span>}
            </li>
          );
        })}
      </ul>
      <button
        className="ease text-muted hover:text-ochre mt-4 text-[11px] tracking-[0.14em] uppercase transition duration-200 disabled:opacity-40"
        disabled={marcando}
        type="button"
        onClick={marcarLeidos}
      >
        {marcando ? "Marcando..." : "Marcar como leídos"}
      </button>
    </section>
  );
}
