import type {
  FacturaPendiente,
  HitoPendiente,
  Lead,
  Metrics,
  PedidoCambio,
  PorEnviar,
  Trabajo,
} from "./dashboard-types";
import type {Database} from "@/types/supabase";
import type {createClient} from "@/lib/supabase/client";

import {LEADS_LIMITE} from "./dashboard-types";

type Client = NonNullable<ReturnType<typeof createClient>>;

const FACTURAS_LIMITE = 200;
const ESTADOS_PENDIENTES: HitoPendiente["estado"][] = ["FONDEADO", "EN_DISPUTA"];

export interface PanelSnapshot {
  metrics: Metrics | null;
  funnel: Record<string, number>;
  leads: Lead[];
  facturas: FacturaPendiente[];
  trabajos: Trabajo[];
  pedidos: PedidoCambio[];
  porEnviar: PorEnviar[];
  hitosPendientes: HitoPendiente[];
}

function aMetrics(
  row: Database["public"]["Views"]["metrics_mensuales"]["Row"] | undefined,
): Metrics | null {
  if (!row) return null;

  return {
    mes: row.mes ?? "",
    total_leads: row.total_leads ?? 0,
    conversion_pct: row.conversion_pct ?? 0,
    facturacion: row.facturacion ?? 0,
    cobrado: row.cobrado ?? 0,
    pendiente: row.pendiente ?? 0,
    facturas_vencidas: row.facturas_vencidas ?? 0,
    tasa_cobro_pct: row.tasa_cobro_pct ?? 0,
    cobrado_cierre_manual: row.cobrado_cierre_manual ?? 0,
  };
}

function aFacturaPendiente(
  row: Database["public"]["Views"]["facturas_pendientes"]["Row"],
): FacturaPendiente | null {
  if (
    !row.factura_id ||
    !row.cliente ||
    !row.servicio ||
    row.monto == null ||
    !row.moneda ||
    !row.fecha_vencimiento ||
    row.dias_al_vencimiento == null
  )
    return null;

  return {
    estado: "PENDIENTE",
    factura_id: row.factura_id,
    cliente: row.cliente,
    servicio: row.servicio,
    monto: row.monto,
    moneda: row.moneda,
    fecha_vencimiento: row.fecha_vencimiento,
    dias_al_vencimiento: row.dias_al_vencimiento,
  };
}

function aFacturaVencida(
  row: Pick<
    Database["public"]["Tables"]["facturas"]["Row"],
    "factura_id" | "cliente" | "servicio" | "monto" | "moneda" | "fecha_vencimiento"
  >,
): FacturaPendiente {
  const hoy = new Date();
  const vence = new Date(row.fecha_vencimiento);

  hoy.setHours(0, 0, 0, 0);
  vence.setHours(0, 0, 0, 0);

  return {
    estado: "VENCIDA",
    factura_id: row.factura_id,
    cliente: row.cliente,
    servicio: row.servicio ?? "",
    monto: row.monto,
    moneda: row.moneda,
    fecha_vencimiento: row.fecha_vencimiento,
    dias_al_vencimiento: Math.round((vence.getTime() - hoy.getTime()) / 86_400_000),
  };
}

// Cada sección conserva su último dato válido si otra consulta falla.
export async function cargarPanel(
  client: Client,
): Promise<{datos: Partial<PanelSnapshot>; errores: string[]}> {
  const consultas = {
    metrics: async () => {
      const r = await client
        .from("metrics_mensuales")
        .select("*")
        .order("mes", {ascending: false})
        .limit(1);

      if (r.error) throw r.error;

      return aMetrics(r.data?.[0]);
    },
    funnel: async () => {
      // El embudo es histórico: no se limita al mes corriente.
      const r = await client.from("leads").select("estado");

      if (r.error) throw r.error;
      const counts: Record<string, number> = {};

      for (const row of r.data ?? []) counts[row.estado] = (counts[row.estado] ?? 0) + 1;

      return counts;
    },
    leads: async () => {
      const r = await client
        .from("leads")
        .select(
          "lead_id,nombre,email,servicio,estado,tier,presupuesto,presupuesto_rango,fecha_ingreso",
        )
        .order("fecha_ingreso", {ascending: false})
        .limit(LEADS_LIMITE);

      if (r.error) throw r.error;

      return r.data ?? [];
    },
    facturas: async () => {
      // La vista excluye las vencidas; ambas consultas forman una sección indivisible.
      const [pendientes, vencidas] = await Promise.all([
        client
          .from("facturas_pendientes")
          .select("*")
          .order("dias_al_vencimiento")
          .limit(FACTURAS_LIMITE),
        client
          .from("facturas")
          .select("factura_id,cliente,servicio,monto,moneda,fecha_vencimiento")
          .eq("estado_pago", "VENCIDA")
          .order("fecha_vencimiento")
          .limit(FACTURAS_LIMITE),
      ]);

      if (pendientes.error) throw pendientes.error;
      if (vencidas.error) throw vencidas.error;

      return [
        ...(vencidas.data ?? []).map(aFacturaVencida),
        ...(pendientes.data ?? []).map(aFacturaPendiente).filter((f) => f !== null),
      ].sort((a, b) => a.dias_al_vencimiento - b.dias_al_vencimiento);
    },
    trabajos: async () => {
      const r = await client
        .from("leads")
        .select("lead_id,nombre,servicio,estado_trabajo")
        .in("estado", ["ACEPTADO", "FACTURADO"])
        .order("fecha_ingreso", {ascending: false});

      if (r.error) throw r.error;

      return r.data ?? [];
    },
    pedidos: async () => {
      // `notas` no se limpia al resolver; sólo EN_SEGUIMIENTO es un pedido activo.
      const r = await client
        .from("leads")
        .select("lead_id,nombre,servicio,notas")
        .eq("estado", "EN_SEGUIMIENTO")
        .not("notas", "is", null)
        .order("fecha_ingreso", {ascending: false});

      if (r.error) throw r.error;

      return r.data ?? [];
    },
    porEnviar: async () => {
      const r = await client
        .from("leads")
        .select(
          "lead_id,nombre,email,servicio,tier,score,presupuesto,presupuesto_rango,fecha_ingreso",
        )
        .eq("estado", "NUEVO")
        .in("tier", ["HOT", "WARM"])
        .order("score", {ascending: false});

      if (r.error) throw r.error;

      return r.data ?? [];
    },
    hitosPendientes: async () => {
      const r = await client
        .from("hitos")
        .select("id,lead_id,orden,titulo,monto,estado,disputa_motivo,leads(nombre)")
        .in("estado", ESTADOS_PENDIENTES)
        .order("creado_en");

      if (r.error) throw r.error;

      return (r.data ?? []).flatMap((h): HitoPendiente[] =>
        ESTADOS_PENDIENTES.includes(h.estado as HitoPendiente["estado"])
          ? [
              {
                id: h.id,
                lead_id: h.lead_id,
                orden: h.orden,
                titulo: h.titulo,
                monto: h.monto,
                estado: h.estado as HitoPendiente["estado"],
                disputa_motivo: h.disputa_motivo,
                cliente: h.leads?.nombre ?? h.lead_id,
              },
            ]
          : [],
      );
    },
  } satisfies {[K in keyof PanelSnapshot]: () => Promise<PanelSnapshot[K]>};

  const claves = Object.keys(consultas) as (keyof PanelSnapshot)[];
  const resultados = await Promise.allSettled(claves.map((clave) => consultas[clave]()));
  const datos: Partial<PanelSnapshot> = {};
  const errores: string[] = [];

  resultados.forEach((resultado, i) => {
    const clave = claves[i]!;

    if (resultado.status === "rejected") {
      errores.push(
        `${clave}: ${resultado.reason instanceof Error ? resultado.reason.message : "No se pudo cargar"}`,
      );
    } else {
      // La clave y el valor proceden de la misma entrada de `consultas`.
      Object.assign(datos, {[clave]: resultado.value});
    }
  });

  return {datos, errores};
}
