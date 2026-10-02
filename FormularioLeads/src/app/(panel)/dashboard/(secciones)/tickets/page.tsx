import EncabezadoPagina from "../../encabezado-pagina";

import TicketsBoard from "./tickets-board";

export default function TicketsPage() {
  return (
    <>
      <EncabezadoPagina titulo="Tickets" />
      <TicketsBoard />
    </>
  );
}
