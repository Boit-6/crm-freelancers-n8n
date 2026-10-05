"use client";

import type {Ticket, TicketsResponse} from "@/lib/tickets";

import {useCallback, useEffect, useRef, useState} from "react";

import {EsqueletoTickets} from "../../esqueletos";

import {esEstado} from "@/lib/tickets";

// Tablero tipo Trello sobre la tabla `tickets`. Se pinta la vista
// tickets_tablero y los cambios van por /api/tickets (sesión del desarrollador y RLS por espacio).
// La prioridad la sube sola el cron de envejecimiento: por eso cada card
// muestra hace cuánto no se mueve y cuánto le falta para escalar.
//
// En la PC se ven las cuatro columnas y las tarjetas se arrastran. En el
// celular (donde el arrastre nativo no anda con el dedo) hay una pestaña por
// estado. En los dos, cada tarjeta tiene un selector «Mover a», que es
// también el camino con el teclado.

const ESTADOS_FALLBACK = ["BACKLOG", "EN_CURSO", "BLOQUEADO", "HECHO"];
const PRIORIDADES_FALLBACK = ["BAJA", "MEDIA", "ALTA", "CRITICA"];

// La escala de prioridades es configurable, así que el color se asigna por
// posición en la escala y no por nombre fijo.
const ESCALA_COLOR = [
  "text-mist border-rule",
  "text-ochre border-ochre/40",
  "text-ochre-deep border-ochre-deep/40",
  "text-brick border-brick/40",
];

// ESCALA_COLOR es un array literal fijo de 4 elementos declarado acá arriba:
// el índice 0 siempre existe. La aserción es sólo para noUncheckedIndexedAccess.
const COLOR_POR_DEFECTO = ESCALA_COLOR[0]!;

function colorPrioridad(prioridad: string, prioridades: string[]): string {
  const idx = prioridades.indexOf(prioridad);

  if (idx < 0 || prioridades.length < 2) return COLOR_POR_DEFECTO;

  const paso = (idx / (prioridades.length - 1)) * (ESCALA_COLOR.length - 1);

  return ESCALA_COLOR[Math.round(paso)] ?? COLOR_POR_DEFECTO;
}

function TicketCard({
  ticket,
  prioridades,
  estados,
  moviendo,
  arrastrando,
  onMover,
  onArrastre,
}: {
  ticket: Ticket;
  prioridades: string[];
  estados: string[];
  moviendo: boolean;
  arrastrando: boolean;
  onMover: (ticketId: string, estado: string) => void;
  onArrastre: (ticketId: string | null) => void;
}) {
  const porEscalar = ticket.dias_para_escalar != null && ticket.dias_para_escalar <= 1;

  return (
    <article
      className={`ease bg-card border-l-2 p-3.5 shadow-[0_1px_2px_rgba(25,23,19,0.04)] transition duration-200 lg:cursor-grab lg:active:cursor-grabbing ${
        moviendo || arrastrando ? "opacity-40" : ""
      } ${colorPrioridad(ticket.prioridad, prioridades).split(" ")[1]}`}
      draggable={!moviendo}
      onDragEnd={() => onArrastre(null)}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", ticket.ticket_id);
        e.dataTransfer.effectAllowed = "move";
        onArrastre(ticket.ticket_id);
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span
          className={`text-[10px] tracking-[0.15em] uppercase ${
            colorPrioridad(ticket.prioridad, prioridades).split(" ")[0]
          }`}
        >
          {ticket.prioridad}
        </span>
        <span className="text-faint text-[10px]">{ticket.score}</span>
      </div>

      <p className="text-ink mb-2 text-[14px] leading-snug">{ticket.titulo}</p>

      {ticket.etiquetas.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {ticket.etiquetas.map((etiqueta) => (
            <span key={etiqueta} className="text-faint text-[10px]">
              #{etiqueta}
            </span>
          ))}
        </div>
      )}

      <p className="text-mist mb-3 text-[10px]">
        {ticket.dias_abierto}d abierto
        {ticket.escaladas > 0 && <span className="text-ochre"> · ⬆ ×{ticket.escaladas}</span>}
        {ticket.dias_para_escalar != null && (
          <span className={porEscalar ? "text-brick" : ""}>
            {" "}
            · escala en {ticket.dias_para_escalar}d
          </span>
        )}
      </p>

      <label className="flex items-center gap-2">
        <span className="text-faint text-[10px] tracking-[0.14em] uppercase">Mover a</span>
        <select
          className="ease border-rule text-ink-soft hover:border-mist focus:border-ochre min-h-9 flex-1 cursor-pointer border bg-transparent px-2 text-[12px] transition duration-200 outline-none disabled:opacity-40"
          disabled={moviendo}
          value={ticket.estado}
          onChange={(e) => onMover(ticket.ticket_id, e.target.value)}
        >
          {estados.map((estado) => (
            <option key={estado} className="bg-card text-ink" value={estado}>
              {estado.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </label>
    </article>
  );
}

export default function TicketsBoard() {
  const [datos, setDatos] = useState<TicketsResponse | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [moviendo, setMoviendo] = useState<Set<string>>(() => new Set());
  const movimientosPendientes = useRef(new Set<string>());
  const huboMovimientoExitoso = useRef(false);
  const errorMovimiento = useRef<string | null>(null);
  const recargaEnCurso = useRef(false);
  const [recargandoMovimiento, setRecargandoMovimiento] = useState(false);
  const [columnaActiva, setColumnaActiva] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  // Estado que muestra el celular (una columna por vez).
  const [pestana, setPestana] = useState<string>(ESTADOS_FALLBACK[0]!);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [titulo, setTitulo] = useState("");
  const [prioridad, setPrioridad] = useState("MEDIA");
  const [etiquetas, setEtiquetas] = useState("");
  const [creando, setCreando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setError(null);

      // abiertos=false trae también los cerrados: el tablero muestra la columna HECHO.
      const res = await fetch("/api/tickets?abiertos=false&limite=100", {
        cache: "no-store",
      });
      const json = (await res.json()) as TicketsResponse & {error?: string};

      if (!res.ok || !json.ok) throw new Error(json.error ?? `Error ${res.status}`);

      setDatos(json);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "No pudimos cargar los tickets.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const estados = datos?.estados?.length ? datos.estados : ESTADOS_FALLBACK;
  const prioridades = datos?.prioridades?.length ? datos.prioridades : PRIORIDADES_FALLBACK;
  const tickets = datos?.tickets ?? [];

  async function mover(ticketId: string, estado: string) {
    if (!esEstado(estado) || recargaEnCurso.current || movimientosPendientes.current.has(ticketId))
      return;

    const previo = datos?.tickets.find((t) => t.ticket_id === ticketId)?.estado;

    if (!previo || previo === estado) return;

    movimientosPendientes.current.add(ticketId);
    setMoviendo(new Set(movimientosPendientes.current));

    // Optimista: movemos la card en pantalla y revertimos si la API falla.
    setDatos((actual) =>
      actual
        ? {
            ...actual,
            tickets: actual.tickets.map((t) => (t.ticket_id === ticketId ? {...t, estado} : t)),
          }
        : actual,
    );

    try {
      const res = await fetch("/api/tickets/estado", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ticket_id: ticketId, estado}),
      });
      const json = await res.json();

      if (!res.ok || !json.ok) throw new Error(json.error ?? `Error ${res.status}`);

      huboMovimientoExitoso.current = true;
    } catch (err) {
      console.error(err);
      // No restaurar toda la lista: otra tarjeta puede haberse movido mientras tanto.
      setDatos((actual) =>
        actual
          ? {
              ...actual,
              tickets: actual.tickets.map((t) =>
                t.ticket_id === ticketId ? {...t, estado: previo} : t,
              ),
            }
          : actual,
      );
      errorMovimiento.current = err instanceof Error ? err.message : "No se pudo mover el ticket.";
      setError(errorMovimiento.current);
    } finally {
      movimientosPendientes.current.delete(ticketId);
      setMoviendo(new Set(movimientosPendientes.current));
      if (movimientosPendientes.current.size === 0) {
        // Recargar una sola vez tras la ráfaga; antes, una respuesta tardía podía
        // pisar el cambio optimista de otra tarjeta. La base recalcula score/reloj.
        if (huboMovimientoExitoso.current) {
          recargaEnCurso.current = true;
          setRecargandoMovimiento(true);
          try {
            await cargar();
          } finally {
            recargaEnCurso.current = false;
            setRecargandoMovimiento(false);
          }
        }
        if (errorMovimiento.current) setError(errorMovimiento.current);
        huboMovimientoExitoso.current = false;
        errorMovimiento.current = null;
      }
    }
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();

    const limpio = titulo.trim();

    if (!limpio || creando) return;

    setCreando(true);
    setError(null);

    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          titulo: limpio,
          prioridad,
          etiquetas: etiquetas
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      const json = await res.json();

      if (!res.ok || !json.ok) throw new Error(json.error ?? `Error ${res.status}`);

      setTitulo("");
      setEtiquetas("");
      dialogRef.current?.close();
      // Un ticket nuevo entra en la primera columna: en el celular se va a
      // esa pestaña para que se vea.
      setPestana(estados[0] ?? ESTADOS_FALLBACK[0]!);
      await cargar();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "No se pudo crear el ticket.");
    } finally {
      setCreando(false);
    }
  }

  if (cargando) {
    return <EsqueletoTickets />;
  }

  return (
    <div className="flex flex-col gap-8">
      {error && (
        <div
          className="border-brick bg-brick/5 text-brick border-l-2 px-5 py-3.5 text-[13px]"
          role="alert"
        >
          {error}
        </div>
      )}

      <div className="flex justify-end max-lg:hidden">
        <button
          className="ease bg-ink text-paper hover:bg-ochre px-5 py-3 text-[11px] tracking-[0.16em] uppercase transition duration-200"
          type="button"
          onClick={() => dialogRef.current?.showModal()}
        >
          + Nuevo ticket
        </button>
      </div>

      {/* Celular: una pestaña por estado */}
      <div
        aria-label="Estado"
        className="border-rule grid grid-cols-4 border-b lg:hidden"
        role="tablist"
      >
        {estados.map((estado) => {
          const activa = pestana === estado;

          return (
            <button
              key={estado}
              aria-selected={activa}
              className={`-mb-px flex flex-col items-center gap-0.5 border-b-2 px-1 py-2.5 text-[10px] tracking-[0.08em] uppercase transition duration-200 ${
                activa ? "border-ochre text-ochre-deep" : "text-muted border-transparent"
              }`}
              role="tab"
              type="button"
              onClick={() => setPestana(estado)}
            >
              <span className="truncate">{estado.replace(/_/g, " ")}</span>
              <span className="font-serif text-[16px] tracking-normal normal-case">
                {tickets.filter((t) => t.estado === estado).length}
              </span>
            </button>
          );
        })}
      </div>

      {/* Tablero */}
      <div className="grid gap-5 lg:grid-cols-4">
        {estados.map((estado) => {
          const enColumna = tickets
            .filter((t) => t.estado === estado)
            .sort((a, b) => b.score - a.score);
          const destino = columnaActiva === estado;

          return (
            <section
              key={estado}
              aria-label={estado.replace(/_/g, " ")}
              className={`ease min-h-[12rem] flex-col gap-3 transition duration-200 lg:border-t-2 lg:p-2 lg:pt-4 ${
                pestana === estado ? "flex" : "hidden lg:flex"
              } ${destino ? "lg:border-ochre lg:bg-ochre/5" : "lg:border-rule"}`}
              onDragLeave={(e) => {
                // dragleave también salta al pasar sobre una tarjeta de la
                // misma columna: sólo cuenta si el puntero salió de verdad.
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                  setColumnaActiva((c) => (c === estado ? null : c));
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setColumnaActiva(estado);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setColumnaActiva(null);
                setArrastrando(null);

                const id = e.dataTransfer.getData("text/plain");
                const actual = tickets.find((t) => t.ticket_id === id);

                if (actual && actual.estado !== estado) mover(id, estado);
              }}
            >
              <div className="hidden items-center justify-between px-1 lg:flex">
                <h2 className="text-ink-soft text-[11px] tracking-[0.2em] uppercase">
                  {estado.replace(/_/g, " ")}
                </h2>
                <span className="text-mist text-[11px]">{enColumna.length}</span>
              </div>

              {enColumna.length === 0 ? (
                <p className="text-mist px-1 text-[12px]">{destino ? "Soltalo acá" : "Vacío"}</p>
              ) : (
                enColumna.map((ticket) => (
                  <TicketCard
                    key={ticket.ticket_id}
                    arrastrando={arrastrando === ticket.ticket_id}
                    estados={estados}
                    moviendo={recargandoMovimiento || moviendo.has(ticket.ticket_id)}
                    prioridades={prioridades}
                    ticket={ticket}
                    onArrastre={setArrastrando}
                    onMover={mover}
                  />
                ))
              )}
            </section>
          );
        })}
      </div>

      {/* Celular: botón flotante, arriba de la barra de pestañas del panel */}
      <button
        aria-label="Nuevo ticket"
        className="bg-ink text-paper hover:bg-ochre fixed right-5 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-20 flex size-14 items-center justify-center rounded-full text-[26px] leading-none shadow-[0_8px_24px_-8px_rgba(25,23,19,0.5)] transition duration-200 lg:hidden"
        type="button"
        onClick={() => dialogRef.current?.showModal()}
      >
        +
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="nuevo-ticket-titulo"
        className="bg-paper text-ink backdrop:bg-ink/30 m-auto w-[calc(100%-2rem)] max-w-md p-0 shadow-[0_12px_40px_-16px_rgba(25,23,19,0.4)]"
      >
        <form className="flex flex-col gap-6 p-6" onSubmit={crear}>
          <div className="flex items-center justify-between">
            <h2 className="text-ink font-serif text-[24px]" id="nuevo-ticket-titulo">
              Nuevo ticket
            </h2>
            <button
              className="text-muted hover:text-ochre text-[11px] tracking-[0.16em] uppercase"
              type="button"
              onClick={() => dialogRef.current?.close()}
            >
              Cerrar ✕
            </button>
          </div>

          <label className="flex flex-col gap-2">
            <span className="text-faint text-[10px] tracking-[0.2em] uppercase">Título</span>
            <input
              required
              className="ease border-rule text-ink placeholder-mist hover:border-mist focus:border-ochre w-full border-b bg-transparent pb-2 text-[15px] transition duration-200 outline-none"
              placeholder="¿Qué hay pendiente?"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
            />
          </label>

          <div className="grid grid-cols-2 gap-5">
            <label className="flex flex-col gap-2">
              <span className="text-faint text-[10px] tracking-[0.2em] uppercase">Prioridad</span>
              <select
                className="ease border-rule text-ink hover:border-mist focus:border-ochre min-h-9 cursor-pointer border-b bg-transparent pb-2 text-[14px] transition duration-200 outline-none"
                value={prioridad}
                onChange={(e) => setPrioridad(e.target.value)}
              >
                {prioridades.map((p) => (
                  <option key={p} className="bg-card text-ink" value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-faint text-[10px] tracking-[0.2em] uppercase">Etiquetas</span>
              <input
                className="ease border-rule text-ink placeholder-mist hover:border-mist focus:border-ochre border-b bg-transparent pb-2 text-[14px] transition duration-200 outline-none"
                placeholder="facturacion, bug"
                value={etiquetas}
                onChange={(e) => setEtiquetas(e.target.value)}
              />
            </label>
          </div>

          <button
            className="ease bg-ink text-paper hover:bg-ochre py-3.5 text-[11px] tracking-[0.16em] uppercase transition duration-200 disabled:opacity-40"
            disabled={creando}
            type="submit"
          >
            {creando ? "Creando…" : "Crear ticket"}
          </button>
        </form>
      </dialog>

      <p className="text-mist text-[11px]">
        {tickets.length} ticket{tickets.length === 1 ? "" : "s"}
        {datos?.truncado && " · mostrando los primeros 100"} · la prioridad sube sola cuando un
        ticket queda quieto (cron diario 8:00).
      </p>
    </div>
  );
}
