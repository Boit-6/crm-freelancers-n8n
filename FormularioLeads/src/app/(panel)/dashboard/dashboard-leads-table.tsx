"use client";

import type {Lead, LeadEstado} from "./dashboard-types";

import {useState} from "react";

import {SectionHeader, Tag, formatDate} from "./dashboard-shared";
import {ESTADO_COLOR, FUNNEL_ORDER, LEADS_LIMITE, TIER_COLOR} from "./dashboard-types";

import {tdClass, thClass} from "@/lib/constants";
import {presupuestoDeclarado} from "@/lib/presupuesto";

const POR_PAGINA = 15;

const chipClass =
  "ease border px-3 py-1.5 text-[11px] tracking-[0.1em] uppercase transition duration-200";

// Leads recientes: filtro por estado, búsqueda y paginado, todo en cliente
// sobre los LEADS_LIMITE más recientes que ya trajo el coordinador. Tabla en
// la PC y tarjetas en el celular; tocar un lead abre su detalle.
export default function DashboardLeadsTable({
  leads,
  onAbrir,
}: {
  leads: Lead[];
  onAbrir: (leadId: string) => void;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [estado, setEstado] = useState<LeadEstado | null>(null);
  const [pagina, setPagina] = useState(0);

  const porEstado = leads.reduce<Partial<Record<LeadEstado, number>>>((acc, l) => {
    acc[l.estado] = (acc[l.estado] ?? 0) + 1;

    return acc;
  }, {});
  const delEstado = estado ? leads.filter((l) => l.estado === estado) : leads;
  const q = busqueda.toLowerCase().trim();
  // Se busca también por email: es el dato que el cliente da por teléfono, y
  // antes buscarlo devolvía "sin resultados" aunque el lead estuviera cargado.
  const leadsFiltrados = q
    ? delEstado.filter(
        (l) =>
          l.nombre.toLowerCase().includes(q) ||
          l.lead_id.toLowerCase().includes(q) ||
          l.email.toLowerCase().includes(q),
      )
    : delEstado;
  // La consulta trae los 200 leads más recientes. La búsqueda es en cliente, de
  // modo que sólo alcanza a esos 200: hay que decirlo, porque un "sin
  // resultados" sobre un lead que sí existe es peor que no tener buscador.
  const leadsTopeados = leads.length >= LEADS_LIMITE;
  const totalPaginas = Math.max(1, Math.ceil(leadsFiltrados.length / POR_PAGINA));
  const pag = Math.min(pagina, totalPaginas - 1);
  const leadsPagina = leadsFiltrados.slice(pag * POR_PAGINA, (pag + 1) * POR_PAGINA);

  return (
    <section>
      <SectionHeader num="I" title="Leads recientes" />
      <div aria-label="Filtrar por estado" className="mb-5 flex flex-wrap gap-2" role="group">
        {[null, ...FUNNEL_ORDER].map((e) => {
          const activo = estado === e;
          const cantidad = e ? (porEstado[e] ?? 0) : leads.length;

          if (e && cantidad === 0) return null;

          return (
            <button
              key={e ?? "todos"}
              aria-pressed={activo}
              className={`${chipClass} ${
                activo
                  ? "border-ochre bg-ochre/5 text-ochre-deep"
                  : "border-rule text-muted hover:border-mist"
              }`}
              type="button"
              onClick={() => {
                setEstado(e);
                setPagina(0);
              }}
            >
              {e ? e.replace(/_/g, " ") : "Todos"} · {cantidad}
            </button>
          );
        })}
      </div>
      <div className="relative mb-6 max-w-sm">
        <svg
          aria-hidden="true"
          className="text-mist pointer-events-none absolute top-3.5 left-3"
          fill="none"
          height={14}
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.6}
          viewBox="0 0 24 24"
          width={14}
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.6-3.6" />
        </svg>
        <input
          aria-label="Buscar leads por nombre, email o ID"
          className="ease border-rule bg-card text-ink placeholder-mist focus:border-ochre w-full border py-2.5 pr-3 pl-9 text-[13.5px] transition duration-200 outline-none"
          placeholder="Buscar por nombre, email o ID…"
          type="search"
          value={busqueda}
          onChange={(e) => {
            setBusqueda(e.target.value);
            setPagina(0);
          }}
        />
      </div>
      {leadsTopeados && (
        <p className="text-mist mb-4 text-[12px]">
          La búsqueda alcanza a los {LEADS_LIMITE} leads más recientes, que son los que muestra esta
          tabla. El embudo de abajo sí cuenta el histórico completo.
        </p>
      )}
      {leadsFiltrados.length === 0 ? (
        <p className="text-muted text-[13px]">
          {busqueda ? "Sin resultados para esa búsqueda." : "Sin leads para mostrar."}
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-3 lg:hidden">
            {leadsPagina.map((lead) => (
              <li key={lead.lead_id}>
                <button
                  className="ease border-rule-soft bg-card hover:border-ochre flex w-full flex-col gap-2 border px-4 py-3.5 text-left transition duration-200"
                  type="button"
                  onClick={() => onAbrir(lead.lead_id)}
                >
                  <span className="flex w-full items-baseline justify-between gap-3">
                    <span className="text-ink font-serif text-[19px] leading-tight">
                      {lead.nombre}
                    </span>
                    <span className="text-mist shrink-0 text-[12px]">
                      {formatDate(lead.fecha_ingreso)}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-x-3 gap-y-1">
                    <Tag className={ESTADO_COLOR[lead.estado]}>
                      {lead.estado.replace(/_/g, " ")}
                    </Tag>
                    {lead.tier && <Tag className={TIER_COLOR[lead.tier]}>{lead.tier}</Tag>}
                  </span>
                  <span className="text-muted text-[13px]">
                    {lead.servicio?.replace(/_/g, " ")} ·{" "}
                    {presupuestoDeclarado(lead.presupuesto_rango, lead.presupuesto)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Leads recientes</caption>
              <thead>
                <tr>
                  <th className={thClass}>Lead</th>
                  <th className={thClass}>Nombre</th>
                  <th className={thClass}>Servicio</th>
                  <th className={thClass}>Estado</th>
                  <th className={thClass}>Tier</th>
                  <th className={`${thClass} text-right`}>Presupuesto</th>
                  <th className={`${thClass} pr-0 text-right`}>Ingreso</th>
                </tr>
              </thead>
              <tbody>
                {leadsPagina.map((lead) => (
                  <tr
                    key={lead.lead_id}
                    className="hover:bg-card cursor-pointer transition duration-200"
                    onClick={() => onAbrir(lead.lead_id)}
                  >
                    <td className={`${tdClass} text-mist text-[12.5px]`}>{lead.lead_id}</td>
                    <td className={`${tdClass} text-ink font-serif text-[18px]`}>
                      {/* El botón es el que llega con el teclado; el clic en
                          el resto de la fila es un atajo para el mouse. */}
                      <button
                        className="hover:text-ochre text-left"
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAbrir(lead.lead_id);
                        }}
                      >
                        {lead.nombre}
                      </button>
                    </td>
                    <td className={tdClass}>{lead.servicio?.replace(/_/g, " ")}</td>
                    <td className={tdClass}>
                      <Tag className={lead.estado ? ESTADO_COLOR[lead.estado] : "text-mist"}>
                        {lead.estado?.replace(/_/g, " ")}
                      </Tag>
                    </td>
                    <td className={tdClass}>
                      <Tag className={lead.tier ? TIER_COLOR[lead.tier] : "text-mist"}>
                        {lead.tier ?? "—"}
                      </Tag>
                    </td>
                    <td className={`${tdClass} text-ink text-right`}>
                      {presupuestoDeclarado(lead.presupuesto_rango, lead.presupuesto)}
                    </td>
                    <td className={`${tdClass} text-mist pr-0 text-right`}>
                      {formatDate(lead.fecha_ingreso)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPaginas > 1 && (
            <div className="text-faint mt-6 flex items-center justify-between text-[11px] tracking-[0.12em] uppercase">
              <button
                className="ease border-rule hover:border-ochre hover:text-ochre border px-3.5 py-2 transition duration-200 disabled:cursor-not-allowed disabled:opacity-30"
                disabled={pag === 0}
                type="button"
                onClick={() => setPagina((p) => Math.max(0, p - 1))}
              >
                ← Anterior
              </button>
              <span className="text-muted">
                Página {pag + 1} de {totalPaginas} · {leadsFiltrados.length} leads
              </span>
              <button
                className="ease border-rule hover:border-ochre hover:text-ochre border px-3.5 py-2 transition duration-200 disabled:cursor-not-allowed disabled:opacity-30"
                disabled={pag >= totalPaginas - 1}
                type="button"
                onClick={() => setPagina((p) => Math.min(totalPaginas - 1, p + 1))}
              >
                Siguiente →
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
