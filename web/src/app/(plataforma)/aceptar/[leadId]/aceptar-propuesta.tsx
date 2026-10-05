"use client";

import {type ReactNode, useEffect, useRef, useState} from "react";

import {Cargando, Esqueleto} from "@/app/components/esqueleto";

const N8N_BASE = process.env.NEXT_PUBLIC_N8N_BASE;
// Dirección a la que se invita a escribir cuando el enlace ya no sirve. Las
// pantallas de error decían "escribinos" sin decir dónde: en la página que
// cierra la venta, un callejón sin salida.
const CONTACTO = process.env.NEXT_PUBLIC_EMAIL_CONTACTO;
// El aviso de ngrok solo aparece detrás de un túnel de desarrollo.
const HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  ...(process.env.NODE_ENV === "development" ? {"ngrok-skip-browser-warning": "true"} : {}),
};

type ApiStatus = "ok" | "ya_procesado" | "invalido";
// Motivo fino detrás de un status "ya_procesado" (o "invalido"). Campo
// aditivo y retrocompatible: un backend viejo que sólo manda `status` sigue
// funcionando igual (ver docs/seguridad.md §5.1.2 y §4.3.2).
// Antes las cuatro situaciones de abajo devolvían el mismo status
// "ya_procesado" con el mismo cartel genérico "enlace ya utilizado".
type ApiMotivo = "token_usado" | "expirado" | "rotado" | "invalido";
// resultados finales por acción + estados de UI
type Estado =
  | "cargando"
  | "confirmar"
  | "pedir_cambios"
  | "enviando"
  | "aceptado"
  | "rechazado"
  | "modificado"
  | "ya_procesado"
  | "expirado"
  | "rotado"
  | "invalido"
  | "error";

interface LeadInfo {
  nombre?: string;
  servicio?: string;
  presupuesto?: number;
  // Términos que fijó el profesional al enviar la propuesta. Antes esta pantalla
  // sólo repetía lo que el cliente había cargado en el formulario, de modo que
  // aceptaba —y con ello disparaba una factura— sin ver la propuesta.
  precio?: number;
  plazo?: string;
  alcance?: string;
  // Etapa 11: por hitos, el cliente ve cada hito con su monto antes de aceptar.
  cobro_modo?: "factura" | "hitos";
  hitos?: {
    orden: number;
    titulo: string;
    descripcion: string;
    monto: number;
  }[];
}

interface ApiResponse {
  status?: ApiStatus;
  motivo?: ApiMotivo;
  mensaje?: string;
  lead?: LeadInfo;
  // Aceptada por hitos: el enlace de la página del proyecto, donde se paga.
  proyecto_token?: string;
}

interface StatusContent {
  icon: ReactNode;
  accent: string;
  title: string;
  message: string;
}

const cardClass =
  "flex flex-col items-start gap-5 border border-rule-soft bg-card px-8 py-12 shadow-[0_1px_2px_rgba(25,23,19,0.04),0_12px_32px_-18px_rgba(25,23,19,0.18)] sm:px-11";

const primaryButtonClass =
  "ease bg-ink px-8 py-4 text-[11px] font-medium tracking-[0.2em] text-paper uppercase transition duration-200 hover:bg-ochre disabled:cursor-not-allowed disabled:opacity-40";

const ghostButtonClass =
  "ease border border-rule px-4 py-3.5 text-[11px] tracking-[0.14em] text-muted uppercase transition duration-200 hover:border-ochre hover:text-ochre disabled:cursor-not-allowed disabled:opacity-40";

function Icono({children}: {children: ReactNode}) {
  return (
    <svg
      fill="none"
      height={36}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.3}
      viewBox="0 0 24 24"
      width={36}
    >
      {children}
    </svg>
  );
}

// Resuelve el Estado de UI a partir de una respuesta que NO fue "ok". El
// `motivo` (si vino) desambigua los cuatro desenlaces de §4.3.2; si no vino
// (backend viejo, o una respuesta de lead-rechaza/lead-modifica que nunca lo
// manda), se cae al bucket que ya existía por `status`.
function resolverEstadoFalla(json: ApiResponse): Estado {
  if (json.motivo === "expirado") return "expirado";
  if (json.motivo === "rotado") return "rotado";
  if (json.status === "ya_procesado") return "ya_procesado";

  return "invalido";
}

function buildContent(
  estado:
    | "aceptado"
    | "rechazado"
    | "modificado"
    | "ya_procesado"
    | "expirado"
    | "rotado"
    | "invalido"
    | "error",
  mensaje?: string,
): StatusContent {
  switch (estado) {
    case "aceptado":
      return {
        icon: (
          <Icono>
            <circle cx="12" cy="12" r="9" />
            <path d="M8 12.4l2.6 2.6L16 9.6" />
          </Icono>
        ),
        accent: "text-ochre",
        title: "¡Propuesta aceptada!",
        message: mensaje ?? "En breve te llega la factura por email.",
      };
    case "rechazado":
      return {
        icon: (
          <Icono>
            <circle cx="12" cy="12" r="9" />
            <path d="M9 9l6 6M15 9l-6 6" />
          </Icono>
        ),
        accent: "text-muted",
        title: "Propuesta rechazada",
        message: mensaje ?? "Gracias por avisarnos. Quedamos a disposición.",
      };
    case "modificado":
      return {
        icon: (
          <Icono>
            <path d="M4 20h4l10.5-10.5a2 2 0 000-2.8l-1.2-1.2a2 2 0 00-2.8 0L4 16v4z" />
            <path d="M13.5 6.5l4 4" />
          </Icono>
        ),
        accent: "text-ochre",
        title: "Pedido recibido",
        message: mensaje ?? "Recibimos tu pedido. Te contactamos para ajustar la propuesta.",
      };
    case "ya_procesado":
      return {
        icon: (
          <Icono>
            <path d="M4 12a8 8 0 108-8" />
            <path d="M4 4v4h4" />
          </Icono>
        ),
        accent: "text-muted",
        title: "Enlace ya usado",
        message: mensaje ?? "Esta propuesta ya fue aceptada anteriormente.",
      };
    case "expirado":
      return {
        icon: (
          <Icono>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7.5V12l3 2" />
          </Icono>
        ),
        accent: "text-muted",
        title: "Oportunidad vencida",
        message: mensaje ?? "Esta oportunidad ya no está vigente.",
      };
    case "rotado":
      return {
        icon: (
          <Icono>
            <path d="M4 12a8 8 0 1 0 2.3-5.6" />
            <path d="M4 4v5h5" />
          </Icono>
        ),
        accent: "text-muted",
        title: "Enlace desactualizado",
        message: mensaje ?? "Se generó una versión más reciente de esta propuesta.",
      };
    case "invalido":
      return {
        icon: (
          <Icono>
            <circle cx="12" cy="12" r="9" />
            <path d="M9 9l6 6M15 9l-6 6" />
          </Icono>
        ),
        accent: "text-brick",
        title: "Enlace no válido",
        message: mensaje ?? "Enlace no válido o vencido.",
      };
    case "error":
      return {
        icon: (
          <Icono>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7.5v5.5" />
            <path d="M12 16.4v.2" />
          </Icono>
        ),
        accent: "text-brick",
        title: "No pudimos procesar tu solicitud",
        message: "Reintentá en un momento.",
      };
  }
}

function StatusView({
  accent,
  icon,
  title,
  message,
  proyectoToken,
}: StatusContent & {proyectoToken?: string}) {
  // El resultado (aceptado/rechazado/error/expirado/...) reemplaza toda la
  // pantalla sin que haya un elemento previo al que quede el foco: sin esto,
  // un lector de pantalla no anuncia el desenlace de la acción que se acaba
  // de disparar.
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div className={cardClass}>
      <span className={accent}>{icon}</span>
      <h2
        ref={headingRef}
        className="text-ink font-serif text-[32px] leading-none tracking-tight outline-none"
        tabIndex={-1}
      >
        {title}
      </h2>
      <p className="text-muted max-w-sm text-[14.5px] leading-relaxed">{message}</p>
      {proyectoToken ? (
        <a className={primaryButtonClass} href={`/proyecto/${encodeURIComponent(proyectoToken)}`}>
          Ir a tu proyecto
        </a>
      ) : null}
      {CONTACTO ? (
        <p className="text-faint max-w-sm text-[13px] leading-relaxed">
          ¿Necesitás una mano? Escribinos a{" "}
          <a className="text-ochre underline-offset-4 hover:underline" href={`mailto:${CONTACTO}`}>
            {CONTACTO}
          </a>
          .
        </p>
      ) : null}
    </div>
  );
}

// Misma forma que ConfirmarView: saludo, bajada, términos y botones.
function LoadingView() {
  return (
    <Cargando className={cardClass} etiqueta="Cargando propuesta…">
      <Esqueleto className="h-2.5 w-32" />
      <Esqueleto className="h-8 w-48" />
      <Esqueleto className="h-4 w-full max-w-sm" />
      <div className="border-rule-soft w-full max-w-sm border-t">
        {Array.from({length: 3}, (_, i) => (
          <div key={i} className="border-rule-soft flex justify-between gap-6 border-b py-3.5">
            <Esqueleto className="h-3.5 w-16" />
            <Esqueleto className="h-3.5 w-28" />
          </div>
        ))}
      </div>
      <div className="flex w-full max-w-sm flex-col gap-3">
        <Esqueleto className="h-12 w-full" />
        <Esqueleto className="h-12 w-full" />
      </div>
    </Cargando>
  );
}

function ConfirmarView({
  lead,
  enviando,
  onAceptar,
  onPedirCambios,
  onRechazar,
}: {
  lead: LeadInfo | null;
  enviando: boolean;
  onAceptar: () => void;
  onPedirCambios: () => void;
  onRechazar: () => void;
}) {
  const servicio = lead?.servicio ? lead.servicio.replace(/_/g, " ") : "tu servicio";
  const hitos = lead?.cobro_modo === "hitos" ? (lead.hitos ?? []) : [];

  return (
    <div className={cardClass}>
      <span className="text-ochre text-[10px] tracking-[0.2em] uppercase">
        Confirmá tu decisión
      </span>
      <h2 className="text-ink font-serif text-[32px] leading-none tracking-tight">
        {lead?.nombre ? `Hola, ${lead.nombre}.` : "Hola."}
      </h2>
      <p className="text-muted max-w-sm text-[14.5px] leading-relaxed">
        Esta es la propuesta que preparamos para tu proyecto. Revisala antes de confirmar.
      </p>

      {/* Los mismos términos que viajan en el correo, repetidos acá: aceptar
          emite una factura, así que el cliente tiene que poder leer qué acepta
          sin volver a buscar el mail. */}
      <dl className="border-rule-soft w-full max-w-sm border-t text-[14.5px]">
        <div className="border-rule-soft flex justify-between gap-6 border-b py-3">
          <dt className="text-faint">Servicio</dt>
          <dd className="text-ink capitalize">{servicio}</dd>
        </div>
        {lead?.plazo ? (
          <div className="border-rule-soft flex justify-between gap-6 border-b py-3">
            <dt className="text-faint">Entrega</dt>
            <dd className="text-ink">{lead.plazo}</dd>
          </div>
        ) : null}
        {lead?.alcance ? (
          <div className="border-rule-soft flex flex-col gap-1 border-b py-3">
            <dt className="text-faint">Alcance</dt>
            <dd className="text-ink leading-relaxed whitespace-pre-line">{lead.alcance}</dd>
          </div>
        ) : null}
        {hitos.length > 0 ? (
          <div className="border-rule-soft flex flex-col gap-2 border-b py-3">
            <dt className="text-faint">Hitos · pago protegido</dt>
            <dd>
              <ol className="flex flex-col gap-2">
                {hitos.map((h) => (
                  <li key={h.orden} className="flex items-baseline justify-between gap-4">
                    <span className="text-ink">
                      {h.orden}. {h.titulo}
                      {h.descripcion ? (
                        <span className="text-faint block text-[12.5px]">{h.descripcion}</span>
                      ) : null}
                    </span>
                    <span className="text-ink tabular-nums">
                      $
                      {h.monto.toLocaleString("es-AR", {
                        minimumFractionDigits: h.monto % 1 ? 2 : 0,
                      })}{" "}
                      USD
                    </span>
                  </li>
                ))}
              </ol>
            </dd>
          </div>
        ) : null}
        {lead?.precio != null ? (
          <div className="border-rule-soft flex items-baseline justify-between gap-6 border-b py-3">
            <dt className="text-faint">{hitos.length > 0 ? "Total" : "Inversión"}</dt>
            <dd className="text-ochre font-serif text-[24px]">
              ${lead.precio.toLocaleString("es-AR")} USD
            </dd>
          </div>
        ) : null}
      </dl>

      <p className="text-faint max-w-sm text-[13px] leading-relaxed">
        {hitos.length > 0
          ? "Pagás cada hito antes de que empiece: la plata queda retenida y le llega al desarrollador recién cuando apruebes la entrega. ¿Cómo querés seguir?"
          : "Al aceptar te enviamos la factura por email. ¿Cómo querés seguir?"}
      </p>
      <div className="flex w-full max-w-sm flex-col gap-3">
        <button
          className={primaryButtonClass}
          disabled={enviando}
          type="button"
          onClick={onAceptar}
        >
          {enviando ? "Procesando…" : "Aceptar propuesta"}
        </button>
        <div className="flex gap-3">
          <button
            className={`${ghostButtonClass} flex-1`}
            disabled={enviando}
            type="button"
            onClick={onPedirCambios}
          >
            Pedir cambios
          </button>
          <button
            className="ease text-mist hover:text-brick flex-1 px-4 py-3.5 text-[11px] tracking-[0.14em] uppercase transition duration-200 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={enviando}
            type="button"
            onClick={onRechazar}
          >
            Rechazar
          </button>
        </div>
      </div>
    </div>
  );
}

function PedirCambiosView({
  enviando,
  mensaje,
  setMensaje,
  onEnviar,
  onVolver,
}: {
  enviando: boolean;
  mensaje: string;
  setMensaje: (v: string) => void;
  onEnviar: () => void;
  onVolver: () => void;
}) {
  return (
    <div className={cardClass}>
      <span className="text-ochre text-[10px] tracking-[0.2em] uppercase">Pedir cambios</span>
      <div className="w-full max-w-sm">
        <p className="text-muted mb-4 text-[14.5px] leading-relaxed">
          Contanos qué te gustaría ajustar y te contactamos para revisarlo.
        </p>
        <textarea
          className="ease border-rule text-ink placeholder-mist hover:border-mist focus:border-ochre w-full resize-y border-b bg-transparent pt-1 pb-3 text-[15px] leading-relaxed transition duration-200 outline-none"
          placeholder="Ej: me gustaría ajustar el precio, sumar SEO y cambiar los colores…"
          rows={5}
          value={mensaje}
          onChange={(e) => setMensaje(e.target.value)}
        />
        <div className="mt-6 flex gap-3">
          <button
            className="ease bg-ink text-paper hover:bg-ochre px-6 py-3.5 text-[11px] font-medium tracking-[0.18em] uppercase transition duration-200 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={enviando || mensaje.trim().length < 5}
            type="button"
            onClick={onEnviar}
          >
            {enviando ? "Enviando…" : "Enviar pedido"}
          </button>
          <button
            className="ease text-mist hover:text-ink px-4 py-3.5 text-[11px] tracking-[0.14em] uppercase transition duration-200 disabled:opacity-40"
            disabled={enviando}
            type="button"
            onClick={onVolver}
          >
            Volver
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AceptarPropuesta({leadId, token}: {leadId: string; token: string}) {
  const [estado, setEstado] = useState<Estado>("cargando");
  const [lead, setLead] = useState<LeadInfo | null>(null);
  const [mensaje, setMensaje] = useState<string | undefined>(undefined);
  const [proyectoToken, setProyectoToken] = useState<string | undefined>(undefined);
  const [pedido, setPedido] = useState("");

  // 1) Al cargar: GET read-only. MIRAR — no muta nada (los pre-fetchers caen acá, sin daño).
  useEffect(() => {
    if (!leadId || !token || !N8N_BASE) {
      setEstado("invalido");

      return;
    }

    const controller = new AbortController();

    async function verPropuesta() {
      try {
        const url = `${N8N_BASE}/webhook/lead-propuesta?lead_id=${encodeURIComponent(
          leadId,
        )}&token=${encodeURIComponent(token)}`;
        const response = await fetch(url, {
          signal: controller.signal,
          headers:
            process.env.NODE_ENV === "development"
              ? {"ngrok-skip-browser-warning": "true"}
              : undefined,
        });

        if (!response.ok) throw new Error(`Error del servidor: ${response.status}`);

        // Si n8n responde HTML/vacío en vez de JSON (rama cortada antes del
        // nodo Respond), no tiene que verse como un error de red: se cae al
        // motivo "invalido" en vez de a la pantalla de reintento.
        const json: ApiResponse = await response.json().catch(() => ({}));

        if (json.status === "ok") {
          setLead(json.lead ?? null);
          setEstado("confirmar");
        } else {
          setMensaje(json.proyecto_token ? json.mensaje : undefined);
          setProyectoToken(json.proyecto_token);
          setEstado(resolverEstadoFalla(json));
        }
      } catch (err) {
        if (controller.signal.aborted) return;

        console.error(err);
        setEstado("error");
      }
    }

    verPropuesta();

    return () => controller.abort();
  }, [leadId, token]);

  // Helper: POST a un webhook de acción (aceptar / rechazar / modificar). ACCIONAR.
  async function accionar(path: string, body: Record<string, unknown>, exito: Estado) {
    if (!N8N_BASE) {
      setEstado("invalido");

      return;
    }

    setEstado("enviando");

    try {
      const response = await fetch(`${N8N_BASE}/webhook/${path}`, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({lead_id: leadId, token, ...body}),
      });

      if (!response.ok) throw new Error(`Error del servidor: ${response.status}`);

      const json: ApiResponse = await response.json().catch(() => ({}));

      setMensaje(json.mensaje);
      setProyectoToken(json.proyecto_token);
      setEstado(json.status === "ok" ? exito : resolverEstadoFalla(json));
    } catch (err) {
      console.error(err);
      setEstado("error");
    }
  }

  function rechazar() {
    if (
      !window.confirm("¿Seguro que querés rechazar la propuesta? Esta acción no se puede deshacer.")
    ) {
      return;
    }
    accionar("lead-rechaza", {}, "rechazado");
  }

  if (estado === "cargando") return <LoadingView />;

  if (estado === "confirmar" || estado === "enviando") {
    return (
      <ConfirmarView
        enviando={estado === "enviando"}
        lead={lead}
        onAceptar={() => accionar("lead-acepta", {}, "aceptado")}
        onPedirCambios={() => setEstado("pedir_cambios")}
        onRechazar={rechazar}
      />
    );
  }

  if (estado === "pedir_cambios") {
    return (
      <PedirCambiosView
        enviando={false}
        mensaje={pedido}
        setMensaje={setPedido}
        onEnviar={() => accionar("lead-modifica", {mensaje: pedido}, "modificado")}
        onVolver={() => setEstado("confirmar")}
      />
    );
  }

  return <StatusView {...buildContent(estado, mensaje)} proyectoToken={proyectoToken} />;
}
