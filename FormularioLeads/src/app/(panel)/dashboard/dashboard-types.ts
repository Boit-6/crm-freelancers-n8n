export type LeadEstado =
  | "NUEVO"
  | "PROPUESTA_ENVIADA"
  | "EN_SEGUIMIENTO"
  | "ACEPTADO"
  | "FACTURADO"
  | "CERRADO"
  | "PERDIDO";

export type Tier = "HOT" | "WARM" | "COLD" | null;

export interface Metrics {
  mes: string;
  total_leads: number;
  conversion_pct: number;
  facturacion: number;
  cobrado: number;
  pendiente: number;
  facturas_vencidas: number;
  tasa_cobro_pct: number;
  cobrado_cierre_manual: number;
}

export interface Lead {
  lead_id: string;
  nombre: string;
  email: string;
  servicio: string;
  estado: LeadEstado;
  tier: Tier;
  presupuesto: number;
  presupuesto_rango: string | null;
  fecha_ingreso: string;
}

// Factura por cobrar: PENDIENTE, o VENCIDA (la marca el cron después de los
// días de gracia; sigue pudiendo cobrarse y es la que más urge ver).
export interface FacturaPendiente {
  estado: "PENDIENTE" | "VENCIDA";
  factura_id: string;
  cliente: string;
  servicio: string;
  monto: number;
  moneda: string;
  fecha_vencimiento: string;
  dias_al_vencimiento: number;
}

export interface Trabajo {
  lead_id: string;
  nombre: string;
  servicio: string;
  estado_trabajo: "PENDIENTE" | "EN_PROGRESO" | "EN_REVISION" | "ENTREGADO";
}

export interface PedidoCambio {
  lead_id: string;
  nombre: string;
  servicio: string;
  notas: string | null;
}

// Un hito que espera algo del desarrollador (etapa 11): pagado y sin
// entregar, o disputado por el cliente.
export interface HitoPendiente {
  id: string;
  lead_id: string;
  orden: number;
  titulo: string;
  monto: number;
  estado: "FONDEADO" | "EN_DISPUTA";
  disputa_motivo: string | null;
  cliente: string;
}

// Lead calificado HOT o WARM que todavía espera que el profesional fije los
// términos. Hasta que existió esta pantalla, la propuesta salía sola con el
// importe que el propio interesado había elegido en el formulario.
export interface PorEnviar {
  lead_id: string;
  nombre: string;
  email: string;
  servicio: string;
  tier: Tier;
  score: number;
  presupuesto: number;
  presupuesto_rango: string | null;
  fecha_ingreso: string;
}

// La consulta de panel-datos.tsx y la búsqueda de dashboard-leads-table.tsx
// comparten este tope para no prometer resultados que la tabla no recibió.
export const LEADS_LIMITE = 200;

export const FUNNEL_ORDER: LeadEstado[] = [
  "NUEVO",
  "PROPUESTA_ENVIADA",
  "EN_SEGUIMIENTO",
  "ACEPTADO",
  "FACTURADO",
  "CERRADO",
  "PERDIDO",
];

export const TIER_COLOR: Record<NonNullable<Tier>, string> = {
  HOT: "text-ochre font-semibold",
  WARM: "text-ink-soft",
  COLD: "text-mist",
};

export const ESTADO_COLOR: Record<LeadEstado, string> = {
  NUEVO: "text-ochre",
  PROPUESTA_ENVIADA: "text-muted",
  EN_SEGUIMIENTO: "text-muted",
  ACEPTADO: "text-moss",
  FACTURADO: "text-moss",
  CERRADO: "text-mist",
  PERDIDO: "text-brick",
};
