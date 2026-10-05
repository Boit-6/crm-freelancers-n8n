import type {LeadEstado} from "./dashboard-types";

import {FunnelBar, SectionHeader} from "./dashboard-shared";
import {FUNNEL_ORDER} from "./dashboard-types";

// Embudo histórico: cuántos leads hay en cada estado, desde siempre.
export default function DashboardEmbudo({funnel}: {funnel: Record<string, number>}) {
  const funnelMax = Math.max(1, ...FUNNEL_ORDER.map((estado) => funnel[estado] ?? 0));

  return (
    <section>
      <SectionHeader num="II" title="Embudo histórico" />
      <div className="flex flex-col gap-4">
        {FUNNEL_ORDER.map((estado: LeadEstado) => (
          <FunnelBar
            key={estado}
            count={funnel[estado] ?? 0}
            label={estado.replace(/_/g, " ")}
            max={funnelMax}
            muted={estado === "PERDIDO"}
          />
        ))}
      </div>
    </section>
  );
}
