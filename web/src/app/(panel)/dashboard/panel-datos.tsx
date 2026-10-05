"use client";

import type {
  FacturaPendiente,
  HitoPendiente,
  Lead,
  Metrics,
  PedidoCambio,
  PorEnviar,
  Trabajo,
} from "./dashboard-types";
import type {HitosPropuesta} from "./form-propuesta";
import type {ReactNode} from "react";

import {createContext, useCallback, useContext, useEffect, useState} from "react";

import LeadDetalle from "./lead-detalle";
import {cargarPanel} from "./panel-loader";

import {useConfirm} from "@/app/components/confirm-dialog";
import {createClient} from "@/lib/supabase/client";

// Ventana para agrupar los eventos de tiempo real en una sola recarga.
const RECARGA_AGRUPADA_MS = 400;

interface PanelDatos {
  // true hasta que llega la primera carga: cada página muestra su esqueleto.
  cargando: boolean;
  metrics: Metrics | null;
  funnel: Record<string, number>;
  leads: Lead[];
  facturas: FacturaPendiente[];
  trabajos: Trabajo[];
  pedidos: PedidoCambio[];
  porEnviar: PorEnviar[];
  hitosPendientes: HitoPendiente[];
  enviarPropuesta: (
    leadId: string,
    precio: number,
    plazo: string,
    alcance: string,
    hitos: HitosPropuesta,
  ) => Promise<void>;
  cancelar: (leadId: string) => void;
  cerrarProyecto: (leadId: string) => void;
  aceptarCambio: (leadId: string) => Promise<boolean>;
  rechazarCambio: (leadId: string) => Promise<boolean>;
  anularFactura: (facturaId: string) => void;
  rechazarPedido: (
    leadId: string,
    destino: "bolsa" | "descartar",
    resumen: string,
  ) => Promise<boolean>;
  cambiarEstadoTrabajo: (leadId: string, estado: Trabajo["estado_trabajo"]) => void;
  // Abre el detalle del lead en el panel lateral.
  abrirLead: (leadId: string) => void;
}

const PanelDatosContext = createContext<PanelDatos | null>(null);

// Lo usan las páginas del panel (Inicio, Leads, Facturas, Trabajos) para leer
// los datos y disparar las acciones.
export function usePanelDatos() {
  const datos = useContext(PanelDatosContext);

  if (!datos) throw new Error("usePanelDatos se usa dentro de PanelDatosProvider.");

  return datos;
}

// Coordinador: junta los datos del tablero, mantiene la suscripción Realtime
// y los reparte por contexto a cada página. Vive en el layout de las
// secciones, así que cambiar de pestaña no vuelve a consultar ni abre otra
// suscripción. Las secciones no hablan con Supabase ni con /api/crm
// directamente, solo reciben datos y callbacks.
export default function PanelDatosProvider({children}: {children: ReactNode}) {
  const [supabase] = useState(() => createClient());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [funnel, setFunnel] = useState<Record<string, number>>({});
  const [leads, setLeads] = useState<Lead[]>([]);
  const [facturas, setFacturas] = useState<FacturaPendiente[]>([]);
  const [trabajos, setTrabajos] = useState<Trabajo[]>([]);
  const [pedidos, setPedidos] = useState<PedidoCambio[]>([]);
  const [porEnviar, setPorEnviar] = useState<PorEnviar[]>([]);
  const [hitosPendientes, setHitosPendientes] = useState<HitoPendiente[]>([]);
  const [confirmar, ConfirmDialog] = useConfirm();
  const [leadAbierto, setLeadAbierto] = useState<string | null>(null);

  const cargarDatos = useCallback(async () => {
    if (!supabase) {
      setError("Faltan las variables NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.");
      setLoading(false);

      return;
    }

    try {
      const {datos, errores} = await cargarPanel(supabase);

      if ("metrics" in datos) setMetrics(datos.metrics ?? null);
      if (datos.funnel) setFunnel(datos.funnel);
      if (datos.leads) setLeads(datos.leads);
      if (datos.facturas) setFacturas(datos.facturas);
      if (datos.trabajos) setTrabajos(datos.trabajos);
      if (datos.pedidos) setPedidos(datos.pedidos);
      if (datos.porEnviar) setPorEnviar(datos.porEnviar);
      if (datos.hitosPendientes) setHitosPendientes(datos.hitosPendientes);
      setError(
        errores.length
          ? `No pudimos actualizar ${errores.join("; ")}. Se muestran los últimos datos disponibles.`
          : null,
      );
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "No pudimos cargar el dashboard.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    cargarDatos();

    if (!supabase) return;

    const client = supabase;
    let pendiente: ReturnType<typeof setTimeout> | null = null;

    // Refresca en vivo cuando entra o cambia un lead, una factura o un hito, agrupando
    // la ráfaga. Las facturas cambian solas sin tocar su lead: el pago de
    // Stripe, el cron que las marca VENCIDA o una anulación.
    //
    // Cada evento de `postgres_changes` obliga a recargar el tablero entero, que
    // son nueve consultas. Sin agrupar, un proceso programado que actualiza N
    // leads de una vez —el de seguimiento de las 9:00 lo hace— disparaba 9N
    // consultas en ráfaga, más de las que costaría sondear. La espera es corta
    // frente al objetivo de 3 s, así que no compromete la actualidad del
    // dato: sólo evita repetir la misma recarga N veces.
    const recargarAgrupado = () => {
      if (pendiente) clearTimeout(pendiente);
      pendiente = setTimeout(() => {
        pendiente = null;
        cargarDatos();
      }, RECARGA_AGRUPADA_MS);
    };

    const channel = client
      .channel("tablero-rt")
      .on("postgres_changes", {event: "*", schema: "public", table: "leads"}, recargarAgrupado)
      .on("postgres_changes", {event: "*", schema: "public", table: "facturas"}, recargarAgrupado)
      // El cliente paga o disputa un hito sin tocar el lead.
      .on("postgres_changes", {event: "*", schema: "public", table: "hitos"}, recargarAgrupado)
      .subscribe();

    return () => {
      if (pendiente) clearTimeout(pendiente);
      client.removeChannel(channel);
    };
  }, [cargarDatos, supabase]);

  // Las acciones del panel van por /api/crm/*, no directo a n8n: el route
  // handler revalida la sesión, que el pedido sea de tu espacio, y agrega la
  // credencial del lado del servidor.
  // El body es genérico (no siempre es `lead_id`: factura-anular manda
  // `factura_id`) porque el route handler sólo reenvía lo que reciba.
  async function accionPanel(
    accion: string,
    body: Record<string, unknown>,
    mensajeError: string,
  ): Promise<boolean> {
    try {
      const res = await fetch(`/api/crm/${accion}`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || json.ok === false || json.status === "invalido") {
        throw new Error(json.error ?? json.mensaje ?? `Error ${res.status}`);
      }

      void cargarDatos();

      return true;
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : mensajeError);

      return false;
    }
  }

  // Fija los términos y dispara el envío de la propuesta. Es el paso que antes
  // no existía: la propuesta salía sola con el importe del formulario público.
  // Con hitos (etapa 11), primero se guardan en la base: definir_cobro()
  // valida quién llama y cada hito, y n8n toma el total de ahí. Sin hitos
  // también se llama, para volver a la factura única si antes había hitos.
  async function enviarPropuesta(
    leadId: string,
    precio: number,
    plazo: string,
    alcance: string,
    hitos: HitosPropuesta,
  ) {
    try {
      if (!supabase) throw new Error("Falta la conexión con la base.");
      const {error: errorCobro} = await supabase.rpc("definir_cobro", {
        p_lead: leadId,
        p_hitos: hitos,
      });

      if (errorCobro) throw new Error(errorCobro.message);

      const res = await fetch("/api/crm/propuesta-enviar", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({lead_id: leadId, precio, plazo, alcance}),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || json.status === "invalido") {
        throw new Error(json.mensaje ?? json.error ?? `Error ${res.status}`);
      }

      setPorEnviar((prev) => prev.filter((l) => l.lead_id !== leadId));
      cargarDatos();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "No se pudo enviar la propuesta.");
      // El formulario está en el panel lateral, que tapa el aviso de error del
      // tablero: se relanza para que también lo muestre ahí.
      throw err;
    }
  }

  // «No puedo tomarlo»: a la bolsa o descartado. Devuelve false si el
  // desarrollador se arrepintió en la confirmación; si falla, lanza el error
  // para que lo muestre el panel lateral, que tapa el aviso del tablero.
  async function rechazarPedido(
    leadId: string,
    destino: "bolsa" | "descartar",
    resumen: string,
  ): Promise<boolean> {
    const ok = await confirmar({
      descripcion:
        destino === "bolsa"
          ? "¿Mandar el pedido a la bolsa? Queda como PERDIDO en tu panel, otros desarrolladores lo ven sin los datos del cliente, y le avisamos al cliente."
          : "¿Descartar el pedido? Queda como PERDIDO y le avisamos al cliente que esta vez no podés tomarlo.",
      textoConfirmar: destino === "bolsa" ? "Mandar a la bolsa" : "Descartar",
      peligroso: destino === "descartar",
    });

    if (!ok) return false;

    const res = await fetch("/api/crm/pedido-rechazar", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({lead_id: leadId, destino, resumen}),
    });
    const json = await res.json().catch(() => ({}));

    if (!res.ok || json.ok === false || json.status !== "ok") {
      throw new Error(json.mensaje ?? json.error ?? `Error ${res.status}`);
    }

    cargarDatos();

    return true;
  }

  async function cancelar(leadId: string) {
    const ok = await confirmar({
      descripcion: "¿Cancelar este pedido? Se marca como PERDIDO y se avisa al cliente.",
      textoConfirmar: "Cancelar pedido",
      peligroso: true,
    });

    if (!ok) return;

    accionPanel("cancelar", {lead_id: leadId}, "No se pudo cancelar el pedido.");
  }

  // Único camino del sistema al estado CERRADO. Sin esta acción el lead se
  // quedaba en FACTURADO para siempre y las dos métricas que se calculan sobre
  // los leads cerrados —Conversión y Tiempo promedio de ciclo— no podían moverse
  // de cero, porque el webhook sólo se podía disparar a mano.
  async function cerrarProyecto(leadId: string) {
    const ok = await confirmar({
      descripcion:
        "¿Cerrar el proyecto? Se marca el lead como CERRADO, se concilia la factura y se le pide un testimonio al cliente.",
      textoConfirmar: "Cerrar proyecto",
    });

    if (!ok) return;

    accionPanel("cerrar", {lead_id: leadId}, "No se pudo cerrar el proyecto.");
  }

  async function aceptarCambio(leadId: string): Promise<boolean> {
    const ok = await confirmar({
      descripcion: "¿Aceptar los cambios y reenviar la propuesta al cliente?",
      textoConfirmar: "Aceptar y reenviar",
    });

    if (!ok) return false;

    return accionPanel(
      "cambio-aceptar",
      {lead_id: leadId},
      "No se pudo procesar el pedido de cambio.",
    );
  }

  async function rechazarCambio(leadId: string): Promise<boolean> {
    const ok = await confirmar({
      descripcion:
        "¿Rechazar los cambios? Se mantiene la propuesta original y se le avisa al cliente.",
      textoConfirmar: "Rechazar",
      peligroso: true,
    });

    if (!ok) return false;

    return accionPanel(
      "cambio-rechazar",
      {lead_id: leadId},
      "No se pudo procesar el pedido de cambio.",
    );
  }

  // Cierra la transición ANULADA del enum `pago_estado` (§4.8 y Cap. 8, punto
  // 7): hasta el 01-sep-2026 estaba prevista en el esquema pero ningún botón
  // ni nodo la disparaba. El backend (`Postgres - Marcar Factura Anulada`) ya
  // es quien decide si aplica (sólo PENDIENTE o VENCIDA, nunca COBRADO); acá
  // sólo se pide confirmación y se refresca la lista si se aplicó.
  async function anularFactura(facturaId: string) {
    const ok = await confirmar({
      descripcion: `¿Anular la factura ${facturaId}? No se puede deshacer y deja de contar como pendiente ni como vencida.`,
      textoConfirmar: "Anular factura",
      peligroso: true,
    });

    if (!ok) return;

    accionPanel("factura-anular", {factura_id: facturaId}, "No se pudo anular la factura.");
  }

  const datos: PanelDatos = {
    cargando: loading,
    metrics,
    funnel,
    leads,
    facturas,
    trabajos,
    pedidos,
    porEnviar,
    hitosPendientes,
    enviarPropuesta,
    cancelar,
    cerrarProyecto,
    aceptarCambio,
    rechazarCambio,
    anularFactura,
    rechazarPedido,
    cambiarEstadoTrabajo: (leadId, estado) =>
      setTrabajos((prev) =>
        prev.map((x) => (x.lead_id === leadId ? {...x, estado_trabajo: estado} : x)),
      ),
    abrirLead: setLeadAbierto,
  };

  return (
    <PanelDatosContext.Provider value={datos}>
      {error && (
        <div
          className="border-brick bg-brick/5 text-brick mb-10 border-l-2 px-5 py-3.5 text-[13px]"
          role="alert"
        >
          {error}
        </div>
      )}

      {children}

      {leadAbierto && (
        <LeadDetalle
          key={leadAbierto}
          leadId={leadAbierto}
          onAceptarCambio={aceptarCambio}
          onCerrar={() => setLeadAbierto(null)}
          onEnviarPropuesta={enviarPropuesta}
          onRechazarCambio={rechazarCambio}
          onRechazarPedido={rechazarPedido}
        />
      )}

      <ConfirmDialog />
    </PanelDatosContext.Provider>
  );
}
