"use client";

import DashboardEmbudo from "../../dashboard-embudo";
import DashboardLeadsTable from "../../dashboard-leads-table";
import EncabezadoPagina from "../../encabezado-pagina";
import {EsqueletoLeads} from "../../esqueletos";
import {usePanelDatos} from "../../panel-datos";

export default function LeadsPage() {
  const {cargando, leads, funnel, abrirLead} = usePanelDatos();

  return (
    <>
      <EncabezadoPagina titulo="Leads" />
      {cargando ? (
        <EsqueletoLeads />
      ) : (
        <div className="flex flex-col gap-14">
          <DashboardLeadsTable leads={leads} onAbrir={abrirLead} />
          <DashboardEmbudo funnel={funnel} />
        </div>
      )}
    </>
  );
}
