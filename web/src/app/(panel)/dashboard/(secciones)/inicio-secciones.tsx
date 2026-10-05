"use client";

import type {ServicioTipo} from "@/types/supabase";

import Link from "next/link";

import {KpiCard, SectionHeader, formatMoney, formatPct} from "../dashboard-shared";
import {EsqueletoInicio} from "../esqueletos";
import {usePanelDatos} from "../panel-datos";

import {usd} from "@/lib/hitos";
import {presupuestoDeclarado} from "@/lib/presupuesto";
import {SERVICIO_LEGIBLE} from "@/lib/servicios";

// Algo que espera una acción del desarrollador. `accion` es un enlace a la
// sección que lo resuelve o un botón que lo resuelve acá mismo.
interface Pendiente {
  clave: string;
  tipo: string;
  titulo: string;
  detalle: string;
  urgente?: boolean;
  accion: {etiqueta: string} & ({href: string} | {onClick: () => void});
}

// Cuántos días antes del vencimiento una factura pasa a pedir atención.
const DIAS_AVISO_VENCIMIENTO = 3;

const botonAccionClass =
  "ease border-ink text-ink hover:border-ochre hover:text-ochre shrink-0 border px-3.5 py-2 text-[11px] tracking-[0.12em] uppercase transition duration-200";

// `cantidadDisputasAbiertas`: las que el admin de la plataforma puede
// resolver; null para el resto.
export default function InicioSecciones({
  cobrosActivos,
  cantidadDisputasAbiertas = null,
}: {
  cobrosActivos: boolean;
  cantidadDisputasAbiertas?: number | null;
}) {
  const d = usePanelDatos();

  if (d.cargando) return <EsqueletoInicio />;

  const pendientes: Pendiente[] = [
    ...d.facturas
      .filter((f) => f.dias_al_vencimiento < 0)
      .map((f) => ({
        clave: `vencida-${f.factura_id}`,
        tipo: "Factura vencida",
        titulo: f.cliente,
        detalle: `${formatMoney(f.monto)} · venció hace ${Math.abs(f.dias_al_vencimiento)} días`,
        urgente: true,
        accion: {etiqueta: "Ver facturas", href: "/dashboard/facturas"},
      })),
    ...(cantidadDisputasAbiertas
      ? [
          {
            clave: "disputas",
            tipo: "Disputas por resolver",
            titulo:
              cantidadDisputasAbiertas === 1
                ? "Un cliente disputó un hito"
                : `${cantidadDisputasAbiertas} hitos en disputa`,
            detalle: "La plata queda retenida hasta que decidas cuánto va a cada parte.",
            urgente: true,
            accion: {etiqueta: "Revisar", href: "/dashboard/disputas"},
          },
        ]
      : []),
    ...d.hitosPendientes
      .filter((h) => h.estado === "EN_DISPUTA")
      .map((h) => ({
        clave: `disputa-${h.id}`,
        tipo: "Hito en disputa",
        titulo: h.cliente,
        detalle: `${h.orden}. ${h.titulo} · ${usd(h.monto)}${h.disputa_motivo ? ` · “${h.disputa_motivo}”` : ""}`,
        urgente: true,
        accion: {
          etiqueta: "Ver proyecto",
          onClick: () => d.abrirLead(h.lead_id),
        },
      })),
    ...d.pedidos.map((p) => ({
      clave: `cambio-${p.lead_id}`,
      tipo: "Pidió cambios",
      titulo: p.nombre,
      detalle: p.notas ? `“${p.notas}”` : "",
      urgente: true,
      accion: {etiqueta: "Responder", onClick: () => d.abrirLead(p.lead_id)},
    })),
    ...d.porEnviar.map((l) => ({
      clave: `propuesta-${l.lead_id}`,
      tipo: "Propuesta por enviar",
      titulo: l.nombre,
      detalle: `${l.tier} · ${SERVICIO_LEGIBLE[l.servicio as ServicioTipo] ?? l.servicio.replace(/_/g, " ")} · declaró ${presupuestoDeclarado(l.presupuesto_rango, l.presupuesto)}`,
      urgente: l.tier === "HOT",
      accion: {
        etiqueta: "Fijar términos",
        onClick: () => d.abrirLead(l.lead_id),
      },
    })),
    ...d.hitosPendientes
      .filter((h) => h.estado === "FONDEADO")
      .map((h) => ({
        clave: `hito-${h.id}`,
        tipo: "Hito pagado",
        titulo: h.cliente,
        detalle: `${h.orden}. ${h.titulo} · ${usd(h.monto)} retenidos hasta que entregues`,
        accion: {
          etiqueta: "Entregar",
          onClick: () => d.abrirLead(h.lead_id),
        },
      })),
    ...d.trabajos
      .filter((t) => t.estado_trabajo === "ENTREGADO")
      .map((t) => ({
        clave: `entregado-${t.lead_id}`,
        tipo: "Trabajo entregado",
        titulo: t.nombre,
        detalle: "Listo para cerrar el proyecto",
        accion: {
          etiqueta: "Cerrar proyecto",
          onClick: () => d.cerrarProyecto(t.lead_id),
        },
      })),
    ...d.facturas
      .filter((f) => f.dias_al_vencimiento >= 0 && f.dias_al_vencimiento <= DIAS_AVISO_VENCIMIENTO)
      .map((f) => ({
        clave: `vence-${f.factura_id}`,
        tipo: "Vence pronto",
        titulo: f.cliente,
        detalle: `${formatMoney(f.monto)} · ${
          f.dias_al_vencimiento === 0 ? "vence hoy" : `vence en ${f.dias_al_vencimiento} días`
        }`,
        accion: {etiqueta: "Ver facturas", href: "/dashboard/facturas"},
      })),
    ...(cobrosActivos
      ? []
      : [
          {
            clave: "cobros",
            tipo: "Cobros online",
            titulo: "Todavía no activaste Stripe",
            detalle: "Sin eso, tus clientes no pueden pagar las facturas en línea.",
            accion: {etiqueta: "Activar", href: "/dashboard/espacio"},
          },
        ]),
  ];

  // Lo urgente primero; dentro de cada grupo se mantiene el orden de arriba.
  pendientes.sort((a, b) => Number(b.urgente ?? false) - Number(a.urgente ?? false));

  const m = d.metrics;

  return (
    <div className="flex flex-col gap-14">
      <section aria-label="Indicadores del mes">
        <div className="grid grid-cols-2 gap-x-8 gap-y-8 lg:grid-cols-4">
          <KpiCard label="Leads del mes" value={m ? String(m.total_leads) : "—"} />
          <KpiCard label="Conversión" value={formatPct(m?.conversion_pct)} />
          <KpiCard label="Cobrado este mes" value={formatMoney(m?.cobrado)} />
          <KpiCard
            alert={!!m && m.facturas_vencidas > 0}
            label="Por cobrar"
            nota={
              m && m.facturas_vencidas > 0
                ? `${m.facturas_vencidas} ${m.facturas_vencidas === 1 ? "vencida" : "vencidas"}`
                : undefined
            }
            value={formatMoney(m?.pendiente)}
          />
        </div>
      </section>

      <section>
        <SectionHeader
          num="I"
          title={`Requiere tu atención${pendientes.length ? ` (${pendientes.length})` : ""}`}
        />
        {pendientes.length === 0 ? (
          <p className="text-muted font-serif text-[20px] italic">Estás al día.</p>
        ) : (
          <ul className="border-rule-soft bg-card divide-rule-soft divide-y border">
            {pendientes.map((p) => (
              <li
                key={p.clave}
                className={`flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 ${
                  p.urgente ? "border-l-brick border-l-2" : ""
                }`}
              >
                <div className="min-w-0">
                  <p
                    className={`text-[10px] tracking-[0.16em] uppercase ${
                      p.urgente ? "text-brick" : "text-ochre"
                    }`}
                  >
                    {p.tipo}
                  </p>
                  <p className="text-ink mt-1 font-serif text-[19px] leading-tight">{p.titulo}</p>
                  {p.detalle && (
                    <p className="text-muted mt-1 line-clamp-2 text-[13px]">{p.detalle}</p>
                  )}
                </div>
                {"href" in p.accion ? (
                  <Link
                    className={`${botonAccionClass} self-start sm:self-auto`}
                    href={p.accion.href}
                  >
                    {p.accion.etiqueta}
                  </Link>
                ) : (
                  <button
                    className={`${botonAccionClass} self-start sm:self-auto`}
                    type="button"
                    onClick={p.accion.onClick}
                  >
                    {p.accion.etiqueta}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
