"use client";

import {usePathname} from "next/navigation";

import {
  EsqueletoBolsa,
  EsqueletoEncabezado,
  EsqueletoEspacio,
  EsqueletoFacturas,
  EsqueletoInicio,
  EsqueletoLeads,
  EsqueletoPanel,
  EsqueletoTickets,
  EsqueletoTrabajos,
} from "./dashboard/esqueletos";

const POR_SECCION = [
  {ruta: "/dashboard/leads", esqueleto: <EsqueletoLeads />},
  {ruta: "/dashboard/facturas", esqueleto: <EsqueletoFacturas />},
  {ruta: "/dashboard/trabajos", esqueleto: <EsqueletoTrabajos />},
  {ruta: "/dashboard/tickets", esqueleto: <EsqueletoTickets />},
  {ruta: "/dashboard/bolsa", esqueleto: <EsqueletoBolsa />},
];

// Envuelve el layout del panel, que verifica la sesión antes de pintar nada:
// mientras tanto se ve la forma del panel, con el contenido de la sección que
// se está abriendo. Es de cliente sólo para saber la ruta.
export default function PanelLoading() {
  const pathname = usePathname();

  if (pathname.startsWith("/dashboard/espacio")) {
    return <EsqueletoPanel contenido={<EsqueletoEspacio />} />;
  }

  const seccion = POR_SECCION.find((s) => pathname.startsWith(s.ruta));

  return (
    <EsqueletoPanel
      contenido={
        <>
          <EsqueletoEncabezado />
          {seccion?.esqueleto ?? <EsqueletoInicio />}
        </>
      }
    />
  );
}
