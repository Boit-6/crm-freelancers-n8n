import type {ReactNode} from "react";

import {Cargando, Esqueleto} from "@/app/components/esqueleto";

// Esqueletos del panel. Cada uno copia la forma de la pantalla que reemplaza
// (mismas grillas, alturas y cortes para el celular), así el contenido entra
// sin mover nada de lugar.

const tarjetaClass = "border-rule-soft bg-card border";

export function EsqueletoEncabezado() {
  return (
    <div className="border-rule mb-10 border-b pb-7">
      <Esqueleto className="h-[clamp(2.2rem,5vw,3rem)] w-44" />
    </div>
  );
}

function EsqueletoTituloSeccion() {
  return (
    <div className="mb-7 flex items-center gap-3">
      <Esqueleto className="h-4 w-4" />
      <Esqueleto className="h-2.5 w-36" />
      <div className="bg-rule-soft h-px flex-1" />
    </div>
  );
}

export function EsqueletoKpis() {
  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-8 lg:grid-cols-4">
      {Array.from({length: 4}, (_, i) => (
        <div key={i} className="border-rule border-t pt-3.5">
          <Esqueleto className="mb-3 h-2.5 w-20" />
          <Esqueleto className="h-9 w-24" />
        </div>
      ))}
    </div>
  );
}

// Lista de «Requiere tu atención»: tipo, título y detalle a la izquierda, el
// botón a la derecha (abajo en el celular).
function EsqueletoPendientes() {
  return (
    <ul className={`${tarjetaClass} divide-rule-soft divide-y`}>
      {Array.from({length: 4}, (_, i) => (
        <li
          key={i}
          className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex flex-col gap-2">
            <Esqueleto className="h-2.5 w-28" />
            <Esqueleto className="h-5 w-48" />
            <Esqueleto className="h-3 w-64 max-w-full" />
          </div>
          <Esqueleto className="h-9 w-32 shrink-0" />
        </li>
      ))}
    </ul>
  );
}

export function EsqueletoInicio() {
  return (
    <Cargando className="flex flex-col gap-14" etiqueta="Cargando el inicio…">
      <EsqueletoKpis />
      <section>
        <EsqueletoTituloSeccion />
        <EsqueletoPendientes />
      </section>
    </Cargando>
  );
}

// Tarjetas en el celular y filas de tabla en la PC, como los listados reales.
export function EsqueletoListado({
  columnas = 6,
  filtros = false,
}: {
  columnas?: number;
  filtros?: boolean;
}) {
  return (
    <section>
      <EsqueletoTituloSeccion />
      {filtros && (
        <div className="mb-5 flex flex-wrap gap-2">
          {["w-16", "w-20", "w-32", "w-24"].map((ancho) => (
            <Esqueleto key={ancho} className={`h-7 ${ancho}`} />
          ))}
        </div>
      )}
      {filtros && <Esqueleto className="mb-6 h-[42px] w-full max-w-sm" />}
      <ul className="flex flex-col gap-3 lg:hidden">
        {Array.from({length: 5}, (_, i) => (
          <li key={i} className={`${tarjetaClass} flex flex-col gap-2.5 px-4 py-3.5`}>
            <div className="flex items-center justify-between gap-3">
              <Esqueleto className="h-5 w-40" />
              <Esqueleto className="h-3 w-16" />
            </div>
            <Esqueleto className="h-2.5 w-28" />
            <Esqueleto className="h-3 w-48" />
          </li>
        ))}
      </ul>
      <div className="hidden lg:block">
        <div className="border-rule flex gap-5 border-b py-3">
          {Array.from({length: columnas}, (_, i) => (
            <Esqueleto key={i} className="h-2.5 flex-1" />
          ))}
        </div>
        {Array.from({length: 8}, (_, fila) => (
          <div key={fila} className="border-rule-soft flex items-center gap-5 border-b py-4">
            {Array.from({length: columnas}, (_, i) => (
              <Esqueleto key={i} className={`flex-1 ${i === 1 ? "h-5" : "h-3.5"}`} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

export function EsqueletoLeads() {
  return (
    <Cargando etiqueta="Cargando los leads…">
      <EsqueletoListado filtros columnas={7} />
    </Cargando>
  );
}

export function EsqueletoFacturas() {
  return (
    <Cargando className="flex flex-col gap-14" etiqueta="Cargando las facturas…">
      <EsqueletoKpis />
      <EsqueletoListado columnas={7} />
    </Cargando>
  );
}

export function EsqueletoTrabajos() {
  return (
    <Cargando etiqueta="Cargando los trabajos…">
      <EsqueletoListado columnas={5} />
    </Cargando>
  );
}

function EsqueletoTicket() {
  return (
    <div className="bg-card border-rule flex flex-col gap-2.5 border-l-2 p-3.5">
      <div className="flex justify-between">
        <Esqueleto className="h-2.5 w-12" />
        <Esqueleto className="h-2.5 w-6" />
      </div>
      <Esqueleto className="h-4 w-full" />
      <Esqueleto className="h-2.5 w-24" />
      <Esqueleto className="mt-1 h-9 w-full" />
    </div>
  );
}

export function EsqueletoTickets() {
  return (
    <Cargando className="flex flex-col gap-8" etiqueta="Cargando los tickets…">
      <div className="flex justify-end max-lg:hidden">
        <Esqueleto className="h-10 w-40" />
      </div>
      <div className="border-rule grid grid-cols-4 gap-2 border-b pb-3 lg:hidden">
        {Array.from({length: 4}, (_, i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <Esqueleto className="h-2.5 w-14" />
            <Esqueleto className="h-4 w-4" />
          </div>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-4">
        {Array.from({length: 4}, (_, col) => (
          <div
            key={col}
            className={`lg:border-rule flex-col gap-3 lg:border-t-2 lg:p-2 lg:pt-4 ${
              col === 0 ? "flex" : "hidden lg:flex"
            }`}
          >
            <div className="hidden justify-between px-1 lg:flex">
              <Esqueleto className="h-2.5 w-20" />
              <Esqueleto className="h-2.5 w-4" />
            </div>
            {Array.from({length: col === 0 ? 3 : 2 - (col % 2)}, (_, i) => (
              <EsqueletoTicket key={i} />
            ))}
          </div>
        ))}
      </div>
    </Cargando>
  );
}

export function EsqueletoBolsa() {
  return (
    <Cargando className="flex flex-col gap-6" etiqueta="Cargando la bolsa…">
      <div className="border-rule grid grid-cols-3 border-b pb-3 sm:flex sm:gap-4">
        {["w-24", "w-36", "w-32"].map((ancho) => (
          <div key={ancho} className="flex flex-col items-center gap-1.5 sm:block">
            <Esqueleto className={`h-3 max-w-full ${ancho}`} />
            <Esqueleto className="h-4 w-4 sm:hidden" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({length: 4}, (_, i) => (
          <div key={i} className={`${tarjetaClass} flex flex-col gap-3 px-5 py-4`}>
            <div className="flex justify-between gap-4">
              <Esqueleto className="h-6 w-40" />
              <Esqueleto className="h-4 w-28" />
            </div>
            <Esqueleto className="h-2.5 w-32" />
            <Esqueleto className="mt-1 h-4 w-full" />
            <Esqueleto className="h-4 w-11/12" />
            <Esqueleto className="h-4 w-3/5" />
            <div className="mt-2 flex items-center justify-between gap-4">
              <Esqueleto className="h-3 w-56" />
              <Esqueleto className="h-8 w-28" />
            </div>
          </div>
        ))}
      </div>
    </Cargando>
  );
}

// Disputas del admin: pestañas y tarjetas en una columna, con el motivo y
// la entrega lado a lado.
export function EsqueletoDisputas() {
  return (
    <Cargando className="flex flex-col gap-6" etiqueta="Cargando las disputas…">
      <div className="border-rule flex gap-4 border-b pb-3">
        <Esqueleto className="h-3 w-24" />
        <Esqueleto className="h-3 w-24" />
      </div>
      {Array.from({length: 2}, (_, i) => (
        <div key={i} className={`${tarjetaClass} flex flex-col gap-4 px-5 py-5`}>
          <div className="flex justify-between gap-4">
            <Esqueleto className="h-6 w-48" />
            <Esqueleto className="h-6 w-24" />
          </div>
          <Esqueleto className="h-3 w-72 max-w-full" />
          <div className="grid gap-5 sm:grid-cols-2">
            <Esqueleto className="h-12 w-full" />
            <Esqueleto className="h-12 w-full" />
          </div>
          <Esqueleto className="h-9 w-40" />
        </div>
      ))}
    </Cargando>
  );
}

export function EsqueletoLeadDetalle() {
  return (
    <Cargando className="flex flex-col gap-8 px-6 py-7" etiqueta="Cargando el lead…">
      <div className="flex flex-col gap-3">
        <Esqueleto className="h-8 w-52" />
        <Esqueleto className="h-2.5 w-32" />
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-5">
        <div className="col-span-2 flex flex-col gap-1.5">
          <Esqueleto className="h-2.5 w-12" />
          <Esqueleto className="h-4 w-56" />
        </div>
        {Array.from({length: 5}, (_, i) => (
          <div key={i} className={`flex flex-col gap-1.5 ${i === 4 ? "col-span-2" : ""}`}>
            <Esqueleto className="h-2.5 w-16" />
            <Esqueleto className="h-4 w-28" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <Esqueleto className="h-2.5 w-20" />
        <Esqueleto className="h-4 w-full" />
        <Esqueleto className="h-4 w-4/5" />
      </div>
    </Cargando>
  );
}

// Formulario de «Tu espacio»: título, bajada y campos con línea abajo.
export function EsqueletoEspacio() {
  return (
    <Cargando className="max-w-xl" etiqueta="Cargando tu espacio…">
      <div className="border-rule mb-10 flex flex-col gap-4 border-b pb-8">
        <Esqueleto className="h-2.5 w-24" />
        <Esqueleto className="h-11 w-72 max-w-full" />
        <Esqueleto className="h-4 w-full" />
      </div>
      <div className="flex flex-col gap-9">
        {Array.from({length: 3}, (_, i) => (
          <div key={i} className="border-rule flex flex-col gap-3 border-b pb-3">
            <Esqueleto className="h-2.5 w-28" />
            <Esqueleto className="h-5 w-56" />
          </div>
        ))}
        <Esqueleto className="h-14 w-full" />
      </div>
    </Cargando>
  );
}

// El panel entero, mientras se verifica la sesión la primera vez: menú lateral
// en la PC, encabezado y pestañas en el celular, y en el medio el esqueleto de
// la sección que se abrió (`contenido`).
export function EsqueletoPanel({contenido}: {contenido: ReactNode}) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <div className="border-rule-soft bg-card sticky top-0 hidden h-screen flex-col gap-10 border-r px-8 py-7 lg:flex">
        <div className="flex flex-col gap-2">
          <Esqueleto className="h-6 w-32" />
          <Esqueleto className="h-2.5 w-12" />
        </div>
        <div className="flex flex-col gap-5">
          {Array.from({length: 6}, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Esqueleto className="h-5 w-5" />
              <Esqueleto className="h-3.5 w-20" />
            </div>
          ))}
        </div>
      </div>
      <div className="min-w-0">
        <div className="border-rule-soft flex items-center justify-between border-b px-5 py-4 lg:hidden">
          <Esqueleto className="h-5 w-32" />
          <Esqueleto className="h-3 w-14" />
        </div>
        <div className="mx-auto w-full max-w-6xl px-5 pt-8 pb-28 sm:px-10 lg:pt-12 lg:pb-20">
          {contenido}
        </div>
      </div>
      <div className="border-rule-soft bg-card fixed inset-x-0 bottom-0 grid grid-cols-6 border-t py-3 lg:hidden">
        {Array.from({length: 6}, (_, i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <Esqueleto className="h-5 w-5" />
            <Esqueleto className="h-2 w-10" />
          </div>
        ))}
      </div>
    </div>
  );
}
