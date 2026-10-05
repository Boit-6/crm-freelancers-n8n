"use client";

import type {Database} from "@/types/supabase";

import {useEffect, useState} from "react";

import {Cargando, Esqueleto} from "@/app/components/esqueleto";
import Conversacion from "@/app/components/conversacion";
import {
  BotonAlAzar,
  BotonMensajes,
  TarjetaPostulacion,
  elegirAlAzar,
  elegirPostulacion,
  tarjetaClass,
} from "@/app/components/postulaciones";
import {presupuestoDeclarado} from "@/lib/presupuesto";
import {SERVICIO_LEGIBLE} from "@/lib/servicios";
import {createClient} from "@/lib/supabase/client";

type Proyecto = Database["public"]["Functions"]["mis_proyectos"]["Returns"][number];

const DIA_MS = 86_400_000;

function situacion(p: Proyecto, ahora: number): {texto: string; clase: string} {
  // «Quedó con»: sirve tanto si eligió el cliente como si sorteó la plataforma.
  if (p.estado === "ASIGNADO") return {texto: `Quedó con ${p.elegido_nombre}`, clase: "text-moss"};
  if (p.estado === "VENCIDO") return {texto: "Venció sin elección", clase: "text-mist"};
  if (p.estado === "EN_ELECCION") return {texto: "Es hora de elegir", clase: "text-ochre"};

  const dias = Math.ceil((new Date(p.vence_en).getTime() - ahora) / DIA_MS);

  return {
    texto:
      dias <= 1 ? "Recibe postulaciones hasta mañana" : `Recibe postulaciones ${dias} días más`,
    clase: "text-muted",
  };
}

export function EsqueletoMisProyectos() {
  return (
    <Cargando className="flex flex-col gap-6" etiqueta="Cargando tus proyectos…">
      {Array.from({length: 2}, (_, i) => (
        <div key={i} className={`${tarjetaClass} flex flex-col gap-3 px-6 py-5`}>
          <div className="flex justify-between gap-4">
            <Esqueleto className="h-7 w-64 max-w-full" />
            <Esqueleto className="h-3 w-28" />
          </div>
          <Esqueleto className="h-3 w-48" />
          <Esqueleto className="h-4 w-full" />
          <Esqueleto className="h-4 w-3/4" />
        </div>
      ))}
    </Cargando>
  );
}

function TarjetaProyecto({
  proyecto,
  ahora,
  onElegido,
  sinLeer,
  onMensajes,
}: {
  proyecto: Proyecto;
  ahora: number;
  onElegido: () => void;
  sinLeer: Record<string, number>;
  onMensajes: (postulacionId: string, con: string) => void;
}) {
  const elegida = proyecto.detalle.find((p) => p.elegida);
  const estado = situacion(proyecto, ahora);
  const puedeElegir = proyecto.estado === "ABIERTO" || proyecto.estado === "EN_ELECCION";

  return (
    <li className={`${tarjetaClass} flex flex-col gap-4 px-6 py-5`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-ink font-serif text-[24px] leading-tight">
          {proyecto.titulo ?? SERVICIO_LEGIBLE[proyecto.servicio]}
        </h2>
        <span className={`text-[10.5px] tracking-[0.14em] uppercase ${estado.clase}`}>
          {estado.texto}
        </span>
      </div>
      <p className="text-muted text-[13px]">
        {SERVICIO_LEGIBLE[proyecto.servicio]} ·{" "}
        {presupuestoDeclarado(proyecto.presupuesto_rango, 0)} · {proyecto.postulaciones}/
        {proyecto.tope_postulaciones} postulaciones
      </p>
      <p className="text-ink-soft line-clamp-3 text-[14px] leading-relaxed">{proyecto.resumen}</p>

      {puedeElegir && proyecto.detalle.length === 0 && (
        <p className="text-mist text-[13px]">
          Todavía no se postuló nadie. Te avisamos por correo cuando haya propuestas.
        </p>
      )}

      {puedeElegir && proyecto.detalle.length > 0 && (
        <ul className="border-rule-soft flex flex-col gap-3 border-t pt-4">
          {proyecto.detalle.map((p) => (
            <TarjetaPostulacion
              key={p.id}
              postulacion={p}
              sinLeer={sinLeer[p.id]}
              onElegir={async () => {
                await elegirPostulacion(proyecto.eleccion_token, p.id);
                onElegido();
              }}
              onMensajes={() => onMensajes(p.id, p.espacio)}
            />
          ))}
        </ul>
      )}

      {proyecto.estado === "ASIGNADO" && elegida && (
        <div className="flex flex-wrap items-center gap-4">
          <BotonMensajes
            sinLeer={sinLeer[elegida.id]}
            onClick={() => onMensajes(elegida.id, elegida.espacio)}
          />
          {proyecto.proyecto_token && (
            <a
              className="text-ochre hover:text-ochre-deep text-[11px] tracking-[0.14em] uppercase underline-offset-4 hover:underline"
              href={`/proyecto/${proyecto.proyecto_token}`}
            >
              Ver el proyecto y los pagos →
            </a>
          )}
        </div>
      )}

      {puedeElegir && (
        <BotonAlAzar
          cantidad={proyecto.detalle.length}
          onElegir={async () => {
            await elegirAlAzar(proyecto.eleccion_token);
            onElegido();
          }}
        />
      )}
    </li>
  );
}

// Los proyectos del cliente con sus postulaciones. Elige desde acá con el
// token de cada proyecto, por el mismo webhook que el enlace del correo.
export default function MisProyectos() {
  const [supabase] = useState(() => createClient());
  const [carga, setCarga] = useState<{
    proyectos: Proyecto[];
    error: string | null;
    ahora: number;
  } | null>(null);
  // Se incrementa para volver a cargar (después de elegir).
  const [version, setVersion] = useState(0);
  const [sinLeer, setSinLeer] = useState<Record<string, number>>({});
  const [charla, setCharla] = useState<{id: string; con: string} | null>(null);

  useEffect(() => {
    if (!supabase) return;

    let vigente = true;

    supabase.rpc("mis_proyectos").then(({data, error}) => {
      if (vigente) {
        setCarga({
          proyectos: data ?? [],
          error: error ? error.message : null,
          ahora: Date.now(),
        });
      }
    });
    supabase.rpc("mensajes_sin_leer").then(({data}) => {
      if (vigente) {
        setSinLeer(Object.fromEntries((data ?? []).map((f) => [f.postulacion_id, f.cantidad])));
      }
    });

    return () => {
      vigente = false;
    };
  }, [supabase, version]);

  if (!supabase) {
    return (
      <p className="text-brick text-[13px]" role="alert">
        Faltan las variables de Supabase.
      </p>
    );
  }

  if (carga === null) return <EsqueletoMisProyectos />;

  if (carga.error) {
    return (
      <p className="text-brick text-[13px]" role="alert">
        {carga.error}
      </p>
    );
  }

  if (carga.proyectos.length === 0) {
    return (
      <p className="text-muted max-w-lg text-[14.5px] leading-relaxed">
        Todavía no publicaste ningún proyecto. Contá qué necesitás y los desarrolladores se postulan
        con precio y plazo.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-6">
      {carga.proyectos.map((p) => (
        <TarjetaProyecto
          key={p.id}
          ahora={carga.ahora}
          proyecto={p}
          sinLeer={sinLeer}
          onElegido={() => setVersion((v) => v + 1)}
          onMensajes={(id, con) => setCharla({id, con})}
        />
      ))}
      {charla && (
        <Conversacion
          con={charla.con}
          postulacionId={charla.id}
          onCerrar={() => {
            setCharla(null);
            // Al cerrar, se actualizan los contadores de no leídos.
            setVersion((v) => v + 1);
          }}
        />
      )}
    </ul>
  );
}
