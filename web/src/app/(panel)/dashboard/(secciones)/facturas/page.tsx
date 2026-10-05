"use client";

import {KpiCard, formatMoney, formatPct} from "../../dashboard-shared";
import DashboardInvoices from "../../dashboard-invoices";
import EncabezadoPagina from "../../encabezado-pagina";
import {EsqueletoFacturas} from "../../esqueletos";
import {usePanelDatos} from "../../panel-datos";

export default function FacturasPage() {
  const {cargando, facturas, metrics: m, anularFactura} = usePanelDatos();

  return (
    <>
      <EncabezadoPagina bajada="Resumen del mes en curso." titulo="Facturas" />
      {cargando ? (
        <EsqueletoFacturas />
      ) : (
        <>
          <section aria-label="Resumen del mes" className="mb-14">
            <div className="grid grid-cols-2 gap-x-8 gap-y-8 lg:grid-cols-4">
              <KpiCard label="Facturado" value={formatMoney(m?.facturacion)} />
              <KpiCard
                label="Cobrado"
                nota={
                  m && m.cobrado_cierre_manual > 0
                    ? `${formatMoney(m.cobrado_cierre_manual)} por cierre, sin pago registrado`
                    : undefined
                }
                value={formatMoney(m?.cobrado)}
              />
              <KpiCard label="Tasa de cobro" value={formatPct(m?.tasa_cobro_pct)} />
              <KpiCard
                alert={!!m && m.facturas_vencidas > 0}
                label="Vencidas"
                value={m ? String(m.facturas_vencidas) : "—"}
              />
            </div>
          </section>
          <DashboardInvoices facturas={facturas} onAnular={anularFactura} />
        </>
      )}
    </>
  );
}
