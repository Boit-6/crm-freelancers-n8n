// Clases CSS compartidas entre los componentes del panel interno (dashboard).
// Antes vivían duplicadas como constantes locales en dashboard-client.tsx.

export const thClass =
  "border-b border-rule py-3 pr-5 text-left text-[10px] font-medium tracking-[0.16em] text-faint uppercase";

export const tdClass = "border-b border-rule-soft py-4 pr-5 text-[14px] text-ink-soft";

export const ghostButtonClass =
  "ease border border-rule px-3.5 py-2 text-[11px] tracking-[0.12em] text-muted uppercase transition duration-200 hover:border-brick hover:text-brick";

// Campos y botones de las acciones sobre hitos (panel del desarrollador y
// disputas del admin).
export const campoClass =
  "ease border-rule bg-card text-ink placeholder-mist focus:border-ochre w-full border px-3 py-2.5 text-[14px] transition duration-200 outline-none";

export const primarioClass =
  "ease bg-ink text-paper hover:bg-ochre px-4 py-2.5 text-[11px] tracking-[0.14em] uppercase transition duration-200 disabled:cursor-not-allowed disabled:opacity-40";

// Confirma algo que no se puede deshacer (mueve o devuelve plata).
export const peligroClass =
  "ease bg-brick text-paper px-4 py-2.5 text-[11px] tracking-[0.14em] uppercase transition duration-200 hover:opacity-90 disabled:opacity-40";
