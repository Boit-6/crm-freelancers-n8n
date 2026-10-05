import {notFound} from "next/navigation";

import EncabezadoPagina from "../../encabezado-pagina";

import DisputasTablero from "./disputas-tablero";

import {esAdminPlataforma, getPanelUser} from "@/lib/auth";

// Sólo el admin de la plataforma: para cualquier otra cuenta, la página no
// existe (la base igual rechaza las funciones de disputas).
export default async function DisputasPage() {
  const {user} = await getPanelUser();

  if (!(await esAdminPlataforma(user.id))) notFound();

  return (
    <>
      <EncabezadoPagina
        bajada="Hitos que un cliente disputó. La plata queda retenida hasta que decidas cuánto va a cada parte."
        titulo="Disputas"
      />
      <DisputasTablero />
    </>
  );
}
