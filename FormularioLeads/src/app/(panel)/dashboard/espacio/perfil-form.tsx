"use client";

import Link from "next/link";
import {useRouter} from "next/navigation";
import {useState} from "react";

import {createClient} from "@/lib/supabase/client";

const MAX_HABILIDADES = 15;
const MAX_ENLACES = 5;
const URL_VALIDA = /^https?:\/\/[^\s<>"]+$/;

const inputClass =
  "w-full border-b border-rule bg-transparent pt-1 pb-3 text-[15px] text-ink placeholder-mist outline-none transition duration-200 ease hover:border-mist focus:border-ochre";
const labelClass = "mb-2 block text-[10px] tracking-[0.16em] text-faint uppercase";

// Las habilidades se escriben separadas por comas: más simple que un editor
// de etiquetas y alcanza para 15. Se limpian y se sacan las repetidas.
function aHabilidades(texto: string): string[] {
  const vistas = new Set<string>();

  return texto
    .split(",")
    .map((h) => h.trim())
    .filter((h) => h && !vistas.has(h.toLowerCase()) && vistas.add(h.toLowerCase()));
}

// Perfil público del desarrollador: lo ven los clientes al elegir entre las
// postulaciones. La base valida los mismos límites (trg_espacios_validar_perfil).
export default function PerfilForm({
  espacio,
}: {
  espacio: {
    id: string;
    slug: string;
    presentacion: string | null;
    habilidades: string[];
    portfolio_urls: string[];
  };
}) {
  const router = useRouter();
  const [presentacion, setPresentacion] = useState(espacio.presentacion ?? "");
  const [habilidades, setHabilidades] = useState(espacio.habilidades.join(", "));
  const [enlaces, setEnlaces] = useState<string[]>(
    Array.from({length: MAX_ENLACES}, (_, i) => espacio.portfolio_urls[i] ?? ""),
  );
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lista = aHabilidades(habilidades);
  const urls = enlaces.map((u) => u.trim()).filter(Boolean);
  const problema =
    lista.length > MAX_HABILIDADES
      ? `Hasta ${MAX_HABILIDADES} habilidades.`
      : lista.some((h) => h.length > 40)
        ? "Cada habilidad puede tener hasta 40 caracteres."
        : urls.some((u) => !URL_VALIDA.test(u))
          ? "Los enlaces tienen que empezar con http:// o https://."
          : null;

  return (
    <section className="border-rule mt-12 border-t pt-10">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-ink font-serif text-[26px] leading-tight">Tu perfil público</h2>
        <Link
          className="text-ochre hover:text-ochre-deep text-[12.5px] transition duration-200"
          href={`/d/${espacio.slug}`}
          target="_blank"
        >
          Ver cómo se ve ↗
        </Link>
      </div>
      <p className="text-muted mb-8 text-[14px] leading-relaxed">
        Es lo que ven los clientes al comparar postulaciones, junto con tus estrellas.
      </p>

      <form
        className="flex flex-col gap-7"
        onSubmit={async (e) => {
          e.preventDefault();
          if (problema || guardando) return;

          const supabase = createClient();

          if (!supabase) return;

          setGuardando(true);
          setGuardado(false);
          setError(null);

          const {data, error: err} = await supabase
            .from("espacios")
            .update({
              presentacion: presentacion.trim() || null,
              habilidades: lista,
              portfolio_urls: urls,
            })
            .eq("id", espacio.id)
            .select("id");

          setGuardando(false);
          if (err || !data?.length) {
            setError(
              err?.message ?? "No se pudo guardar. Volvé a iniciar sesión y probá de nuevo.",
            );

            return;
          }
          setGuardado(true);
          router.refresh();
        }}
      >
        <div>
          <label className={labelClass} htmlFor="presentacion">
            Presentación
          </label>
          <textarea
            className={`${inputClass} resize-y leading-relaxed`}
            id="presentacion"
            maxLength={1500}
            placeholder="Quién sos, qué hacés y con qué tipo de clientes trabajás."
            rows={5}
            value={presentacion}
            onChange={(e) => setPresentacion(e.target.value)}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="habilidades">
            Habilidades
          </label>
          <input
            className={inputClass}
            id="habilidades"
            placeholder="React, Next.js, Tiendas online, Diseño UX"
            value={habilidades}
            onChange={(e) => setHabilidades(e.target.value)}
          />
          <p className="text-mist mt-1.5 text-[12px]">
            Separadas por comas, hasta {MAX_HABILIDADES}.
          </p>
          {lista.length > 0 && (
            <ul aria-label="Así se ven" className="mt-3 flex flex-wrap gap-1.5">
              {lista.map((h) => (
                <li key={h} className="border-rule text-ink-soft border px-2.5 py-1 text-[12px]">
                  {h}
                </li>
              ))}
            </ul>
          )}
        </div>

        <fieldset>
          <legend className={labelClass}>Portfolio (hasta {MAX_ENLACES} enlaces)</legend>
          <div className="flex flex-col gap-3">
            {enlaces.map((u, i) => (
              <input
                key={i}
                aria-label={`Enlace ${i + 1} del portfolio`}
                className={inputClass}
                inputMode="url"
                placeholder={i === 0 ? "https://mi-trabajo.com" : ""}
                value={u}
                onChange={(e) =>
                  setEnlaces((actual) => actual.map((x, j) => (j === i ? e.target.value : x)))
                }
              />
            ))}
          </div>
        </fieldset>

        {(problema || error) && (
          <p className="text-brick text-[13px]" role="alert">
            {problema ?? error}
          </p>
        )}
        {guardado && (
          <p className="text-moss text-[13px]" role="status">
            Guardamos tu perfil.
          </p>
        )}

        <button
          className="ease bg-ink text-paper hover:bg-ochre w-full py-4 text-[11px] font-medium tracking-[0.2em] uppercase transition duration-200 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={Boolean(problema) || guardando}
          type="submit"
        >
          {guardando ? "Guardando…" : "Guardar perfil"}
        </button>
      </form>
    </section>
  );
}
