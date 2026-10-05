"use client";

import type {ServicioTipo} from "@/types/supabase";

import {useEffect, useState} from "react";

import Conversacion from "@/app/components/conversacion";
import {Cargando, Esqueleto} from "@/app/components/esqueleto";
import {
  HEADERS,
  N8N_BASE,
  type Postulacion,
  BotonAlAzar,
  BotonMensajes,
  TarjetaPostulacion,
  elegirAlAzar,
  elegirPostulacion,
  tarjetaClass,
} from "@/app/components/postulaciones";
import {presupuestoDeclarado} from "@/lib/presupuesto";
import {SERVICIO_LEGIBLE} from "@/lib/servicios";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface Pedido {
  status: "ok";
  estado: "ABIERTO" | "EN_ELECCION" | "ASIGNADO" | "VENCIDO";
  servicio: ServicioTipo;
  presupuesto_rango: string | null;
  presupuesto: number;
  resumen: string;
  // Sólo los proyectos que publicó el cliente directo tienen título.
  titulo: string | null;
  cliente_nombre: string;
  elegido_nombre: string | null;
  postulaciones: Postulacion[];
}

type Vista =
  | {tipo: "cargando"}
  | {tipo: "invalido"}
  | {tipo: "pedido"; pedido: Pedido}
  | {tipo: "elegido"; espacio: string};

function Aviso({titulo, children}: {titulo: string; children: React.ReactNode}) {
  return (
    <div className={`${tarjetaClass} flex flex-col gap-4 px-8 py-12 sm:px-11`}>
      <h2 className="text-ink font-serif text-[30px] leading-tight tracking-tight">{titulo}</h2>
      <p className="text-muted max-w-md text-[14.5px] leading-relaxed">{children}</p>
    </div>
  );
}

function EsqueletoEleccion() {
  return (
    <Cargando className="flex flex-col gap-6" etiqueta="Cargando las postulaciones…">
      <div className={`${tarjetaClass} flex flex-col gap-3 px-6 py-5`}>
        <Esqueleto className="h-2.5 w-24" />
        <Esqueleto className="h-5 w-48" />
        <Esqueleto className="h-4 w-full" />
      </div>
      {Array.from({length: 2}, (_, i) => (
        <div key={i} className={`${tarjetaClass} flex flex-col gap-3 px-6 py-5`}>
          <div className="flex justify-between gap-4">
            <Esqueleto className="h-6 w-40" />
            <Esqueleto className="h-6 w-24" />
          </div>
          <Esqueleto className="h-3 w-28" />
          <Esqueleto className="h-4 w-full" />
          <Esqueleto className="h-4 w-4/5" />
          <Esqueleto className="mt-2 h-11 w-44" />
        </div>
      ))}
    </Cargando>
  );
}

export default function ElegirPostulacion({token}: {token: string}) {
  const tokenValido = UUID.test(token) && Boolean(N8N_BASE);
  const [vista, setVista] = useState<Vista>({tipo: "cargando"});
  // Conversación abierta con un postulante (por el token del enlace).
  const [charla, setCharla] = useState<{id: string; con: string} | null>(null);
  const panelCharla = charla && (
    <Conversacion
      con={charla.con}
      postulacionId={charla.id}
      token={token}
      onCerrar={() => setCharla(null)}
    />
  );

  useEffect(() => {
    if (!tokenValido) return;

    const controller = new AbortController();

    fetch(`${N8N_BASE}/webhook/bolsa-postulaciones?t=${encodeURIComponent(token)}`, {
      signal: controller.signal,
      headers: HEADERS,
    })
      .then((res) => (res.ok ? res.json() : {status: "invalido"}))
      .then((json) =>
        setVista(json.status === "ok" ? {tipo: "pedido", pedido: json} : {tipo: "invalido"}),
      )
      .catch((err) => {
        if (err?.name !== "AbortError") setVista({tipo: "invalido"});
      });

    return () => controller.abort();
  }, [token, tokenValido]);

  async function elegir(postulacionId: string) {
    setVista({
      tipo: "elegido",
      espacio: await elegirPostulacion(token, postulacionId),
    });
  }

  if (!tokenValido || vista.tipo === "invalido") {
    return (
      <Aviso titulo="Este enlace no funciona.">
        Puede que esté incompleto. Abrilo de nuevo desde el correo que te mandamos.
      </Aviso>
    );
  }

  if (vista.tipo === "cargando") return <EsqueletoEleccion />;

  if (vista.tipo === "elegido") {
    return (
      <Aviso titulo="¡Listo!">
        Le pasamos tus datos a <b className="text-ink">{vista.espacio}</b>. Te va a escribir con una
        propuesta formal; también te mandamos un correo con este resumen.
      </Aviso>
    );
  }

  const {pedido} = vista;

  if (pedido.estado === "ASIGNADO") {
    const elegida = pedido.postulaciones.find((p) => p.elegida);

    return (
      <>
        <Aviso titulo="Ya elegiste.">
          Este pedido quedó con <b className="text-ink">{pedido.elegido_nombre}</b>, que te va a
          escribir con la propuesta.
        </Aviso>
        {elegida && (
          <div className="mt-6">
            <BotonMensajes onClick={() => setCharla({id: elegida.id, con: elegida.espacio})} />
          </div>
        )}
        {panelCharla}
      </>
    );
  }

  if (pedido.estado === "VENCIDO") {
    return (
      <Aviso titulo="Este pedido venció.">
        Pasó el plazo de la bolsa sin que se eligiera a nadie. Si todavía necesitás ayuda, podés
        volver a escribirnos.
      </Aviso>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <section className={`${tarjetaClass} flex flex-col gap-2 px-6 py-5`}>
        <p className="text-faint text-[10px] tracking-[0.16em] uppercase">Tu pedido</p>
        {pedido.titulo && (
          <p className="text-ink font-serif text-[23px] leading-tight">{pedido.titulo}</p>
        )}
        <p
          className={
            pedido.titulo
              ? "text-muted text-[13px]"
              : "text-ink font-serif text-[21px] leading-tight"
          }
        >
          {SERVICIO_LEGIBLE[pedido.servicio]} ·{" "}
          {presupuestoDeclarado(pedido.presupuesto_rango, Number(pedido.presupuesto))}
        </p>
        <p className="text-muted text-[14px] leading-relaxed">{pedido.resumen}</p>
      </section>

      {pedido.postulaciones.length === 0 ? (
        <Aviso titulo="Todavía no hay postulaciones.">
          Cuando otros desarrolladores se postulen, te avisamos por correo para que elijas.
        </Aviso>
      ) : (
        <>
          <p className="text-muted max-w-xl text-[14.5px] leading-relaxed">
            Hola {pedido.cliente_nombre}: estos desarrolladores quieren hacer tu proyecto. Los
            precios y plazos son estimados; el que elijas te manda después la propuesta formal.
          </p>
          <ul className="flex flex-col gap-4">
            {pedido.postulaciones.map((p) => (
              <TarjetaPostulacion
                key={p.id}
                postulacion={p}
                onElegir={() => elegir(p.id)}
                onMensajes={() => setCharla({id: p.id, con: p.espacio})}
              />
            ))}
          </ul>
          <BotonAlAzar
            cantidad={pedido.postulaciones.length}
            onElegir={async () => setVista({tipo: "elegido", espacio: await elegirAlAzar(token)})}
          />
          {panelCharla}
        </>
      )}
    </div>
  );
}
