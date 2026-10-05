"use client";

import type {TipoCuenta} from "@/lib/auth";
import type {ServicioTipo, UrgenciaTipo} from "@/types/supabase";

import Link from "next/link";
import {useRouter} from "next/navigation";
import {useEffect, useState} from "react";

import {RANGOS_PRESUPUESTO} from "@/lib/presupuesto";
import {SERVICIO_LEGIBLE, URGENCIA_LEGIBLE} from "@/lib/servicios";
import {createClient} from "@/lib/supabase/client";

// El borrador sobrevive al viaje del enlace mágico (se abre en otra pestaña o
// se recarga la página). Sólo en este navegador; si no está, el formulario
// arranca vacío.
const BORRADOR = "formularioleads:borrador-proyecto";

interface Proyecto {
  titulo: string;
  descripcion: string;
  servicio: ServicioTipo | "";
  presupuesto_rango: string;
  urgencia: UrgenciaTipo;
  nombre: string;
  telefono: string;
  // Etiquetas de habilidades, separadas por comas (opcionales).
  etiquetas: string;
}

const VACIO: Proyecto = {
  titulo: "",
  descripcion: "",
  servicio: "",
  presupuesto_rango: "",
  urgencia: "media",
  nombre: "",
  telefono: "",
  etiquetas: "",
};

// Mismas reglas que publicar_proyecto(): sin vacías ni repetidas, hasta 8.
function aEtiquetas(texto: string): string[] {
  const vistas = new Set<string>();

  return texto
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e && !vistas.has(e.toLowerCase()) && vistas.add(e.toLowerCase()));
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function leerBorrador(): Proyecto | null {
  try {
    const guardado = localStorage.getItem(BORRADOR);

    if (!guardado) return null;
    const dato: unknown = JSON.parse(guardado);

    if (!dato || typeof dato !== "object" || Array.isArray(dato)) return null;
    const campos = dato as Record<string, unknown>;

    // El borrador puede sobrevivir a una versión anterior del formulario.
    // No confiar en el tipo TypeScript al leer JSON de localStorage.
    if (
      Object.keys(VACIO).some(
        (clave) => campos[clave] !== undefined && typeof campos[clave] !== "string",
      )
    )
      return null;
    const borrador = {...VACIO, ...campos} as Proyecto;

    if (borrador.servicio && !(borrador.servicio in SERVICIO_LEGIBLE)) return null;
    if (
      borrador.presupuesto_rango &&
      !RANGOS_PRESUPUESTO.some((r) => r.clave === borrador.presupuesto_rango)
    )
      return null;
    if (!["baja", "media", "alta"].includes(borrador.urgencia)) return null;

    return borrador;
  } catch {
    return null;
  }
}

function guardarBorrador(p: Proyecto) {
  try {
    localStorage.setItem(BORRADOR, JSON.stringify(p));
  } catch {
    // Sin almacenamiento (navegación privada): el cliente vuelve a cargarlo.
  }
}

function borrarBorrador() {
  try {
    localStorage.removeItem(BORRADOR);
  } catch {
    // Nada que borrar.
  }
}

// Mismas reglas que publicar_proyecto() en la base, que es la que manda.
function errores(p: Proyecto): Partial<Record<keyof Proyecto, string>> {
  const e: Partial<Record<keyof Proyecto, string>> = {};

  if (p.titulo.trim().length < 5) e.titulo = "El título tiene que tener al menos 5 caracteres.";
  if (p.descripcion.trim().length < 20)
    e.descripcion = "Contá un poco más: al menos 20 caracteres.";
  if (!p.servicio) e.servicio = "Elegí qué tipo de trabajo es.";
  if (!p.presupuesto_rango) e.presupuesto_rango = "Elegí un rango de presupuesto.";
  if (p.nombre.trim().length < 2) e.nombre = "Tu nombre tiene que tener al menos 2 caracteres.";
  const etiquetas = aEtiquetas(p.etiquetas);

  if (etiquetas.length > 8) e.etiquetas = "Hasta 8 etiquetas.";
  else if (etiquetas.some((x) => x.length > 40))
    e.etiquetas = "Cada etiqueta puede tener hasta 40 caracteres.";

  return e;
}

const inputClass =
  "w-full border-b border-rule bg-transparent pt-1 pb-3 text-[15px] text-ink placeholder-mist outline-none transition duration-200 hover:border-mist focus:border-ochre";
const labelClass = "mb-2 block text-[10px] tracking-[0.16em] text-faint uppercase";
const errorClass = "mt-1.5 text-[12px] text-brick";
const opcionClass =
  "flex cursor-pointer border px-4 py-3 text-[14px] transition duration-200 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ochre";
const activa = "border-ochre bg-ochre/5 text-ink";
const inactiva = "border-rule text-ink-soft hover:border-mist";
const tarjetaClass =
  "border-rule-soft bg-card border shadow-[0_1px_2px_rgba(25,23,19,0.04),0_12px_32px_-18px_rgba(25,23,19,0.18)]";

export default function PublicarForm({tipo}: {tipo: TipoCuenta | null}) {
  const router = useRouter();
  const [p, setP] = useState<Proyecto>(VACIO);
  const [email, setEmail] = useState("");
  const [consentimiento, setConsentimiento] = useState(false);
  const [intento, setIntento] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [enlaceEnviado, setEnlaceEnviado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Vuelve del enlace mágico con lo que había cargado.
  const [recuperado, setRecuperado] = useState(false);

  useEffect(() => {
    const borrador = leerBorrador();

    if (!borrador) return;

    // Leer localStorage recién en el cliente evita que el HTML del servidor
    // (siempre vacío) no coincida con el del navegador.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setP(borrador);
    setRecuperado(true);
  }, []);

  const cambiar = <K extends keyof Proyecto>(campo: K, valor: Proyecto[K]) =>
    setP((actual) => ({...actual, [campo]: valor}));

  if (tipo === "desarrollador") {
    return (
      <div className={`${tarjetaClass} flex flex-col gap-4 px-8 py-12`}>
        <h2 className="text-ink font-serif text-[28px] leading-tight">
          Tu cuenta es de desarrollador.
        </h2>
        <p className="text-muted text-[14.5px] leading-relaxed">
          Para publicar un proyecto como cliente, salí y entrá con otro correo desde{" "}
          <Link className="text-ochre underline underline-offset-2" href="/cliente/entrar">
            Soy cliente
          </Link>
          . Los proyectos publicados los ves en la{" "}
          <Link className="text-ochre underline underline-offset-2" href="/dashboard/bolsa">
            Bolsa
          </Link>
          .
        </p>
      </div>
    );
  }

  if (enlaceEnviado) {
    return (
      <div className={`${tarjetaClass} flex flex-col gap-4 px-8 py-12`} role="status">
        <h2 className="text-ink font-serif text-[30px] leading-tight">Revisá tu correo.</h2>
        <p className="text-muted text-[14.5px] leading-relaxed">
          Te mandamos un enlace a <b className="text-ink">{email.trim()}</b>. Abrilo en este mismo
          navegador: vas a volver acá con tu proyecto cargado, listo para publicar.
        </p>
      </div>
    );
  }

  const e = intento ? errores(p) : {};
  const sinSesion = tipo === null;

  async function enviar(ev: React.FormEvent) {
    ev.preventDefault();
    setIntento(true);
    setError(null);

    if (Object.keys(errores(p)).length || !consentimiento) return;
    if (sinSesion && !EMAIL_REGEX.test(email.trim())) return;

    const supabase = createClient();

    if (!supabase) {
      setError("Faltan las variables de Supabase.");

      return;
    }

    setEnviando(true);

    if (sinSesion) {
      guardarBorrador(p);

      const {error: err} = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}/auth/confirm?next=/publicar`,
          data: {tipo: "cliente"},
        },
      });

      setEnviando(false);
      if (err) setError("No pudimos mandar el enlace. Probá de nuevo en un rato.");
      else setEnlaceEnviado(true);

      return;
    }

    const {error: err} = await supabase.rpc("publicar_proyecto", {
      p_titulo: p.titulo.trim(),
      p_descripcion: p.descripcion.trim(),
      p_servicio: p.servicio as ServicioTipo,
      p_urgencia: p.urgencia,
      p_presupuesto_rango: p.presupuesto_rango,
      p_nombre: p.nombre.trim(),
      p_telefono: p.telefono.trim() || null,
      p_etiquetas: aEtiquetas(p.etiquetas),
    });

    if (err) {
      setEnviando(false);
      // Los mensajes de la base ya están escritos para una persona.
      setError(err.message);

      return;
    }

    borrarBorrador();
    router.push("/cliente?publicado=1");
  }

  return (
    <form noValidate className={tarjetaClass} onSubmit={enviar}>
      {recuperado && !sinSesion && (
        <p
          className="border-rule-soft border-l-moss bg-moss/5 text-ink-soft border-b border-l-2 px-8 py-4 text-[13px] sm:px-10"
          role="status"
        >
          Ya entraste. Revisá tu proyecto y publicalo.
        </p>
      )}

      <section className="border-rule-soft flex flex-col gap-6 border-b px-8 py-8 sm:px-10">
        <div>
          <label className={labelClass} htmlFor="titulo">
            Título <span className="text-ochre">*</span>
          </label>
          <input
            className={inputClass}
            id="titulo"
            maxLength={120}
            placeholder="Tienda online para mi marca de ropa"
            value={p.titulo}
            onChange={(ev) => cambiar("titulo", ev.target.value)}
          />
          {e.titulo && <p className={errorClass}>{e.titulo}</p>}
        </div>
        <div>
          <label className={labelClass} htmlFor="descripcion">
            ¿Qué necesitás? <span className="text-ochre">*</span>
          </label>
          <textarea
            className={`${inputClass} resize-y leading-relaxed`}
            id="descripcion"
            maxLength={2000}
            placeholder="Contá qué querés lograr, qué tenés hecho y qué te falta."
            rows={5}
            value={p.descripcion}
            onChange={(ev) => cambiar("descripcion", ev.target.value)}
          />
          <p className="text-mist mt-1.5 text-[12px]">
            Lo ven todos los desarrolladores: no pongas teléfonos, correos ni direcciones.
          </p>
          {e.descripcion && <p className={errorClass}>{e.descripcion}</p>}
        </div>
      </section>

      <section className="border-rule-soft flex flex-col gap-7 border-b px-8 py-8 sm:px-10">
        <fieldset>
          <legend className={labelClass}>
            Tipo de trabajo <span className="text-ochre">*</span>
          </legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(Object.keys(SERVICIO_LEGIBLE) as ServicioTipo[]).map((s) => (
              <label key={s} className={`${opcionClass} ${p.servicio === s ? activa : inactiva}`}>
                <input
                  checked={p.servicio === s}
                  className="sr-only"
                  name="servicio"
                  type="radio"
                  onChange={() => cambiar("servicio", s)}
                />
                {SERVICIO_LEGIBLE[s]}
              </label>
            ))}
          </div>
          {e.servicio && <p className={errorClass}>{e.servicio}</p>}
        </fieldset>

        <fieldset>
          <legend className={labelClass}>
            Presupuesto <span className="text-ochre">*</span>
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {RANGOS_PRESUPUESTO.map((r) => (
              <label
                key={r.clave}
                className={`${opcionClass} ${p.presupuesto_rango === r.clave ? activa : inactiva}`}
              >
                <input
                  checked={p.presupuesto_rango === r.clave}
                  className="sr-only"
                  name="presupuesto_rango"
                  type="radio"
                  onChange={() => cambiar("presupuesto_rango", r.clave)}
                />
                {r.etiqueta}
              </label>
            ))}
          </div>
          {e.presupuesto_rango && <p className={errorClass}>{e.presupuesto_rango}</p>}
        </fieldset>

        <div>
          <label className={labelClass} htmlFor="etiquetas">
            Habilidades que buscás (opcional)
          </label>
          <input
            className={inputClass}
            id="etiquetas"
            placeholder="Shopify, React Native, WordPress"
            value={p.etiquetas}
            onChange={(ev) => cambiar("etiquetas", ev.target.value)}
          />
          <p className="text-mist mt-1.5 text-[12px]">
            Separadas por comas, hasta 8. Si no sabés qué tecnología necesitás, dejalo vacío.
          </p>
          {aEtiquetas(p.etiquetas).length > 0 && (
            <ul aria-label="Etiquetas" className="mt-3 flex flex-wrap gap-1.5">
              {aEtiquetas(p.etiquetas).map((x) => (
                <li key={x} className="border-rule text-ink-soft border px-2.5 py-1 text-[12px]">
                  {x}
                </li>
              ))}
            </ul>
          )}
          {e.etiquetas && <p className={errorClass}>{e.etiquetas}</p>}
        </div>

        <fieldset>
          <legend className={labelClass}>¿Para cuándo lo necesitás?</legend>
          <div className="grid grid-cols-3">
            {(["baja", "media", "alta"] as UrgenciaTipo[]).map((u, i) => (
              <label
                key={u}
                className={`${opcionClass} items-center justify-center text-center text-[13px] ${
                  i > 0 ? "-ml-px" : ""
                } ${p.urgencia === u ? `${activa} relative z-10` : inactiva}`}
              >
                <input
                  checked={p.urgencia === u}
                  className="sr-only"
                  name="urgencia"
                  type="radio"
                  onChange={() => cambiar("urgencia", u)}
                />
                {URGENCIA_LEGIBLE[u]}
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <section className="border-rule-soft grid gap-6 border-b px-8 py-8 sm:grid-cols-2 sm:px-10">
        <p className="text-muted text-[13px] leading-relaxed sm:col-span-2">
          Tus datos de contacto no se publican: sólo le llegan al desarrollador que elijas.
        </p>
        <div>
          <label className={labelClass} htmlFor="nombre">
            Tu nombre <span className="text-ochre">*</span>
          </label>
          <input
            autoComplete="name"
            className={inputClass}
            id="nombre"
            maxLength={100}
            value={p.nombre}
            onChange={(ev) => cambiar("nombre", ev.target.value)}
          />
          {e.nombre && <p className={errorClass}>{e.nombre}</p>}
        </div>
        <div>
          <label className={labelClass} htmlFor="telefono">
            Teléfono
          </label>
          <input
            autoComplete="tel"
            className={inputClass}
            id="telefono"
            type="tel"
            value={p.telefono}
            onChange={(ev) => cambiar("telefono", ev.target.value)}
          />
        </div>
        {sinSesion && (
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="email">
              Tu correo <span className="text-ochre">*</span>
            </label>
            <input
              autoComplete="email"
              className={inputClass}
              id="email"
              placeholder="tu@email.com"
              type="email"
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
            />
            <p className="text-mist mt-1.5 text-[12px]">
              Te mandamos un enlace para confirmarlo; con eso se crea tu cuenta, sin contraseña.
            </p>
            {intento && !EMAIL_REGEX.test(email.trim()) && (
              <p className={errorClass}>El correo no tiene un formato válido.</p>
            )}
          </div>
        )}
      </section>

      <section className="px-8 py-7 sm:px-10">
        <label className="flex cursor-pointer items-start gap-3 text-[13px] leading-relaxed">
          <input
            checked={consentimiento}
            className="accent-ochre mt-0.5 size-4 shrink-0 cursor-pointer"
            type="checkbox"
            onChange={(ev) => setConsentimiento(ev.target.checked)}
          />
          <span className="text-ink-soft">
            Acepto que el proyecto se publique para los desarrolladores de la plataforma, sin mis
            datos de contacto, y que esos datos se compartan sólo con quien elija, conforme a la{" "}
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
        {intento && !consentimiento && (
          <p className={errorClass}>Necesitamos tu aceptación para publicar el proyecto.</p>
        )}

        {error && (
          <p className="text-brick mt-5 text-[13px]" role="alert">
            {error}
          </p>
        )}

        <button
          className="ease bg-ink text-paper hover:bg-ochre mt-7 w-full py-5 text-[11px] font-medium tracking-[0.2em] uppercase transition duration-200 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={enviando}
          type="submit"
        >
          {enviando ? "Enviando…" : sinSesion ? "Continuar con mi correo" : "Publicar proyecto"}
        </button>
      </section>
    </form>
  );
}
