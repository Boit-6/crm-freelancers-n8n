"use client";

import {useEffect, useRef, useState} from "react";
import {useForm} from "react-hook-form";
import Link from "next/link";

import {RANGOS_PRESUPUESTO} from "@/lib/presupuesto";

const N8N_BASE = process.env.NEXT_PUBLIC_N8N_BASE;
const WEBHOOK_URL = `${N8N_BASE}/webhook/lead-nuevo`;

// El valor es el texto que n8n traduce a servicio_tipo (svcMap en Code -
// Normalizar Lead): no cambiarlo sin cambiar el mapa.
const SERVICIOS = [
  {value: "Desarrollo Web", detalle: "Sitios, sistemas y tiendas"},
  {value: "Diseño UX/UI", detalle: "Interfaces y prototipos"},
  {value: "Marketing Digital", detalle: "Campañas y redes"},
  {value: "SEO / Posicionamiento", detalle: "Aparecer en buscadores"},
  {value: "Consultoría", detalle: "Asesoramiento técnico"},
  {value: "Otro", detalle: "Contanos en la descripción"},
];

const URGENCIAS = [
  {value: "baja", label: "Sin apuro"},
  {value: "media", label: "Próximas semanas"},
  {value: "alta", label: "Lo antes posible"},
];

interface FormData {
  nombre: string;
  email: string;
  telefono: string;
  servicio: string;
  presupuesto_rango: string;
  descripcion: string;
  urgencia: string;
  consentimiento: boolean;
  // Opcional: si el desarrollador no puede tomar el pedido, que lo vean
  // otros (bolsa de proyectos). Casilla aparte y sin marcar (ley 25.326).
  compartir_bolsa: boolean;
  // Honeypot: el campo está escondido, así que una persona lo deja vacío.
  sitio_web: string;
}

const INITIAL_FORM: FormData = {
  nombre: "",
  email: "",
  telefono: "",
  servicio: "",
  presupuesto_rango: "",
  descripcion: "",
  urgencia: "media",
  consentimiento: false,
  compartir_bolsa: false,
  sitio_web: "",
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const inputClass =
  "w-full border-b border-rule bg-transparent pt-1 pb-3 text-[15px] text-ink placeholder-mist outline-none transition duration-200 ease hover:border-mist focus:border-ochre focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ochre";

const labelClass = "mb-2 block text-[10px] tracking-[0.16em] text-faint uppercase";

const errorTextClass = "mt-1.5 text-[12px] text-brick";

// Opción elegible con aspecto de tarjeta o de botón: el radio real queda
// escondido (sr-only, sigue siendo el que recibe el foco y el teclado) y la
// etiqueta se pinta según esté marcado.
const opcionClass =
  "flex cursor-pointer border px-4 py-3 transition duration-200 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ochre";
const opcionActiva = "border-ochre bg-ochre/5 text-ink";
const opcionInactiva = "border-rule text-ink-soft hover:border-mist";

function SectionHeader({num, title}: {num: string; title: string}) {
  return (
    <div className="mb-6 flex items-baseline gap-3">
      <span className="text-ochre font-serif text-[17px]">{num}</span>
      <span className="text-ink-soft text-[10px] tracking-[0.2em] uppercase">{title}</span>
      <div className="bg-rule-soft h-px flex-1" />
    </div>
  );
}

// `espacio`: la dirección del desarrollador al que va el pedido (/f/<slug>).
export default function LeadForm({espacio}: {espacio: string}) {
  const {
    register,
    handleSubmit,
    watch,
    formState: {errors, isSubmitting},
  } = useForm<FormData>({defaultValues: INITIAL_FORM, mode: "onBlur"});

  const servicio = watch("servicio");
  const urgencia = watch("urgencia");
  const presupuestoRango = watch("presupuesto_rango");
  const descripcion = watch("descripcion");

  // Resultado del envío (red/servidor), separado de los errores de validación
  // por campo que ahora resuelve react-hook-form.
  const [success, setSuccess] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submitErrorRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);

  // Cerrojo de envío. `formState.isSubmitting` de
  // react-hook-form depende de un re-render igual que el `loading` manual de
  // antes: entre el primer clic y el repintado hay una ventana en la que un
  // segundo clic —o un Enter repetido— entra igual al submit. La referencia se
  // actualiza de forma síncrona y cierra esa ventana. Es la mitad de la
  // mitigación: la otra es la deduplicación por correo del backend, que es la
  // que vale, porque el navegador no es un lugar donde apoyar una garantía (el
  // webhook es público y `fetch` se puede repetir a mano).
  const enviando = useRef(false);

  const descripcionLength = descripcion.trim().length;

  const onSubmit = handleSubmit(async (data) => {
    if (enviando.current) return;

    setSubmitError(null);

    // Si el campo trampa vino completo, se simula el éxito sin mandar nada:
    // al bot no le sirve saber que lo descubrieron. n8n lo rechaza igual si
    // alguien le pega directo al webhook.
    if (data.sitio_web.trim()) {
      setSuccess(true);

      return;
    }

    if (!N8N_BASE) {
      setSubmitError("Falta la variable NEXT_PUBLIC_N8N_BASE.");

      return;
    }

    enviando.current = true;
    try {
      const response = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "true",
        },
        body: JSON.stringify({
          ...data,
          fuente: "formulario_web",
          espacio,
          timestamp: new Date().toISOString(),
        }),
      });

      if (!response.ok) throw new Error(`Error del servidor: ${response.status}`);

      setSuccess(true);
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : "Ocurrió un error al enviar el formulario. Intentá de nuevo.",
      );
    } finally {
      // Se libera siempre: si el envío falló hay que poder reintentar, y si
      // salió bien la pantalla ya pasó a «¡Gracias!» y el formulario no existe.
      enviando.current = false;
    }
  });

  // Foco al resultado del envío: sin esto, un lector de pantalla se queda
  // anunciando el último campo tocado en vez del desenlace del submit.
  useEffect(() => {
    if (success) successRef.current?.focus();
    else if (submitError) submitErrorRef.current?.focus();
  }, [success, submitError]);

  if (success) {
    return (
      <div className="border-rule-soft bg-card flex flex-col items-start gap-5 border px-8 py-14 shadow-[0_1px_2px_rgba(25,23,19,0.04),0_12px_32px_-18px_rgba(25,23,19,0.18)] sm:px-11">
        <svg
          aria-hidden="true"
          className="text-ochre"
          fill="none"
          height={38}
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.3}
          viewBox="0 0 24 24"
          width={38}
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M8 12.4l2.6 2.6L16 9.6" />
        </svg>
        <h2
          ref={successRef}
          className="text-ink font-serif text-[38px] leading-none tracking-tight outline-none"
          tabIndex={-1}
        >
          ¡Gracias!
        </h2>
        <p className="text-muted max-w-sm text-[14.5px] leading-relaxed">
          Recibimos tu consulta. Esto es lo que sigue:
        </p>
        <ol className="border-rule-soft w-full max-w-md border-t">
          {[
            "Te llega un correo confirmando que recibimos tu consulta.",
            "La revisamos y te respondemos en menos de 24 horas.",
            "Si el proyecto encaja, te mandamos una propuesta con precio y plazo para que la aceptes en línea.",
          ].map((paso, i) => (
            <li
              key={paso}
              className="border-rule-soft text-ink-soft flex gap-4 border-b py-3.5 text-[14px] leading-relaxed"
            >
              <span className="text-ochre font-serif text-[17px] leading-none">{i + 1}</span>
              <span>{paso}</span>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    // No hace falta un onKeyDown en el <form>: con un botón type="submit" el
    // navegador ya dispara onSubmit al presionar Enter en un input de una línea,
    // y respeta el salto de línea dentro del textarea. El listener manual además
    // violaba jsx-a11y/no-noninteractive-element-interactions.
    <form
      noValidate
      className="border-rule-soft bg-card border shadow-[0_1px_2px_rgba(25,23,19,0.04),0_12px_32px_-18px_rgba(25,23,19,0.18)]"
      onSubmit={onSubmit}
    >
      {submitError && (
        <div
          ref={submitErrorRef}
          className="border-rule-soft border-l-brick bg-brick/5 text-brick border-b border-l-2 px-8 py-4 text-[13px] outline-none sm:px-10"
          role="alert"
          tabIndex={-1}
        >
          {submitError}
        </div>
      )}

      {/* I — Contacto */}
      <section className="border-rule-soft border-b px-8 py-8 sm:px-10">
        <SectionHeader num="I" title="Contacto" />
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="nombre">
              Nombre <span className="text-ochre">*</span>
            </label>
            <input
              required
              aria-describedby={errors.nombre ? "nombre-error" : undefined}
              aria-invalid={!!errors.nombre}
              autoComplete="name"
              className={inputClass}
              id="nombre"
              maxLength={100}
              placeholder="María González"
              type="text"
              {...register("nombre", {
                // Mismas reglas que Code - Normalizar Lead en n8n, que es quien las hace cumplir.
                validate: (v) => {
                  if (v.trim().length < 2) return "El nombre debe tener al menos 2 caracteres.";
                  if (v.trim().length > 100) return "El nombre puede tener hasta 100 caracteres.";
                  if (/:\/\/|www\./i.test(v)) return "El nombre no puede incluir enlaces.";

                  return true;
                },
              })}
            />
            {errors.nombre && (
              <p className={errorTextClass} id="nombre-error" role="alert">
                {errors.nombre.message}
              </p>
            )}
          </div>

          <div>
            <label className={labelClass} htmlFor="email">
              Email <span className="text-ochre">*</span>
            </label>
            <input
              required
              aria-describedby={errors.email ? "email-error" : undefined}
              aria-invalid={!!errors.email}
              autoComplete="email"
              className={inputClass}
              id="email"
              placeholder="tu@email.com"
              type="email"
              {...register("email", {
                validate: (v) =>
                  EMAIL_REGEX.test(v.trim()) || "El email no tiene un formato válido.",
              })}
            />
            {errors.email && (
              <p className={errorTextClass} id="email-error" role="alert">
                {errors.email.message}
              </p>
            )}
          </div>

          <div className="sm:col-span-2 sm:max-w-xs">
            <label className={labelClass} htmlFor="telefono">
              Teléfono
            </label>
            <input
              autoComplete="tel"
              className={inputClass}
              id="telefono"
              placeholder="+54 11 1234-5678"
              type="tel"
              {...register("telefono")}
            />
          </div>
        </div>
      </section>

      {/* II — Proyecto */}
      <section className="border-rule-soft border-b px-8 py-8 sm:px-10">
        <SectionHeader num="II" title="Proyecto" />

        <fieldset className="mb-8">
          <legend className={labelClass}>
            Servicio <span className="text-ochre">*</span>
          </legend>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {SERVICIOS.map((s) => (
              <label
                key={s.value}
                className={`${opcionClass} flex-col gap-1 ${
                  servicio === s.value ? opcionActiva : opcionInactiva
                }`}
              >
                <input
                  required
                  className="sr-only"
                  type="radio"
                  value={s.value}
                  {...register("servicio", {
                    required: "Debés seleccionar un servicio.",
                  })}
                />
                <span className="text-[14px] leading-snug">{s.value}</span>
                <span className="text-mist text-[12px] leading-snug">{s.detalle}</span>
              </label>
            ))}
          </div>
          {errors.servicio && (
            <p className={errorTextClass} role="alert">
              {errors.servicio.message}
            </p>
          )}
        </fieldset>

        <fieldset>
          <legend className={labelClass}>¿Para cuándo lo necesitás?</legend>
          <div className="grid grid-cols-3">
            {URGENCIAS.map((u, i) => (
              <label
                key={u.value}
                className={`${opcionClass} items-center justify-center text-center text-[13px] leading-snug ${
                  i > 0 ? "-ml-px" : ""
                } ${urgencia === u.value ? `${opcionActiva} relative z-10` : opcionInactiva}`}
              >
                <input className="sr-only" type="radio" value={u.value} {...register("urgencia")} />
                {u.label}
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      {/* III — Presupuesto */}
      <section className="border-rule-soft border-b px-8 py-8 sm:px-10">
        <SectionHeader num="III" title="Presupuesto" />
        <fieldset>
          <legend className={labelClass}>
            ¿Cuánto pensás invertir? <span className="text-ochre">*</span>
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {RANGOS_PRESUPUESTO.map((r) => (
              <label
                key={r.clave}
                className={`${opcionClass} items-center gap-3 text-[14px] ${
                  presupuestoRango === r.clave ? opcionActiva : opcionInactiva
                }`}
              >
                <input
                  required
                  className="sr-only"
                  type="radio"
                  value={r.clave}
                  {...register("presupuesto_rango", {
                    required: "Elegí un rango de presupuesto.",
                  })}
                />
                <span
                  aria-hidden="true"
                  className={`size-3.5 shrink-0 rounded-full transition duration-200 ${
                    presupuestoRango === r.clave ? "border-ochre border-4" : "border-rule border"
                  }`}
                />
                {r.etiqueta}
              </label>
            ))}
          </div>
          {errors.presupuesto_rango && (
            <p className={errorTextClass} role="alert">
              {errors.presupuesto_rango.message}
            </p>
          )}
        </fieldset>
      </section>

      {/* IV — Descripción */}
      <section className="px-8 py-8 sm:px-10">
        <SectionHeader num="IV" title="Descripción" />
        <label className={labelClass} htmlFor="descripcion">
          Contanos tu proyecto <span className="text-ochre">*</span>
        </label>
        <textarea
          required
          aria-describedby={errors.descripcion ? "descripcion-error" : undefined}
          aria-invalid={!!errors.descripcion}
          className={`${inputClass} resize-y leading-relaxed`}
          id="descripcion"
          placeholder="Describí brevemente en qué consiste tu proyecto…"
          rows={4}
          {...register("descripcion", {
            validate: (v) =>
              v.trim().length >= 20 || "La descripción debe tener al menos 20 caracteres.",
          })}
        />
        <div className="mt-2 flex items-start justify-between gap-4">
          {errors.descripcion ? (
            <p className={errorTextClass} id="descripcion-error" role="alert">
              {errors.descripcion.message}
            </p>
          ) : (
            <span />
          )}
          <p
            className={`text-right font-serif text-[14px] italic ${
              descripcionLength >= 20 ? "text-moss" : "text-mist"
            }`}
          >
            {descripcionLength} / 20 mín.
          </p>
        </div>
      </section>

      {/* Consentimiento — art. 6 y arts. 11/12 de la Ley 25.326 */}
      <section className="border-rule-soft border-t px-8 py-7 sm:px-10">
        <label className="flex cursor-pointer items-start gap-3 text-[13px] leading-relaxed">
          <input
            required
            aria-describedby={errors.consentimiento ? "consentimiento-error" : undefined}
            aria-invalid={!!errors.consentimiento}
            className="border-rule accent-ochre mt-0.5 size-4 shrink-0 cursor-pointer"
            type="checkbox"
            {...register("consentimiento", {
              required: "Debés aceptar la Política de Privacidad para poder enviar el formulario.",
            })}
          />
          <span className="text-ink-soft">
            He leído y acepto el tratamiento de mis datos personales, incluida su transferencia
            internacional a los prestadores mencionados, conforme a la{" "}
            <Link
              className="text-ochre hover:text-ochre-deep underline underline-offset-2"
              href="/privacidad"
              target="_blank"
            >
              Política de Privacidad
            </Link>
            . <span className="text-ochre">*</span>
          </span>
        </label>
        {errors.consentimiento && (
          <p className={errorTextClass} id="consentimiento-error" role="alert">
            {errors.consentimiento.message}
          </p>
        )}
        <label className="mt-4 flex cursor-pointer items-start gap-3 text-[13px] leading-relaxed">
          <input
            className="border-rule accent-ochre mt-0.5 size-4 shrink-0 cursor-pointer"
            type="checkbox"
            {...register("compartir_bolsa")}
          />
          <span className="text-ink-soft">
            Si no pueden tomar mi proyecto, compártanlo con otros desarrolladores de la plataforma,
            sin mis datos de contacto, para que me ofrezcan hacerlo.{" "}
            <span className="text-mist">(Opcional)</span>
          </span>
        </label>
      </section>

      {/* Honeypot: fuera de la vista y del orden de tabulación. Los bots que
          completan todos los campos lo llenan; una persona no lo ve. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="sitio_web">Sitio web</label>
        <input
          autoComplete="off"
          id="sitio_web"
          tabIndex={-1}
          type="text"
          {...register("sitio_web")}
        />
      </div>

      <div className="px-8 pb-9 sm:px-10">
        <button
          className="ease bg-ink text-paper hover:bg-ochre w-full py-5 text-[11px] font-medium tracking-[0.2em] uppercase transition duration-200 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? "Enviando..." : "Enviar consulta"}
        </button>
      </div>
    </form>
  );
}
