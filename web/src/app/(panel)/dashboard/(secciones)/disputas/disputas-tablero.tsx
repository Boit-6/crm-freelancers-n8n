"use client";

import type {OpcionDisputa} from "@/lib/hitos";
import type {Database, DisputaDetalle} from "@/types/supabase";

import {useEffect, useId, useRef, useState} from "react";

import {EsqueletoDisputas} from "../../esqueletos";

import {campoClass, ghostButtonClass, peligroClass, primarioClass} from "@/lib/constants";
import {
  COLOR_HITO,
  ESTADO_HITO,
  EVENTO_DISPUTAS_CAMBIARON,
  EVENTO_HITO,
  NOTA_RESOLUCION_MAX,
  NOTA_RESOLUCION_MIN,
  comisionDe,
  repartoDisputa,
  usd,
} from "@/lib/hitos";
import {SERVICIO_LEGIBLE} from "@/lib/servicios";
import {createClient} from "@/lib/supabase/client";

type DisputaAbierta = Database["public"]["Functions"]["disputas_abiertas"]["Returns"][number];
type DisputaResuelta = Database["public"]["Functions"]["disputas_resueltas"]["Returns"][number];
type Pestana = "abiertas" | "resueltas";

const SIN_SUPABASE =
  "Faltan las variables NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.";

const PESTANAS: Record<Pestana, {etiqueta: string; vacio: string}> = {
  abiertas: {etiqueta: "Abiertas", vacio: "No hay disputas abiertas."},
  resueltas: {
    etiqueta: "Resueltas",
    vacio: "Todavía no se resolvió ninguna disputa.",
  },
};

const OPCIONES: {clave: OpcionDisputa; etiqueta: string}[] = [
  {clave: "liberar", etiqueta: "Liberar todo al desarrollador"},
  {clave: "reembolsar", etiqueta: "Reembolsar todo al cliente"},
  {clave: "partir", etiqueta: "Partir"},
];

const formatearFecha = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const tarjetaClass = "border-rule-soft bg-card border";
const rotuloClass = "text-faint mb-2 text-[10px] tracking-[0.16em] uppercase";

// La plata ya se movió en Stripe: cada parte que recibe algo tiene su
// movimiento registrado.
function yaSeMovioEnStripe(disputa: DisputaResuelta): boolean {
  const transferido = disputa.monto_liberado === 0 || disputa.transferido_en !== null;
  const reembolsado = disputa.monto_reembolsado === 0 || disputa.reembolsado_en !== null;

  return transferido && reembolsado;
}

// Una cita de lo que dijo cada parte.
function Cita({
  quien,
  texto,
  cuando,
  vacio = "Sin nota.",
}: {
  quien: string;
  texto: string | null;
  cuando?: string | null;
  vacio?: string;
}) {
  return (
    <div>
      <p className={rotuloClass}>
        {quien}
        {cuando && ` · ${formatearFecha(cuando)}`}
      </p>
      <p className="text-ink-soft border-rule border-l-2 pl-3 text-[14px] leading-relaxed whitespace-pre-wrap">
        {texto || <span className="text-mist">{vacio}</span>}
      </p>
    </div>
  );
}

// El formulario para decidir: una de las tres opciones, la nota que les
// llega a las dos partes y una confirmación, porque mueve plata.
function FormResolver({detalle, onResuelta}: {detalle: DisputaDetalle; onResuelta: () => void}) {
  const [supabase] = useState(() => createClient());
  const [opcion, setOpcion] = useState<OpcionDisputa | null>(null);
  const [montoDesarrollador, setMontoDesarrollador] = useState("");
  const [nota, setNota] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const botonResolver = useRef<HTMLButtonElement>(null);
  const botonVolver = useRef<HTMLButtonElement>(null);
  const idError = useId();
  const idAyudaNota = useId();
  const idConfirmar = useId();
  const {hito} = detalle;
  const reparto = opcion ? repartoDisputa(opcion, montoDesarrollador, hito.monto) : null;
  const comision = reparto ? comisionDe(reparto.liberar, hito.comision_porcentaje) : 0;
  const montoInvalido = opcion === "partir" && montoDesarrollador.trim() !== "" && !reparto;
  const puedeResolver = reparto !== null && nota.trim().length >= NOTA_RESOLUCION_MIN;
  const rango = `más de US$ 0 y menos de ${usd(hito.monto)}`;

  // Al pedir la confirmación, el foco va a «Volver» (la opción segura); al
  // volver, regresa a «Resolver».
  useEffect(() => {
    if (confirmando) botonVolver.current?.focus();
  }, [confirmando]);

  function volver() {
    setConfirmando(false);
    requestAnimationFrame(() => botonResolver.current?.focus());
  }

  async function resolver() {
    if (!supabase || !reparto) return;
    setEnviando(true);
    setError(null);
    const {error: err} = await supabase.rpc("resolver_disputa", {
      p_hito: hito.id,
      p_liberar: reparto.liberar,
      p_nota: nota.trim(),
    });

    setEnviando(false);
    if (err) {
      setError(err.message);
      volver();

      return;
    }
    onResuelta();
  }

  return (
    <div className="border-rule flex flex-col gap-4 border-t pt-5">
      <h3 className={rotuloClass}>Resolver</h3>
      <fieldset className="flex flex-col gap-1 text-[14px]" disabled={confirmando}>
        <legend className="sr-only">Cómo se reparte el monto</legend>
        {OPCIONES.map((o) => (
          <label
            key={o.clave}
            className="text-ink-soft flex min-h-10 cursor-pointer items-center gap-2.5"
          >
            <input
              checked={opcion === o.clave}
              className="accent-ochre size-4"
              name={`opcion-${hito.id}`}
              type="radio"
              onChange={() => setOpcion(o.clave)}
            />
            {o.etiqueta}
          </label>
        ))}
        {opcion === "partir" && (
          <label className="text-muted flex flex-col gap-1.5 pl-6 text-[13px]">
            Para el desarrollador ({rango})
            <input
              aria-describedby={montoInvalido ? idError : undefined}
              aria-invalid={montoInvalido}
              className={`${campoClass} max-w-40 tabular-nums`}
              inputMode="decimal"
              placeholder="250,00"
              value={montoDesarrollador}
              onChange={(e) => setMontoDesarrollador(e.target.value)}
            />
          </label>
        )}
      </fieldset>

      {reparto && (
        <p className="text-ink-soft text-[13px] leading-relaxed">
          Al desarrollador: <strong className="text-ink">{usd(reparto.liberar)}</strong>
          {reparto.liberar > 0 &&
            ` (le llegan ${usd(reparto.liberar - comision)}, menos ${hito.comision_porcentaje}% de comisión)`}
          . Vuelve al cliente: <strong className="text-ink">{usd(reparto.reembolsar)}</strong>.
        </p>
      )}
      {montoInvalido && (
        <p className="text-brick text-[13px]" id={idError}>
          Tiene que ser {rango}, con hasta dos decimales.
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label className="text-muted flex flex-col gap-1.5 text-[13px]">
          Nota para las dos partes
          <textarea
            aria-describedby={idAyudaNota}
            className={`${campoClass} resize-y`}
            disabled={confirmando}
            maxLength={NOTA_RESOLUCION_MAX}
            placeholder="Por qué se resuelve así"
            rows={3}
            value={nota}
            onChange={(e) => setNota(e.target.value)}
          />
        </label>
        <p className="text-faint text-[12px]" id={idAyudaNota}>
          Les llega a las dos. Mínimo {NOTA_RESOLUCION_MIN} caracteres.
        </p>
      </div>

      {!confirmando ? (
        <div>
          <button
            ref={botonResolver}
            className={primarioClass}
            disabled={!puedeResolver}
            type="button"
            onClick={() => setConfirmando(true)}
          >
            Resolver
          </button>
        </div>
      ) : (
        <div
          aria-labelledby={idConfirmar}
          className="border-brick/40 flex flex-col gap-3 border-l-2 pl-3 text-[14px]"
          role="group"
        >
          <p className="text-ink-soft" id={idConfirmar}>
            ¿Confirmás? Se mueve la plata en Stripe y no se puede deshacer.
          </p>
          <div className="flex gap-4">
            <button className={peligroClass} disabled={enviando} type="button" onClick={resolver}>
              {enviando ? "Resolviendo…" : "Sí, resolver"}
            </button>
            <button
              ref={botonVolver}
              className={ghostButtonClass}
              disabled={enviando}
              type="button"
              onClick={volver}
            >
              Volver
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-brick text-[13px]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// Lo que se abre al revisar una disputa: los otros hitos, la línea de
// tiempo, la conversación y, si sigue abierta y hay cómo avisar, el
// formulario. Al abrirse, toma el foco.
function Detalle({hitoId, onResuelta}: {hitoId: string; onResuelta?: () => void}) {
  const [supabase] = useState(() => createClient());
  const [detalle, setDetalle] = useState<DisputaDetalle | null>(null);
  const [error, setError] = useState<string | null>(supabase ? null : SIN_SUPABASE);
  const contenedor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    contenedor.current?.focus();
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let vigente = true;

    supabase.rpc("disputa_detalle", {p_hito: hitoId}).then(({data, error: err}) => {
      if (!vigente) return;
      if (err) setError(err.message);
      else setDetalle(data);
    });

    return () => {
      vigente = false;
    };
  }, [supabase, hitoId]);

  return (
    <div ref={contenedor} className="flex flex-col gap-6 outline-none" tabIndex={-1}>
      {error ? (
        <p className="text-brick text-[13px]" role="alert">
          {error}
        </p>
      ) : !detalle ? (
        <p className="text-muted text-[13px]">Cargando el detalle…</p>
      ) : (
        <ContenidoDetalle detalle={detalle} onResuelta={onResuelta} />
      )}
    </div>
  );
}

function ContenidoDetalle({
  detalle,
  onResuelta,
}: {
  detalle: DisputaDetalle;
  onResuelta?: () => void;
}) {
  const {proyecto, eventos, mensajes} = detalle;

  return (
    <>
      <section>
        <h3 className={rotuloClass}>
          Hitos del proyecto ·{" "}
          {proyecto.de_plataforma ? "llegó por la plataforma" : "cliente propio"}
        </h3>
        <ol className="border-rule-soft divide-rule-soft divide-y border-y text-[13px]">
          {proyecto.hitos.map((h) => {
            const esteHito = h.orden === detalle.hito.orden;

            return (
              <li
                key={h.orden}
                aria-current={esteHito ? "true" : undefined}
                className={`flex items-baseline gap-3 py-2 ${
                  esteHito ? "border-ochre bg-ochre/5 -ml-2 border-l-2 pl-1.5" : ""
                }`}
              >
                <span className="text-mist w-4 text-right tabular-nums">{h.orden}.</span>
                <span className="text-ink-soft flex-1">
                  {h.titulo}
                  {esteHito && <span className="text-faint"> · el disputado</span>}
                </span>
                <span
                  className={`text-[10.5px] tracking-[0.08em] uppercase ${COLOR_HITO[h.estado]}`}
                >
                  {ESTADO_HITO[h.estado]}
                </span>
                <span className="text-ink tabular-nums">{usd(h.monto)}</span>
              </li>
            );
          })}
        </ol>
      </section>

      <section>
        <h3 className={rotuloClass}>Historial del hito</h3>
        <ol className="flex flex-col gap-2 text-[13px]">
          {eventos.map((ev, i) => (
            <li key={i} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
              <span className="text-faint w-32 shrink-0 tabular-nums">
                {formatearFecha(ev.creado_en)}
              </span>
              <span className="text-ink-soft">
                {EVENTO_HITO[ev.tipo]}
                {ev.detalle && <span className="text-muted"> — «{ev.detalle}»</span>}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h3 className={rotuloClass}>Conversación entre las partes</h3>
        {mensajes.length === 0 ? (
          <p className="text-muted text-[13px]">
            {proyecto.de_plataforma
              ? "No se escribieron mensajes en la plataforma."
              : "Es un cliente propio: no hay conversación en la plataforma."}
          </p>
        ) : (
          <ol className="border-rule-soft flex max-h-80 flex-col gap-3 overflow-y-auto border p-4 text-[13px]">
            {mensajes.map((m, i) => (
              <li key={i} className={m.autor === "cliente" ? "pr-8" : "pl-8 text-right"}>
                <p className="text-faint text-[11px]">
                  {m.autor === "cliente" ? proyecto.cliente_nombre : proyecto.espacio_nombre} ·{" "}
                  {formatearFecha(m.creado_en)}
                </p>
                <p className="text-ink-soft leading-relaxed whitespace-pre-wrap">{m.texto}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      {detalle.hito.estado === "EN_DISPUTA" &&
        onResuelta &&
        (detalle.puede_resolver ? (
          <FormResolver detalle={detalle} onResuelta={onResuelta} />
        ) : (
          <p className="text-brick border-rule border-t pt-5 text-[13px]">
            Es un proyecto tuyo: no podés resolver esta disputa. Como desarrollador, podés
            devolverle la plata al cliente desde el detalle del lead.
          </p>
        ))}
    </>
  );
}

function TarjetaAbierta({disputa, onResuelta}: {disputa: DisputaAbierta; onResuelta: () => void}) {
  const [expandida, setExpandida] = useState(false);

  return (
    <li className={`${tarjetaClass} flex flex-col gap-5 px-5 py-5`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-ink font-serif text-[20px] leading-tight">{disputa.titulo}</h2>
        <span className="text-ink font-serif text-[20px] tabular-nums">{usd(disputa.monto)}</span>
      </div>
      <p className="text-muted -mt-3 text-[12.5px] break-all">
        {disputa.espacio_nombre} ↔ {disputa.cliente_nombre} · {SERVICIO_LEGIBLE[disputa.servicio]} ·{" "}
        {disputa.lead_id}
      </p>

      <div className="grid gap-5 sm:grid-cols-2">
        <Cita
          cuando={disputa.disputa_abierta_en}
          quien={`Motivo de ${disputa.cliente_nombre}`}
          texto={disputa.disputa_motivo}
        />
        <Cita
          quien={`Entrega de ${disputa.espacio_nombre}`}
          texto={disputa.entrega_nota}
          vacio="No lo marcó como entregado."
        />
      </div>

      {expandida ? (
        <Detalle hitoId={disputa.id} onResuelta={onResuelta} />
      ) : (
        <div>
          <button className={primarioClass} type="button" onClick={() => setExpandida(true)}>
            Revisar y resolver
          </button>
        </div>
      )}
    </li>
  );
}

function TarjetaResuelta({disputa}: {disputa: DisputaResuelta}) {
  const [expandida, setExpandida] = useState(false);

  return (
    <li className={`${tarjetaClass} flex flex-col gap-4 px-5 py-4`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-ink font-serif text-[18px] leading-tight">{disputa.titulo}</h2>
        <span className="text-faint text-[12px]">{formatearFecha(disputa.cerrado_en)}</span>
      </div>
      <p className="text-muted -mt-2 text-[12.5px] break-all">
        {disputa.espacio_nombre} ↔ {disputa.cliente_nombre} · {disputa.lead_id}
      </p>
      <p className="text-ink-soft text-[13.5px] leading-relaxed">
        {disputa.cierre === "devuelto"
          ? "La cerró el desarrollador devolviendo la plata."
          : `Resuelta por ${disputa.resuelto_por ?? "la plataforma"}.`}{" "}
        <span className="text-moss">{usd(disputa.monto_liberado)} al desarrollador</span> ·{" "}
        <span className="text-ochre-deep">{usd(disputa.monto_reembolsado)} al cliente</span>
        {" · "}
        <span className="text-faint">
          {yaSeMovioEnStripe(disputa) ? "Ya se movió en Stripe" : "Pendiente de mover en Stripe"}
        </span>
      </p>
      {disputa.resolucion_nota && (
        <Cita quien="Nota de la resolución" texto={disputa.resolucion_nota} />
      )}
      {expandida ? (
        <Detalle hitoId={disputa.id} />
      ) : (
        <div>
          <button className={ghostButtonClass} type="button" onClick={() => setExpandida(true)}>
            Ver historial y conversación
          </button>
        </div>
      )}
    </li>
  );
}

// Las disputas de los hitos, para el admin de la plataforma: las abiertas,
// con todo lo que hace falta para decidir, y las ya resueltas.
export default function DisputasTablero() {
  const [supabase] = useState(() => createClient());
  const [abiertas, setAbiertas] = useState<DisputaAbierta[] | null>(null);
  const [resueltas, setResueltas] = useState<DisputaResuelta[]>([]);
  const [pestana, setPestana] = useState<Pestana>("abiertas");
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(supabase ? null : SIN_SUPABASE);
  const [aviso, setAviso] = useState("");

  useEffect(() => {
    if (!supabase) return;
    let vigente = true;

    Promise.all([supabase.rpc("disputas_abiertas"), supabase.rpc("disputas_resueltas")]).then(
      ([respAbiertas, respResueltas]) => {
        if (!vigente) return;
        setError(respAbiertas.error?.message ?? respResueltas.error?.message ?? null);
        setAbiertas(respAbiertas.data ?? []);
        setResueltas(respResueltas.data ?? []);
      },
    );

    return () => {
      vigente = false;
    };
  }, [supabase, version]);

  function alResolver() {
    setVersion((v) => v + 1);
    setPestana("resueltas");
    setAviso("Disputa resuelta. La plata se mueve en Stripe en unos minutos.");
    window.dispatchEvent(new Event(EVENTO_DISPUTAS_CAMBIARON));
  }

  if (abiertas === null && !error) return <EsqueletoDisputas />;

  const grupos = {abiertas: abiertas ?? [], resueltas};

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div
          className="border-brick bg-brick/5 text-brick border-l-2 px-5 py-3.5 text-[13px]"
          role="alert"
        >
          {error}
        </div>
      )}
      <p aria-live="polite" className="text-moss text-[13px] empty:hidden" role="status">
        {aviso}
      </p>

      <div aria-label="Disputas" className="border-rule flex gap-1 border-b" role="tablist">
        {(Object.keys(PESTANAS) as Pestana[]).map((clave) => {
          const activa = pestana === clave;

          return (
            <button
              key={clave}
              aria-selected={activa}
              className={`-mb-px border-b-2 px-3 py-2.5 text-[11px] tracking-[0.08em] whitespace-nowrap uppercase transition duration-200 ${
                activa ? "border-ochre text-ochre-deep" : "text-muted border-transparent"
              }`}
              role="tab"
              type="button"
              onClick={() => setPestana(clave)}
            >
              {PESTANAS[clave].etiqueta} · {grupos[clave].length}
            </button>
          );
        })}
      </div>

      {error ? null : grupos[pestana].length === 0 ? (
        <p className="text-muted text-[14px]">{PESTANAS[pestana].vacio}</p>
      ) : pestana === "abiertas" ? (
        <ul className="flex flex-col gap-5">
          {grupos.abiertas.map((d) => (
            <TarjetaAbierta key={d.id} disputa={d} onResuelta={alResolver} />
          ))}
        </ul>
      ) : (
        <ul className="flex flex-col gap-4">
          {resueltas.map((d) => (
            <TarjetaResuelta key={d.id} disputa={d} />
          ))}
        </ul>
      )}
    </div>
  );
}
