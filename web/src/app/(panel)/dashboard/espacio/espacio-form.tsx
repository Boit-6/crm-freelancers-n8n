"use client";

import type {Espacio} from "@/lib/auth";

import {useRouter} from "next/navigation";
import {useEffect, useState} from "react";

import {
  errorDeEmail,
  errorDeNombre,
  errorDeSlug,
  esSlugProvisorio,
  mensajeDeErrorDb,
  slugDesde,
} from "@/lib/espacios";
import {createClient} from "@/lib/supabase/client";

const inputClass =
  "w-full border-b border-rule bg-transparent pt-1 pb-3 text-[15px] text-ink placeholder-mist outline-none transition duration-200 ease hover:border-mist focus:border-ochre";

const labelClass = "mb-2 block text-[10px] tracking-[0.16em] text-faint uppercase";

// Alta y edición del espacio: nombre (la marca que ve el cliente) y dirección
// del formulario (/f/<slug>). Escribe directo con la sesión del dueño: la RLS
// sólo le deja tocar su fila, y el GRANT por columna, sólo esos dos campos.
export default function EspacioForm({
  espacio,
  bienvenida,
}: {
  espacio: Espacio;
  bienvenida: boolean;
}) {
  const router = useRouter();
  const [nombre, setNombre] = useState(bienvenida ? "" : espacio.nombre);
  const [email, setEmail] = useState(espacio.email_contacto ?? "");
  const [slug, setSlug] = useState(esSlugProvisorio(espacio.slug) ? "" : espacio.slug);
  // Mientras no toque la dirección a mano, se propone a partir del nombre.
  const [slugTocado, setSlugTocado] = useState(!esSlugProvisorio(espacio.slug) && !bienvenida);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);
  const [origen, setOrigen] = useState("");

  useEffect(() => setOrigen(window.location.origin), []);

  const link = `${origen}/f/${slug || "tu-direccion"}`;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setGuardado(false);

    const invalido = errorDeNombre(nombre) ?? errorDeSlug(slug) ?? errorDeEmail(email);

    if (invalido) {
      setError(invalido);

      return;
    }

    const supabase = createClient();

    if (!supabase) {
      setError("Faltan las variables NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.");

      return;
    }

    setGuardando(true);
    try {
      const {data, error: dbError} = await supabase
        .from("espacios")
        .update({nombre: nombre.trim(), slug, email_contacto: email.trim()})
        .eq("id", espacio.id)
        .select("id");

      if (dbError) {
        setError(mensajeDeErrorDb(dbError.code));

        return;
      }

      // Sin filas: la RLS no la dejó pasar (la sesión venció, por ejemplo).
      if (!data?.length) {
        setError("No se pudo guardar. Volvé a iniciar sesión y probá de nuevo.");

        return;
      }

      if (bienvenida) {
        // El refresh vuelve a pedir el layout del panel, que recién ahora
        // muestra el menú (lo esconde mientras el espacio no está configurado).
        router.push("/dashboard");
        router.refresh();
      } else {
        setGuardado(true);
        router.refresh();
      }
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form className="flex flex-col gap-8" onSubmit={handleSubmit}>
      {error && (
        <div
          className="border-brick bg-brick/5 text-brick border-l-2 px-5 py-3.5 text-[13px]"
          id="espacio-error"
          role="alert"
        >
          {error}
        </div>
      )}
      {guardado && (
        <div
          className="border-moss bg-moss/5 text-moss border-l-2 px-5 py-3.5 text-[13px]"
          role="status"
        >
          Listo, quedó guardado.
        </div>
      )}

      <div>
        <label className={labelClass} htmlFor="nombre">
          Nombre
        </label>
        <input
          required
          aria-describedby={error ? "espacio-error" : undefined}
          autoComplete="organization"
          className={inputClass}
          id="nombre"
          maxLength={80}
          name="nombre"
          placeholder="Estudio Ana Gómez"
          value={nombre}
          onChange={(e) => {
            setNombre(e.target.value);
            if (!slugTocado) setSlug(slugDesde(e.target.value));
          }}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="slug">
          Dirección de tu formulario
        </label>
        <div className="flex items-baseline gap-1">
          <span className="text-faint shrink-0 text-[15px]">/f/</span>
          <input
            required
            aria-describedby="slug-ayuda"
            autoCapitalize="none"
            autoComplete="off"
            className={inputClass}
            id="slug"
            maxLength={40}
            name="slug"
            placeholder="estudio-ana"
            spellCheck={false}
            value={slug}
            onChange={(e) => {
              setSlugTocado(true);
              setSlug(e.target.value.toLowerCase());
            }}
          />
        </div>
        <p className="text-faint mt-2 text-[12.5px] leading-relaxed break-all" id="slug-ayuda">
          Tus clientes van a entrar por <span className="text-ink-soft">{link}</span>
        </p>
      </div>

      <div>
        <label className={labelClass} htmlFor="email">
          Correo para tus clientes
        </label>
        <input
          required
          aria-describedby="email-ayuda"
          autoComplete="email"
          className={inputClass}
          id="email"
          name="email"
          placeholder="hola@tuestudio.com"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <p className="text-faint mt-2 text-[12.5px] leading-relaxed" id="email-ayuda">
          Los correos a tus clientes salen con tu nombre, y cuando te responden, la respuesta llega
          acá.
        </p>
      </div>

      <button
        className="ease bg-ink text-paper hover:bg-ochre w-full py-4.5 text-[11px] font-medium tracking-[0.2em] uppercase transition duration-200 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={guardando}
        type="submit"
      >
        {guardando ? "Guardando..." : bienvenida ? "Crear mi espacio" : "Guardar"}
      </button>
    </form>
  );
}
