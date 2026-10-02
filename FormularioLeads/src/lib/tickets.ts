import type {Database} from "@/types/supabase";

// Compartido entre el servidor (/api/tickets) y el tablero (componente de
// cliente): nada de acá puede importar módulos sólo de servidor.

// Escala fija del tablero: el orden de ESTADOS son las columnas y el de
// PRIORIDADES es la escala por la que sube el cron de envejecimiento (los
// mismos enums de db/schema.sql: ticket_estado y ticket_prioridad).
export const ESTADOS = ["BACKLOG", "EN_CURSO", "BLOQUEADO", "HECHO"] as const;

export const PRIORIDADES = ["BAJA", "MEDIA", "ALTA", "CRITICA"] as const;

export type TicketEstado = (typeof ESTADOS)[number];

export type TicketPrioridad = (typeof PRIORIDADES)[number];

export interface Ticket {
  ticket_id: string;
  titulo: string;
  estado: TicketEstado;
  prioridad: TicketPrioridad;
  prioridad_inicial: TicketPrioridad;
  score: number;
  etiquetas: string[];
  origen: string;
  lead_id: string | null;
  cliente: string | null;
  notas: string;
  vence: string | null;
  creado: string;
  ultimo_movimiento: string;
  escaladas: number;
  dias_abierto: number;
  dias_quieto: number;
  dias_para_escalar: number | null;
}

export interface TicketsResponse {
  ok: boolean;
  total: number;
  truncado: boolean;
  estados: string[];
  prioridades: string[];
  tickets: Ticket[];
}

export const esEstado = (v: unknown): v is TicketEstado =>
  typeof v === "string" && (ESTADOS as readonly string[]).includes(v);

export const esPrioridad = (v: unknown): v is TicketPrioridad =>
  typeof v === "string" && (PRIORIDADES as readonly string[]).includes(v);

type FilaTablero = Database["public"]["Views"]["tickets_tablero"]["Row"];

// La vista declara todo nullable (ninguna vista puede garantizar NOT NULL):
// se descarta la fila que no traiga lo mínimo en vez de pintar un dato roto.
export function aTicket(fila: FilaTablero): Ticket | null {
  if (!fila.id || !fila.titulo || !esEstado(fila.estado) || !esPrioridad(fila.prioridad))
    return null;

  return {
    ticket_id: fila.id,
    titulo: fila.titulo,
    estado: fila.estado,
    prioridad: fila.prioridad,
    prioridad_inicial: esPrioridad(fila.prioridad_inicial)
      ? fila.prioridad_inicial
      : fila.prioridad,
    score: fila.score ?? 0,
    etiquetas: fila.etiquetas ?? [],
    origen: fila.origen ?? "",
    lead_id: fila.lead_id,
    cliente: fila.cliente,
    notas: fila.notas ?? "",
    vence: fila.vence,
    creado: fila.creado_en ?? "",
    ultimo_movimiento: fila.ultimo_movimiento ?? "",
    escaladas: fila.escaladas ?? 0,
    dias_abierto: fila.dias_abierto ?? 0,
    dias_quieto: fila.dias_quieto ?? 0,
    dias_para_escalar: fila.dias_para_escalar,
  };
}
