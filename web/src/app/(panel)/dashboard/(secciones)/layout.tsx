import type {ReactNode} from "react";

import {redirect} from "next/navigation";

import PanelDatosProvider from "../panel-datos";

import {getPanelUser} from "@/lib/auth";

// Secciones del panel (Inicio, Leads, Facturas, Trabajos, Tickets). Una
// cuenta recién confirmada primero elige nombre y dirección. Los datos del
// tablero se cargan acá una sola vez y se comparten entre las pestañas.
export default async function SeccionesLayout({children}: {children: ReactNode}) {
  const {espacio} = await getPanelUser();

  if (!espacio.configurado_en) redirect("/dashboard/espacio");

  return <PanelDatosProvider>{children}</PanelDatosProvider>;
}
