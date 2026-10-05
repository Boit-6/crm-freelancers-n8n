"use client";

import type {ServicioTipo} from "@/types/supabase";

import {useRouter} from "next/navigation";
import {useState} from "react";

import {SERVICIO_LEGIBLE} from "@/lib/servicios";
import {createClient} from "@/lib/supabase/client";

// Los pisos de los rangos de presupuesto (los mismos cortes del scoring).
const MINIMOS = [
  {valor: "", etiqueta: "Cualquier presupuesto"},
  {valor: "300", etiqueta: "Desde US$ 300"},
  {valor: "1000", etiqueta: "Desde US$ 1.000"},
  {valor: "2000", etiqueta: "Desde US$ 2.000"},
  {valor: "5000", etiqueta: "Desde US$ 5.000"},
];

const labelClass = "mb-3 block text-[10px] tracking-[0.16em] text-faint uppercase";

// Qué servicios ofrece el desarrollador: con eso aparece en el directorio
// público y le llegan alertas de los proyectos nuevos de la bolsa de esos
// tipos (con un presupuesto mínimo opcional).
export default function ServiciosForm({
  espacio,
}: {
  espacio: {
    id: string;
    servicios: ServicioTipo[];
    alerta_presupuesto_min: number | null;
    alertas_correo: boolean;
  };
}) {
  const router = useRouter();
  const [servicios, setServicios] = useState<ServicioTipo[]>(espacio.servicios);
  const [minimo, setMinimo] = useState(
    espacio.alerta_presupuesto_min != null ? String(Number(espacio.alerta_presupuesto_min)) : "",
  );
  const [correo, setCorreo] = useState(espacio.alertas_correo);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alternar = (s: ServicioTipo) =>
    setServicios((actual) => (actual.includes(s) ? actual.filter((x) => x !== s) : [...actual, s]));

  return (
    <section className="border-rule mt-12 border-t pt-10">
      <h2 className="text-ink mb-2 font-serif text-[26px] leading-tight">Servicios y alertas</h2>
      <p className="text-muted mb-8 text-[14px] leading-relaxed">
        Con los servicios que marques aparecés en el directorio de desarrolladores y te avisamos
        cuando se publica un proyecto de esos tipos en la bolsa.
      </p>

      <form
        className="flex flex-col gap-8"
        onSubmit={async (e) => {
          e.preventDefault();

          const supabase = createClient();

          if (!supabase || guardando) return;

          setGuardando(true);
          setGuardado(false);
          setError(null);

          const {data, error: err} = await supabase
            .from("espacios")
            .update({
              servicios,
              alerta_presupuesto_min: minimo ? Number(minimo) : null,
              alertas_correo: correo,
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
        <fieldset>
          <legend className={labelClass}>Servicios que ofrecés</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(Object.keys(SERVICIO_LEGIBLE) as ServicioTipo[]).map((s) => {
              const activo = servicios.includes(s);

              return (
                <label
                  key={s}
                  className={`has-[:focus-visible]:outline-ochre flex cursor-pointer items-center gap-2 border px-3 py-2.5 text-[13.5px] transition duration-200 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 ${
                    activo
                      ? "border-ochre bg-ochre/5 text-ink"
                      : "border-rule text-ink-soft hover:border-mist"
                  }`}
                >
                  <input
                    checked={activo}
                    className="accent-ochre size-4 shrink-0"
                    type="checkbox"
                    onChange={() => alternar(s)}
                  />
                  {SERVICIO_LEGIBLE[s]}
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="grid gap-6 sm:grid-cols-2">
          <label>
            <span className={labelClass}>Alertas de proyectos</span>
            <select
              className="border-rule bg-card text-ink focus:border-ochre min-h-10 w-full border px-3 text-[14px] outline-none"
              value={minimo}
              onChange={(e) => setMinimo(e.target.value)}
            >
              {MINIMOS.map((m) => (
                <option key={m.valor} value={m.valor}>
                  {m.etiqueta}
                </option>
              ))}
            </select>
          </label>
          <label className="text-ink-soft flex cursor-pointer items-center gap-2 self-end pb-2 text-[14px]">
            <input
              checked={correo}
              className="accent-ochre size-4"
              type="checkbox"
              onChange={(e) => setCorreo(e.target.checked)}
            />
            Avisarme también por correo
          </label>
        </div>

        {servicios.length === 0 && (
          <p className="text-mist text-[12.5px]">
            Sin servicios marcados no aparecés en el directorio ni recibís alertas.
          </p>
        )}
        {error && (
          <p className="text-brick text-[13px]" role="alert">
            {error}
          </p>
        )}
        {guardado && (
          <p className="text-moss text-[13px]" role="status">
            Guardamos tus servicios y alertas.
          </p>
        )}

        <button
          className="ease bg-ink text-paper hover:bg-ochre w-full py-4 text-[11px] font-medium tracking-[0.2em] uppercase transition duration-200 disabled:opacity-40"
          disabled={guardando}
          type="submit"
        >
          {guardando ? "Guardando…" : "Guardar servicios y alertas"}
        </button>
      </form>
    </section>
  );
}
