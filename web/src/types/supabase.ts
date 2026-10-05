// Tipos de la base, escritos a mano a partir de `db/schema.sql` (fuente de
// verdad del esquema real). No se generaron con `supabase gen types` porque
// eso requiere una conexión autenticada al proyecto de Supabase en la nube,
// que no está disponible desde acá — pero siguen la misma forma que produce
// esa herramienta, para que el resto del código no note la diferencia.
//
// Si el esquema cambia, hay que reflejarlo acá a mano (o, con acceso al
// proyecto, correr `npx supabase gen types typescript --project-id <ref> >
// src/types/supabase.ts` y pisar este archivo entero).

export type Json = string | number | boolean | null | {[key: string]: Json | undefined} | Json[];

export type UrgenciaTipo = "alta" | "media" | "baja";

export type ServicioTipo =
  | "desarrollo_web"
  | "ecommerce"
  | "app_movil"
  | "automatizacion"
  | "diseno_ui"
  | "consultoria"
  | "soporte"
  | "marketing"
  | "seo";

export type BolsaEstado = "ABIERTO" | "EN_ELECCION" | "ASIGNADO" | "VENCIDO";

export interface Mensaje {
  id: string;
  autor: "cliente" | "desarrollador";
  texto: string;
  creado_en: string;
  leido_en: string | null;
}

export interface Conversacion {
  rol: "cliente" | "desarrollador";
  abierta: boolean;
  // Todavía no se eligió a este postulante: los datos de contacto se ocultan.
  ocultar: boolean;
  mensajes: Mensaje[];
}

// Pago protegido por hitos (etapa 11).
export type HitoEstado =
  | "PENDIENTE"
  | "FONDEADO"
  | "ENTREGADO"
  | "EN_DISPUTA"
  | "LIBERADO"
  | "REEMBOLSADO"
  | "ANULADO";

export type CobroModo = "factura" | "hitos";

export interface HitoEvento {
  tipo:
    | "fondeado"
    | "entregado"
    | "aprobado"
    | "liberado_solo"
    | "disputado"
    | "resuelto"
    | "devuelto"
    | "anulado"
    | "transferido"
    | "reembolsado";
  actor: "cliente" | "desarrollador" | "admin" | "plataforma";
  detalle: string | null;
  creado_en: string;
}

export interface Hito {
  id: string;
  orden: number;
  titulo: string;
  descripcion: string | null;
  monto: number;
  estado: HitoEstado;
  comision_porcentaje: number;
  fondeado_en: string | null;
  entrega_nota: string | null;
  entregado_en: string | null;
  // Hasta cuándo el cliente puede aprobar o disputar antes de que se libere solo.
  libera_en: string | null;
  disputa_motivo: string | null;
  monto_liberado: number;
  monto_reembolsado: number;
  comision: number;
  resolucion_nota: string | null;
  cerrado_en: string | null;
  transferido_en: string | null;
  reembolsado_en: string | null;
  // Es el que le toca pagar al cliente.
  puede_pagar: boolean;
  eventos: HitoEvento[];
}

// Lo que devuelve ver_proyecto(): la vista de un proyecto según quién mira.
export interface Proyecto {
  rol: "desarrollador" | "cliente" | "admin";
  lead_id: string;
  estado: LeadEstadoDb;
  cobro_modo: CobroModo;
  servicio: ServicioTipo;
  cliente_nombre: string;
  espacio_nombre: string;
  alcance: string | null;
  plazo: string | null;
  de_plataforma: boolean;
  hitos: Hito[];
}

// Lo que devuelve disputa_detalle(): lo que ve el admin para decidir una
// disputa (etapa 11, paso 5).
export interface DisputaDetalle {
  hito: Omit<Hito, "libera_en" | "puede_pagar" | "eventos"> & {
    disputa_abierta_en: string | null;
    resuelto_por: string | null;
  };
  proyecto: {
    lead_id: string;
    servicio: ServicioTipo;
    cliente_nombre: string;
    espacio_nombre: string;
    espacio_slug: string;
    de_plataforma: boolean;
    hitos: {
      orden: number;
      titulo: string;
      monto: number;
      estado: HitoEstado;
    }[];
  };
  eventos: HitoEvento[];
  // La conversación de la postulación elegida; vacía con un cliente propio.
  mensajes: {
    autor: "cliente" | "desarrollador";
    texto: string;
    creado_en: string;
  }[];
  // Sigue abierta y no es un proyecto del propio admin.
  puede_resolver: boolean;
}

export type TierTipo = "HOT" | "WARM" | "COLD";

export type LeadEstadoDb =
  | "NUEVO"
  | "PROPUESTA_ENVIADA"
  | "EN_SEGUIMIENTO"
  | "ACEPTADO"
  | "FACTURADO"
  | "CERRADO"
  | "PERDIDO";

export type PagoEstado = "PENDIENTE" | "COBRADO" | "VENCIDA" | "ANULADA";

// No es un enum de Postgres: TEXT con CHECK (chk_facturas_metodo_cobro).
export type MetodoCobro = "STRIPE" | "MERCADOPAGO" | "DESARROLLO" | "CIERRE_MANUAL";

export type LogNivel = "INFO" | "RECORDATORIO" | "HOY" | "VENCIDA" | "URGENTE" | "WARN" | "ERROR";

export type TrabajoEstadoDb = "PENDIENTE" | "EN_PROGRESO" | "EN_REVISION" | "ENTREGADO";

export type TicketEstadoDb = "BACKLOG" | "EN_CURSO" | "BLOQUEADO" | "HECHO";

export type TicketPrioridadDb = "BAJA" | "MEDIA" | "ALTA" | "CRITICA";

export interface Database {
  public: {
    Tables: {
      // Avisos al desarrollador: los registra n8n (workflow/avisos.json); el
      // dueño del espacio los lee y sólo puede marcarlos como leídos.
      avisos: {
        Row: {
          id: number;
          espacio_id: string | null;
          tipo: string;
          nivel: "info" | "atencion" | "critico";
          mensaje: string;
          lead_id: string | null;
          factura_id: string | null;
          leido_en: string | null;
          creado_en: string;
        };
        Insert: never;
        Update: {leido_en?: string | null};
        Relationships: [];
      };
      // Hitos del pago protegido (etapa 11): el desarrollador lee los de su
      // espacio (Inicio y tiempo real); se escriben sólo por las funciones.
      hitos: {
        Row: {
          id: string;
          lead_id: string;
          espacio_id: string;
          orden: number;
          titulo: string;
          monto: number;
          estado: HitoEstado;
          fondeado_en: string | null;
          entregado_en: string | null;
          libera_en: string | null;
          disputa_motivo: string | null;
          disputa_abierta_en: string | null;
          cerrado_en: string | null;
          creado_en: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "hitos_lead_id_fkey";
            columns: ["lead_id"];
            isOneToOne: false;
            referencedRelation: "leads";
            referencedColumns: ["lead_id"];
          },
        ];
      };
      espacios: {
        Row: {
          id: string;
          slug: string;
          nombre: string;
          dueno_id: string | null;
          email_contacto: string | null;
          telegram_chat_id: string | null;
          telegram_codigo: string | null;
          telegram_codigo_vence: string | null;
          stripe_account_id: string | null;
          stripe_cobros_activos: boolean;
          configurado_en: string | null;
          creado_en: string;
          // Perfil público (etapa 7).
          presentacion: string | null;
          habilidades: string[];
          portfolio_urls: string[];
          // Servicios que ofrece y alertas (etapa 10).
          servicios: ServicioTipo[];
          alerta_presupuesto_min: number | null;
          alertas_correo: boolean;
        };
        // Los crea la base al confirmar la cuenta (crear_espacio_propio).
        Insert: {
          id?: string;
          slug: string;
          nombre: string;
          dueno_id?: string | null;
          email_contacto?: string | null;
          configurado_en?: string | null;
          creado_en?: string;
        };
        // El dueño sólo puede cambiar estas (GRANT por columna).
        Update: {
          nombre?: string;
          slug?: string;
          email_contacto?: string | null;
          presentacion?: string | null;
          habilidades?: string[];
          portfolio_urls?: string[];
          servicios?: ServicioTipo[];
          alerta_presupuesto_min?: number | null;
          alertas_correo?: boolean;
        };
        Relationships: [];
      };
      leads: {
        Row: {
          id: number;
          lead_id: string;
          espacio_id: string;
          nombre: string;
          email: string;
          telefono: string | null;
          presupuesto: number;
          presupuesto_rango: string | null;
          compartir_bolsa: boolean;
          urgencia: UrgenciaTipo;
          servicio: ServicioTipo;
          descripcion: string | null;
          fuente: string | null;
          estado: LeadEstadoDb;
          estado_trabajo: TrabajoEstadoDb;
          score: number;
          tier: TierTipo | null;
          seguimientos: number;
          operador_asignado: string | null;
          notas: string | null;
          accept_token: string;
          token_expira_en: string | null;
          fecha_ingreso: string;
          fecha_propuesta: string | null;
          fecha_ultimo_seguimiento: string | null;
          fecha_aceptacion: string | null;
          fecha_cierre: string | null;
          dias_ciclo_completo: number | null;
          creado_en: string;
          actualizado_en: string;
          precio_propuesto: number | null;
          plazo_propuesto: string | null;
          alcance_propuesto: string | null;
          cobro_modo: CobroModo;
          proyecto_token: string;
        };
        Insert: {
          id?: number;
          lead_id: string;
          // Opcional: sin él, el trigger trg_leads_espacio lo completa.
          espacio_id?: string;
          nombre: string;
          email: string;
          telefono?: string | null;
          presupuesto?: number;
          presupuesto_rango?: string | null;
          compartir_bolsa?: boolean;
          urgencia?: UrgenciaTipo;
          servicio?: ServicioTipo;
          descripcion?: string | null;
          fuente?: string | null;
          estado?: LeadEstadoDb;
          estado_trabajo?: TrabajoEstadoDb;
          score?: number;
          tier?: TierTipo | null;
          seguimientos?: number;
          operador_asignado?: string | null;
          notas?: string | null;
          accept_token?: string;
          token_expira_en?: string | null;
          fecha_ingreso?: string;
          fecha_propuesta?: string | null;
          fecha_ultimo_seguimiento?: string | null;
          fecha_aceptacion?: string | null;
          fecha_cierre?: string | null;
          dias_ciclo_completo?: number | null;
          creado_en?: string;
          actualizado_en?: string;
          precio_propuesto?: number | null;
          plazo_propuesto?: string | null;
          alcance_propuesto?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["leads"]["Insert"]>;
        Relationships: [];
      };
      facturas: {
        Row: {
          id: number;
          factura_id: string;
          espacio_id: string;
          lead_id: string;
          cliente: string;
          email: string;
          servicio: ServicioTipo | null;
          monto: number;
          moneda: string;
          estado_pago: PagoEstado;
          recordatorios_enviados: number;
          fecha_emision: string;
          fecha_vencimiento: string;
          fecha_cobro: string | null;
          stripe_checkout_id: string | null;
          stripe_pago_id: string | null;
          mp_preference_id: string | null;
          mp_payment_id: string | null;
          comision_plataforma: number;
          fecha_envio_email: string | null;
          creado_en: string;
          pay_url: string | null;
          pago_token: string;
          metodo_cobro: MetodoCobro | null;
        };
        Insert: {
          id?: number;
          factura_id: string;
          // Lo fija el trigger con el del lead.
          espacio_id?: string;
          lead_id: string;
          cliente: string;
          email: string;
          servicio?: ServicioTipo | null;
          monto: number;
          moneda?: string;
          estado_pago?: PagoEstado;
          recordatorios_enviados?: number;
          fecha_emision?: string;
          fecha_vencimiento: string;
          fecha_cobro?: string | null;
          stripe_checkout_id?: string | null;
          stripe_pago_id?: string | null;
          mp_preference_id?: string | null;
          mp_payment_id?: string | null;
          comision_plataforma?: number;
          fecha_envio_email?: string | null;
          creado_en?: string;
          pay_url?: string | null;
          pago_token?: string;
          metodo_cobro?: MetodoCobro | null;
        };
        Update: Partial<Database["public"]["Tables"]["facturas"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "facturas_lead_id_fkey";
            columns: ["lead_id"];
            isOneToOne: false;
            referencedRelation: "leads";
            referencedColumns: ["lead_id"];
          },
        ];
      };
      tickets: {
        Row: {
          id: string;
          espacio_id: string;
          titulo: string;
          estado: TicketEstadoDb;
          prioridad: TicketPrioridadDb;
          prioridad_inicial: TicketPrioridadDb;
          etiquetas: string[];
          origen: string;
          lead_id: string | null;
          notas: string | null;
          vence: string | null;
          escaladas: number;
          ultimo_movimiento: string;
          cerrado_en: string | null;
          creado_en: string;
        };
        Insert: {
          id?: string;
          // Lo fija el trigger: el del lead, o el de quien crea el ticket.
          espacio_id?: string;
          titulo: string;
          estado?: TicketEstadoDb;
          prioridad?: TicketPrioridadDb;
          prioridad_inicial?: TicketPrioridadDb;
          etiquetas?: string[];
          origen?: string;
          lead_id?: string | null;
          notas?: string | null;
          vence?: string | null;
          escaladas?: number;
          ultimo_movimiento?: string;
          cerrado_en?: string | null;
          creado_en?: string;
        };
        Update: Partial<Database["public"]["Tables"]["tickets"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "tickets_lead_id_fkey";
            columns: ["lead_id"];
            isOneToOne: false;
            referencedRelation: "leads";
            referencedColumns: ["lead_id"];
          },
        ];
      };
      seguimientos: {
        Row: {
          id: number;
          lead_id: string;
          espacio_id: string;
          numero: number;
          canal: string;
          asunto: string | null;
          cuerpo: string | null;
          enviado_en: string;
        };
        Insert: {
          id?: number;
          lead_id: string;
          espacio_id?: string;
          numero: number;
          canal?: string;
          asunto?: string | null;
          cuerpo?: string | null;
          enviado_en?: string;
        };
        Update: Partial<Database["public"]["Tables"]["seguimientos"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "seguimientos_lead_id_fkey";
            columns: ["lead_id"];
            isOneToOne: false;
            referencedRelation: "leads";
            referencedColumns: ["lead_id"];
          },
        ];
      };
      logs: {
        Row: {
          id: number;
          workflow: string | null;
          lead_id: string | null;
          espacio_id: string | null;
          evento: string | null;
          nivel: LogNivel;
          detalle: string | null;
          error_msg: string | null;
          creado_en: string;
        };
        Insert: {
          id?: number;
          workflow?: string | null;
          lead_id?: string | null;
          espacio_id?: string | null;
          evento?: string | null;
          nivel?: LogNivel;
          detalle?: string | null;
          error_msg?: string | null;
          creado_en?: string;
        };
        Update: Partial<Database["public"]["Tables"]["logs"]["Insert"]>;
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          email: string | null;
          role: string;
          // "desarrollador" | "cliente": lo fija la base al crear la cuenta.
          tipo: string;
          creado_en: string;
        };
        Insert: {
          id: string;
          email?: string | null;
          role?: string;
          creado_en?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        // FK real a auth.users(id), fuera del esquema `public` que modela este
        // archivo — sin relevancia acá porque nada hace un embed sobre `auth`.
        Relationships: [];
      };
      admin_emails: {
        Row: {
          email: string;
        };
        Insert: {
          email: string;
        };
        Update: Partial<Database["public"]["Tables"]["admin_emails"]["Insert"]>;
        Relationships: [];
      };
      rate_limit_log: {
        Row: {
          id: number;
          ip_o_clave: string;
          ruta: string;
          creado_en: string;
        };
        Insert: {
          id?: number;
          ip_o_clave: string;
          ruta: string;
          creado_en?: string;
        };
        Update: Partial<Database["public"]["Tables"]["rate_limit_log"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: {
      tickets_tablero: {
        Row: {
          id: string | null;
          espacio_id: string | null;
          titulo: string | null;
          estado: TicketEstadoDb | null;
          prioridad: TicketPrioridadDb | null;
          prioridad_inicial: TicketPrioridadDb | null;
          etiquetas: string[] | null;
          origen: string | null;
          lead_id: string | null;
          notas: string | null;
          vence: string | null;
          escaladas: number | null;
          ultimo_movimiento: string | null;
          cerrado_en: string | null;
          creado_en: string | null;
          cliente: string | null;
          dias_abierto: number | null;
          dias_quieto: number | null;
          score: number | null;
          dias_para_escalar: number | null;
        };
        Relationships: [];
      };
      // Las vistas son de solo lectura y `security_invoker`: todas sus
      // columnas se declaran opcionales/nullable, igual que hace el propio
      // generador de Supabase (una vista no puede garantizar NOT NULL).
      metrics_mensuales: {
        Row: {
          mes: string | null;
          total_leads: number | null;
          leads_hot: number | null;
          leads_warm: number | null;
          leads_cerrados: number | null;
          leads_perdidos: number | null;
          conversion_pct: number | null;
          tiempo_prom_dias: number | null;
          facturacion: number | null;
          cobrado: number | null;
          pendiente: number | null;
          facturas_vencidas: number | null;
          tasa_cobro_pct: number | null;
          comision_cobrada: number | null;
          cobrado_cierre_manual: number | null;
          espacio_id: string | null;
        };
        Relationships: [];
      };
      facturas_pendientes: {
        Row: {
          id: number | null;
          factura_id: string | null;
          espacio_id: string | null;
          lead_id: string | null;
          cliente: string | null;
          email: string | null;
          servicio: ServicioTipo | null;
          monto: number | null;
          moneda: string | null;
          estado_pago: PagoEstado | null;
          recordatorios_enviados: number | null;
          fecha_emision: string | null;
          fecha_vencimiento: string | null;
          fecha_cobro: string | null;
          stripe_checkout_id: string | null;
          stripe_pago_id: string | null;
          mp_preference_id: string | null;
          mp_payment_id: string | null;
          comision_plataforma: number | null;
          fecha_envio_email: string | null;
          creado_en: string | null;
          pay_url: string | null;
          pago_token: string | null;
          metodo_cobro: MetodoCobro | null;
          dias_al_vencimiento: number | null;
          espacio_nombre: string | null;
          espacio_email: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      // Lo único que el formulario público (/f/<slug>) puede leer de un espacio.
      espacio_publico: {
        Args: {p_slug: string};
        Returns: {slug: string; nombre: string}[];
      };
      // Vinculación de Telegram desde "Tu espacio".
      generar_codigo_telegram: {Args: Record<string, never>; Returns: string};
      desvincular_telegram: {Args: Record<string, never>; Returns: undefined};
      // Bolsa de proyectos: lo que ve un desarrollador (sin datos personales)
      // y su postulación. Las dos validan todo del lado de la base.
      bolsa_abierta: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          resumen: string;
          servicio: ServicioTipo;
          urgencia: UrgenciaTipo;
          presupuesto_rango: string | null;
          presupuesto: number;
          estado: BolsaEstado;
          postulaciones: number;
          tope_postulaciones: number;
          publicado_en: string;
          vence_en: string;
          propio: boolean;
          me_postule: boolean;
          asignado_a_mi: boolean;
          // Proyectos publicados directo por un cliente (etapa 6).
          titulo: string | null;
          directo: boolean;
          // La postulación propia (para abrir la conversación con el cliente).
          mi_postulacion: string | null;
          // Etiquetas de habilidades que sumó el cliente (etapa 10).
          etiquetas: string[];
        }[];
      };
      postularme: {
        Args: {
          p_pedido: string;
          p_mensaje: string;
          p_precio: number;
          p_plazo: string;
        };
        Returns: undefined;
      };
      // Perfil público y reputación (etapas 7 y 8).
      perfil_publico: {
        Args: {p_slug: string};
        Returns: {
          slug: string;
          nombre: string;
          presentacion: string | null;
          habilidades: string[];
          portfolio_urls: string[];
          promedio: number | null;
          calificaciones: number;
          proyectos_terminados: number;
          miembro_desde: string;
        }[];
      };
      resenas_publicas: {
        Args: {p_slug: string};
        Returns: {
          estrellas: number;
          comentario: string | null;
          autor_nombre: string;
          origen: "plataforma" | "formulario";
          creado_en: string;
        }[];
      };
      calificacion_pendiente: {
        Args: {p_token: string};
        Returns: {
          espacio_nombre: string;
          servicio: ServicioTipo;
          cliente_nombre: string;
          ya_calificado: boolean;
        }[];
      };
      calificar: {
        Args: {
          p_token: string;
          p_estrellas: number;
          p_comentario: string | null;
        };
        Returns: string;
      };
      // Mensajes (etapa 9): una conversación por postulación.
      abrir_conversacion: {
        Args: {p_postulacion: string; p_token?: string | null};
        Returns: Conversacion;
      };
      enviar_mensaje: {
        Args: {
          p_postulacion: string;
          p_texto: string;
          p_token?: string | null;
        };
        Returns: Mensaje;
      };
      mensajes_sin_leer: {
        Args: Record<string, never>;
        Returns: {postulacion_id: string; cantidad: number}[];
      };
      // El cliente publica su proyecto (sólo cuentas de cliente).
      publicar_proyecto: {
        Args: {
          p_titulo: string;
          p_descripcion: string;
          p_servicio: ServicioTipo;
          p_urgencia: UrgenciaTipo;
          p_presupuesto_rango: string;
          p_nombre: string;
          p_telefono: string | null;
          p_etiquetas?: string[];
        };
        Returns: string;
      };
      // Directorio público de desarrolladores (etapa 10).
      directorio_publico: {
        Args: {p_servicio?: ServicioTipo | null; p_habilidad?: string | null};
        Returns: {
          slug: string;
          nombre: string;
          presentacion: string | null;
          habilidades: string[];
          servicios: ServicioTipo[];
          promedio: number | null;
          calificaciones: number;
          proyectos_terminados: number;
        }[];
      };
      // Pago protegido por hitos (etapa 11).
      definir_cobro: {
        // Vacío o null: factura única (no se admite en proyectos de la plataforma).
        Args: {
          p_lead: string;
          p_hitos: {titulo: string; descripcion?: string; monto: number}[] | null;
        };
        Returns: number;
      };
      ver_proyecto: {
        Args: {p_lead: string | null; p_token?: string | null};
        Returns: Proyecto;
      };
      entregar_hito: {
        Args: {p_hito: string; p_nota: string};
        Returns: string;
      };
      aprobar_hito: {
        Args: {p_hito: string; p_token?: string | null};
        Returns: undefined;
      };
      disputar_hito: {
        Args: {p_hito: string; p_motivo: string; p_token?: string | null};
        Returns: undefined;
      };
      devolver_hito: {
        Args: {p_hito: string; p_nota: string};
        Returns: undefined;
      };
      anular_hito: {
        Args: {p_hito: string};
        Returns: undefined;
      };
      resolver_disputa: {
        Args: {p_hito: string; p_liberar: number; p_nota: string};
        Returns: undefined;
      };
      disputas_resueltas: {
        Args: {p_limite?: number};
        Returns: {
          id: string;
          lead_id: string;
          titulo: string;
          monto: number;
          disputa_motivo: string | null;
          monto_liberado: number;
          monto_reembolsado: number;
          resolucion_nota: string | null;
          cerrado_en: string;
          // "resuelto": la resolvió el admin. "devuelto": el desarrollador devolvió la plata.
          cierre: "resuelto" | "devuelto" | null;
          resuelto_por: string | null;
          transferido_en: string | null;
          reembolsado_en: string | null;
          espacio_nombre: string;
          cliente_nombre: string;
          servicio: ServicioTipo;
        }[];
      };
      disputa_detalle: {
        Args: {p_hito: string};
        Returns: DisputaDetalle;
      };
      disputas_abiertas: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          lead_id: string;
          titulo: string;
          monto: number;
          disputa_motivo: string;
          disputa_abierta_en: string;
          entrega_nota: string | null;
          espacio_nombre: string;
          cliente_nombre: string;
          servicio: ServicioTipo;
          // No es de un proyecto del propio admin (esas las ve, pero no las resuelve).
          puede_resolver: boolean;
        }[];
      };
      // Los proyectos del cliente con sesión y sus postulaciones.
      mis_proyectos: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          titulo: string | null;
          resumen: string;
          servicio: ServicioTipo;
          urgencia: UrgenciaTipo;
          presupuesto_rango: string | null;
          estado: BolsaEstado;
          postulaciones: number;
          tope_postulaciones: number;
          publicado_en: string;
          vence_en: string;
          elegido_nombre: string | null;
          detalle: {
            id: string;
            espacio: string;
            mensaje: string;
            precio: number;
            plazo: string;
            slug: string;
            promedio: number | null;
            calificaciones: number;
            // La que eligió el cliente.
            elegida: boolean;
          }[];
          // El token del propio proyecto: con él elige por el webhook bolsa-elegir.
          eleccion_token: string;
          // Etapa 11: la página del proyecto ya asignado (/proyecto/<token>).
          proyecto_token: string | null;
        }[];
      };
    };
    Enums: {
      urgencia_tipo: UrgenciaTipo;
      servicio_tipo: ServicioTipo;
      tier_tipo: TierTipo;
      lead_estado: LeadEstadoDb;
      pago_estado: PagoEstado;
      log_nivel: LogNivel;
      trabajo_estado: TrabajoEstadoDb;
      ticket_estado: TicketEstadoDb;
      ticket_prioridad: TicketPrioridadDb;
      bolsa_estado: BolsaEstado;
      hito_estado: HitoEstado;
    };
    CompositeTypes: Record<string, never>;
  };
}
