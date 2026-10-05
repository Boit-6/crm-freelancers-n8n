"use client";

import DashboardWork from "../../dashboard-work";
import EncabezadoPagina from "../../encabezado-pagina";
import {EsqueletoTrabajos} from "../../esqueletos";
import {usePanelDatos} from "../../panel-datos";

export default function TrabajosPage() {
  const d = usePanelDatos();

  return (
    <>
      <EncabezadoPagina titulo="Trabajos" />
      {d.cargando ? (
        <EsqueletoTrabajos />
      ) : (
        <DashboardWork
          trabajos={d.trabajos}
          onAbrir={d.abrirLead}
          onCancelar={d.cancelar}
          onCerrar={d.cerrarProyecto}
          onEstadoCambio={d.cambiarEstadoTrabajo}
        />
      )}
    </>
  );
}
