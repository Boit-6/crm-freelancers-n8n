import type {Trabajo} from "./dashboard-types";

import TrabajoEstadoSelect from "./trabajo-estado-select";
import {SectionHeader} from "./dashboard-shared";

import {ghostButtonClass, tdClass, thClass} from "@/lib/constants";

// Trabajos activos. Tabla en la PC y tarjetas en el celular; el nombre abre
// el detalle del lead.
export default function DashboardWork({
  trabajos,
  onEstadoCambio,
  onCerrar,
  onCancelar,
  onAbrir,
}: {
  trabajos: Trabajo[];
  onEstadoCambio: (leadId: string, estado: Trabajo["estado_trabajo"]) => void;
  onCerrar: (leadId: string) => void;
  onCancelar: (leadId: string) => void;
  onAbrir: (leadId: string) => void;
}) {
  const acciones = (t: Trabajo) => (
    <>
      {/* El cierre se ofrece recién con el trabajo entregado: es el paso que
          faltaba para que el ciclo termine desde la interfaz y no con una
          petición a mano. */}
      {t.estado_trabajo === "ENTREGADO" && (
        <button className={ghostButtonClass} type="button" onClick={() => onCerrar(t.lead_id)}>
          Cerrar proyecto
        </button>
      )}
      <button className={ghostButtonClass} type="button" onClick={() => onCancelar(t.lead_id)}>
        Cancelar
      </button>
    </>
  );
  const selector = (t: Trabajo) => (
    <TrabajoEstadoSelect
      inicial={t.estado_trabajo}
      leadId={t.lead_id}
      onCambio={(estado) => onEstadoCambio(t.lead_id, estado as Trabajo["estado_trabajo"])}
    />
  );

  return (
    <section>
      <SectionHeader num="I" title="Trabajos activos" />
      {trabajos.length === 0 ? (
        <p className="text-muted text-[13px]">No hay trabajos en curso.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-3 lg:hidden">
            {trabajos.map((t) => (
              <li
                key={t.lead_id}
                className="border-rule-soft bg-card flex flex-col gap-3 border px-4 py-3.5"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <button
                    className="text-ink hover:text-ochre text-left font-serif text-[19px] leading-tight"
                    type="button"
                    onClick={() => onAbrir(t.lead_id)}
                  >
                    {t.nombre}
                  </button>
                  <span className="text-muted shrink-0 text-[12.5px]">
                    {t.servicio?.replace(/_/g, " ")}
                  </span>
                </div>
                {selector(t)}
                <div className="flex flex-wrap gap-3">{acciones(t)}</div>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Trabajos activos</caption>
              <thead>
                <tr>
                  <th className={thClass}>Lead</th>
                  <th className={thClass}>Cliente</th>
                  <th className={thClass}>Servicio</th>
                  <th className={thClass}>Estado del trabajo</th>
                  <th className={`${thClass} pr-0`}>Acción</th>
                </tr>
              </thead>
              <tbody>
                {trabajos.map((t) => (
                  <tr key={t.lead_id}>
                    <td className={`${tdClass} text-mist text-[12.5px]`}>{t.lead_id}</td>
                    <td className={`${tdClass} text-ink font-serif text-[18px]`}>
                      <button
                        className="hover:text-ochre text-left"
                        type="button"
                        onClick={() => onAbrir(t.lead_id)}
                      >
                        {t.nombre}
                      </button>
                    </td>
                    <td className={tdClass}>{t.servicio?.replace(/_/g, " ")}</td>
                    <td className={tdClass}>{selector(t)}</td>
                    <td className={`${tdClass} pr-0`}>
                      <div className="flex justify-end gap-4">{acciones(t)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
