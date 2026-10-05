"use client";

import type {Database, Proyecto} from "@/types/supabase";

import {useCallback, useEffect, useRef, useState} from "react";

import FormPropuesta, {type HitosPropuesta} from "./form-propuesta";
import HitosDesarrollador from "./hitos-desarrollador";
import RechazoPedido from "./rechazo-pedido";
import {Tag, formatDate, formatMoney} from "./dashboard-shared";
import {ESTADO_COLOR, TIER_COLOR} from "./dashboard-types";
import {EsqueletoLeadDetalle} from "./esqueletos";

import {ghostButtonClass} from "@/lib/constants";
import {presupuestoDeclarado} from "@/lib/presupuesto";
import {createClient} from "@/lib/supabase/client";

type LeadCompleto = Pick<
  Database["public"]["Tables"]["leads"]["Row"],
  | "lead_id"
  | "nombre"
  | "email"
  | "telefono"
  | "servicio"
  | "urgencia"
  | "presupuesto"
  | "presupuesto_rango"
  | "descripcion"
  | "estado"
  | "estado_trabajo"
  | "tier"
  | "score"
  | "notas"
  | "fecha_ingreso"
  | "fecha_propuesta"
  | "precio_propuesto"
  | "plazo_propuesto"
  | "alcance_propuesto"
  | "compartir_bolsa"
>;

const COLUMNAS =
  "lead_id,nombre,email,telefono,servicio,urgencia,presupuesto,presupuesto_rango,descripcion,estado,estado_trabajo,tier,score,notas,fecha_ingreso,fecha_propuesta,precio_propuesto,plazo_propuesto,alcance_propuesto,compartir_bolsa";

const URGENCIA: Record<string, string> = {
  alta: "Lo antes posible",
  media: "Próximas semanas",
  baja: "Sin apuro",
};

function Dato({etiqueta, children}: {etiqueta: string; children: React.ReactNode}) {
  return (
    <div>
      <dt className="text-faint mb-1 text-[10px] tracking-[0.16em] uppercase">{etiqueta}</dt>
      <dd className="text-ink-soft text-[14px]">{children}</dd>
    </div>
  );
}

// Detalle de un lead en un panel lateral (a pantalla completa en el celular).
// Es un <dialog> modal nativo: ya maneja el foco, Escape y el orden de
// tabulación. Desde acá se fija la propuesta o se responde un pedido de
// cambio, las dos cosas que antes vivían sueltas en el tablero.
export default function LeadDetalle({
  leadId,
  onCerrar,
  onEnviarPropuesta,
  onAceptarCambio,
  onRechazarCambio,
  onRechazarPedido,
}: {
  leadId: string;
  onCerrar: () => void;
  onEnviarPropuesta: (
    leadId: string,
    precio: number,
    plazo: string,
    alcance: string,
    hitos: HitosPropuesta,
  ) => Promise<void>;
  onAceptarCambio: (leadId: string) => Promise<boolean>;
  onRechazarCambio: (leadId: string) => Promise<boolean>;
  onRechazarPedido: (
    leadId: string,
    destino: "bolsa" | "descartar",
    resumen: string,
  ) => Promise<boolean>;
}) {
  const [supabase] = useState(() => createClient());
  const [lead, setLead] = useState<LeadCompleto | null>(null);
  // Cobro por hitos (etapa 11): si llegó por la plataforma y los hitos que
  // tiene. Si falla, el detalle se muestra igual, como un lead propio.
  const [proyecto, setProyecto] = useState<Proyecto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  // Se vuelve a pedir después de cada acción sobre un hito.
  const cargarProyecto = useCallback(() => {
    supabase?.rpc("ver_proyecto", {p_lead: leadId}).then(({data}) => {
      if (data) setProyecto(data);
    });
  }, [leadId, supabase]);

  useEffect(() => {
    if (!supabase) return;

    let vigente = true;

    supabase
      .from("leads")
      .select(COLUMNAS)
      .eq("lead_id", leadId)
      .maybeSingle()
      .then(({data, error: err}) => {
        if (!vigente) return;
        if (err || !data) setError("No se pudo cargar el lead.");
        else setLead(data);
      });

    cargarProyecto();

    return () => {
      vigente = false;
    };
  }, [cargarProyecto, leadId, supabase]);

  const porEnviar = lead?.estado === "NUEVO" && (lead.tier === "HOT" || lead.tier === "WARM");
  const pedidoCambio = lead?.estado === "EN_SEGUIMIENTO" && Boolean(lead.notas);
  // Mismos estados que acepta Postgres - Rechazar Pedido: después de aceptado
  // ya es un trabajo, y se cancela desde Trabajos.
  const rechazable =
    lead?.estado === "NUEVO" ||
    lead?.estado === "PROPUESTA_ENVIADA" ||
    lead?.estado === "EN_SEGUIMIENTO";

  return (
    // El clic en el fondo cae sobre el propio <dialog> (el contenido lo tapa
    // en todo lo demás): es la forma de cerrarlo tocando afuera.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={dialogRef}
      aria-labelledby="lead-detalle-titulo"
      className="bg-paper text-ink backdrop:bg-ink/30 m-0 ml-auto h-dvh max-h-none w-full max-w-none p-0 sm:max-w-md sm:shadow-[-12px_0_40px_-20px_rgba(25,23,19,0.4)]"
      onClick={(e) => {
        if (e.target === dialogRef.current) dialogRef.current?.close();
      }}
      onClose={onCerrar}
    >
      <div className="flex min-h-full flex-col">
        <div className="border-rule-soft bg-card sticky top-0 z-10 flex items-center justify-between border-b px-6 py-4">
          <span className="text-mist text-[12px]">{leadId}</span>
          <button
            className="text-muted hover:text-ochre text-[11px] tracking-[0.16em] uppercase"
            type="button"
            onClick={() => dialogRef.current?.close()}
          >
            Cerrar ✕
          </button>
        </div>

        {error && (
          <p className="text-brick px-6 py-8 text-[13px]" role="alert">
            {error}
          </p>
        )}

        {!lead && !error && <EsqueletoLeadDetalle />}

        {lead && (
          <div className="flex flex-col gap-8 px-6 py-7">
            <div>
              <h2
                className="text-ink font-serif text-[30px] leading-tight tracking-tight"
                id="lead-detalle-titulo"
              >
                {lead.nombre}
              </h2>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                <Tag className={ESTADO_COLOR[lead.estado]}>{lead.estado.replace(/_/g, " ")}</Tag>
                {lead.tier && (
                  <Tag className={TIER_COLOR[lead.tier]}>
                    {lead.tier} · {lead.score}
                  </Tag>
                )}
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-x-6 gap-y-5">
              <div className="col-span-2">
                <Dato etiqueta="Email">
                  <a
                    className="text-ochre hover:text-ochre-deep underline-offset-2 hover:underline"
                    href={`mailto:${lead.email}`}
                  >
                    {lead.email}
                  </a>
                </Dato>
              </div>
              <Dato etiqueta="Teléfono">{lead.telefono || "—"}</Dato>
              <Dato etiqueta="Ingresó">{formatDate(lead.fecha_ingreso)}</Dato>
              <Dato etiqueta="Servicio">{lead.servicio.replace(/_/g, " ")}</Dato>
              <Dato etiqueta="Urgencia">{URGENCIA[lead.urgencia] ?? lead.urgencia}</Dato>
              <div className="col-span-2">
                <Dato etiqueta="Presupuesto declarado">
                  {presupuestoDeclarado(lead.presupuesto_rango, lead.presupuesto)}
                </Dato>
              </div>
            </dl>

            {lead.descripcion && (
              <div>
                <p className="text-faint mb-2 text-[10px] tracking-[0.16em] uppercase">
                  Descripción
                </p>
                <p className="text-ink-soft text-[14.5px] leading-relaxed whitespace-pre-line">
                  {lead.descripcion}
                </p>
              </div>
            )}

            {lead.precio_propuesto != null && (
              <div className="border-rule-soft border-t pt-6">
                <p className="text-faint mb-3 text-[10px] tracking-[0.16em] uppercase">
                  Propuesta enviada{" "}
                  {lead.fecha_propuesta && `· ${formatDate(lead.fecha_propuesta)}`}
                </p>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
                  <Dato etiqueta="Precio">{formatMoney(lead.precio_propuesto)}</Dato>
                  <Dato etiqueta="Plazo">{lead.plazo_propuesto || "—"}</Dato>
                  {lead.alcance_propuesto && (
                    <div className="col-span-2">
                      <Dato etiqueta="Alcance">{lead.alcance_propuesto}</Dato>
                    </div>
                  )}
                </dl>
                {proyecto?.cobro_modo === "hitos" && proyecto.hitos.length > 0 && (
                  <HitosDesarrollador proyecto={proyecto} onCambio={cargarProyecto} />
                )}
              </div>
            )}

            {porEnviar && (
              <section className="border-ochre bg-card border-l-2 px-5 py-5">
                <h3 className="text-ink mb-4 font-serif text-[20px]">Fijá los términos</h3>
                <FormPropuesta
                  dePlataforma={proyecto?.de_plataforma ?? false}
                  onEnviar={async (precio, plazo, alcance, hitos) => {
                    await onEnviarPropuesta(lead.lead_id, precio, plazo, alcance, hitos);
                    dialogRef.current?.close();
                  }}
                />
              </section>
            )}

            {pedidoCambio && (
              <section className="border-ochre bg-card border-l-2 px-5 py-5">
                <h3 className="text-ink mb-3 font-serif text-[20px]">Pidió cambios</h3>
                <p className="text-ink-soft font-serif text-[18px] leading-relaxed italic">
                  {lead.notas}
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    className="ease bg-ink text-paper hover:bg-ochre px-5 py-3 text-[11px] tracking-[0.14em] uppercase transition duration-200"
                    type="button"
                    onClick={async () => {
                      if (await onAceptarCambio(lead.lead_id)) dialogRef.current?.close();
                    }}
                  >
                    Aceptar y reenviar
                  </button>
                  <button
                    className={ghostButtonClass}
                    type="button"
                    onClick={async () => {
                      if (await onRechazarCambio(lead.lead_id)) dialogRef.current?.close();
                    }}
                  >
                    Rechazar
                  </button>
                </div>
              </section>
            )}

            {rechazable && (
              <RechazoPedido
                compartirBolsa={lead.compartir_bolsa}
                descripcion={lead.descripcion ?? ""}
                onRechazar={async (destino, resumen) => {
                  if (await onRechazarPedido(lead.lead_id, destino, resumen)) {
                    dialogRef.current?.close();
                  }
                }}
              />
            )}
          </div>
        )}
      </div>
    </dialog>
  );
}
