import EncabezadoPagina from "../../encabezado-pagina";

import BolsaTablero from "./bolsa-tablero";

import {getPanelUser} from "@/lib/auth";

export default async function BolsaPage() {
  const {espacio} = await getPanelUser();

  return (
    <>
      <EncabezadoPagina
        bajada="Pedidos que otros desarrolladores no pudieron tomar. Los datos del cliente se ven recién si te elige."
        titulo="Bolsa"
      />
      <BolsaTablero misServicios={espacio.servicios} />
    </>
  );
}
