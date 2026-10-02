# Propuestas pendientes y transiciones de facturas (01-sep-2026)

> **Registro histórico:** las rutas y pantallas citadas corresponden a ese
> cambio. El tablero vigente se divide entre `panel-datos.tsx` y componentes
> bajo `FormularioLeads/src/app/(panel)/dashboard/`; no existe ya
> `dashboard-client.tsx`.

Dos deudas declaradas explícitamente en el documento de la tesis, cerradas en esta sesión:

1. **§4.3.1 y §4.9 (riesgo abierto):** un lead HOT/WARM calificado queda en `NUEVO`
   esperando que el profesional le fije precio, plazo y alcance. Hoy sólo hay un aviso
   puntual al calificarlo (`Telegram - Propuesta Por Enviar`) y su visibilidad en el
   tablero («Propuestas por enviar»); si el profesional no actúa, **nadie vuelve a
   insistir**.
2. **§4.8 y Capítulo 8, punto 7 (pendiente declarado):** el enum `pago_estado` prevé
   `VENCIDA` y `ANULADA`, pero hasta ahora ningún nodo del flujo los escribía.

---

## 1. Recordatorio de propuestas pendientes (RAMA 10)

Nuevo proceso programado `🔔 Cron - Propuestas Pendientes`, con el mismo patrón que
`♻️ Cron - Reconciliar Facturas` (buscar filas «atascadas» y actuar de forma
idempotente y de sólo lectura sobre el negocio):

1. **Cadencia:** `0 9-17/2 * * 1-5` — cada 2 horas en horario laboral (9, 11, 13, 15 y
   17 h), de lunes a viernes. Se eligió una cadencia de reinsistencia y no una única
   corrida diaria porque el propio riesgo declarado es que "nadie vuelve a insistir":
   un solo aviso por día reproduciría el mismo problema a otra escala.
2. **`Postgres - Leer Propuestas Pendientes`** selecciona los leads con
   `estado = 'NUEVO'`, `tier IN ('HOT','WARM')`, `precio_propuesto IS NULL` y
   `fecha_ingreso` con más de `PROPUESTA_PENDIENTE_HORAS_UMBRAL` horas (24 por
   defecto, configurable por variable de entorno, mismo criterio que
   `RECONCILIACION_GRACIA_MINUTOS`). Sin `LIMIT`: se procesa cada lead que siga
   esperando, no sólo el más viejo.
3. **`Code - Preparar Aviso Propuestas Pendientes`** calcula cuánto lleva esperando
   cada lead y el total de propuestas pendientes en la corrida.
4. **`Telegram - Propuestas Pendientes`** notifica al profesional, uno por lead,
   indicando cliente, servicio, nivel, hace cuánto espera y cuántas hay en total.

Es **un recordatorio, no una acción automática**: no llama a `POST /propuesta-enviar`
ni toca `estado` ni `precio_propuesto`. No lleva contador de recordatorios (a
diferencia de `seguimientos`, que sí topea en 3): la condición desaparece sola en
cuanto el profesional fija los términos, así que no hay riesgo de reinsistir para
siempre sobre un lead ya resuelto.

---

## 2. Transición a VENCIDA (automática)

Se agregó dentro de `🟠 Cron - Recordatorios Pago 10AM` (corre diariamente y ya
recorre las facturas pendientes) una rama paralela, independiente de la que manda los
recordatorios por email:

- **`Postgres - Marcar Facturas Vencidas`**: `UPDATE facturas SET estado_pago =
  'VENCIDA' WHERE estado_pago = 'PENDIENTE' AND fecha_vencimiento < now() -
  make_interval(days => FACTURA_VENCIDA_DIAS_GRACIA) RETURNING ...` — el mismo
  criterio de UPDATE condicional atómico que ya usan `Postgres - Marcar Cobrado` y la
  reconciliación de facturas: la condición está en el propio `WHERE`, no en un `SELECT`
  previo, así que dos corridas superpuestas no compiten por la misma fila.
- `FACTURA_VENCIDA_DIAS_GRACIA` (7 por defecto): días de atraso, contados desde
  `fecha_vencimiento`, que se toleran antes de la transición. Con el umbral en 7 días,
  la factura sigue recibiendo los recordatorios de `facturas_pendientes` (incluido el
  nivel `URGENTE`, que dispara desde el día 4 de atraso) durante toda su ventana de
  gracia; al pasar a `VENCIDA` sale de esa vista y de esos recordatorios, y pasa a
  contarse en el indicador de la Tabla 8.
- **`Code - Resumen Facturas Vencidas`** + **`Telegram - Facturas Vencidas`**: si el
  `UPDATE` no afectó ninguna fila, el `Code` devuelve `[]` y el Telegram no llega a
  ejecutarse (sin esto, correr el cron un día sin facturas vencidas mandaría un aviso
  vacío).

### Indicador "Facturas vencidas" (Tabla 8) — **rehecho**

Antes: `metrics_mensuales.facturas_vencidas` contaba `estado_pago = 'PENDIENTE' AND
fecha_vencimiento < now()`, es decir lo inferìa de una fecha porque no había otra forma
de saberlo. **Se cambió** a contar `estado_pago = 'VENCIDA'` directamente (ver
`db/schema.sql`, vista `metrics_mensuales`). Es la advertencia que el propio trabajo
hace en §4.8: implementar la transición real obliga a rehacer el indicador, porque de
lo contrario una factura recién vencida (todavía dentro de
`FACTURA_VENCIDA_DIAS_GRACIA`, por lo tanto aún `PENDIENTE`) dejaría de contar donde
antes contaba, sin que nada la reemplazara.

La vista `facturas_pendientes` (la que alimenta los recordatorios y la sección IV del
tablero) **no cambió**: sigue filtrando sólo `PENDIENTE` a propósito. Una factura
`VENCIDA` o `ANULADA` sale de esa lista sin necesidad de tocar el `WHERE`, porque
ambos son valores distintos de `PENDIENTE`.

---

## 3. Transición a ANULADA (manual, webhook nuevo)

`ANULADA` no tiene un criterio automático razonable (anular una factura es una
decisión del profesional, no algo que el paso del tiempo determine), así que se agregó
un webhook del panel:

- **`POST /factura-anular`** (`🧾 Webhook - Anular Factura (panel)`), protegido con el
  mismo mecanismo Header Auth que el resto de los webhooks del panel interno (p. ej.
  `🚫 Webhook - Cancelar (panel)`), vía la credencial `CRM - Header Auth (panel)`.
- Recibe `factura_id` (en el body o en la query) y ejecuta `UPDATE facturas SET
  estado_pago = 'ANULADA' WHERE factura_id = $1 AND estado_pago IN
  ('PENDIENTE','VENCIDA') RETURNING *` — condicional: **nunca** anula una factura ya
  `COBRADO`.
- Si aplicó, responde `200 {"status":"ok"}` y avisa por Telegram
  (`Telegram - Factura Anulada`); si no, responde `200 {"status":"invalido", ...}`
  (mismo criterio que los demás webhooks del panel: el HTTP siempre es 200, el
  resultado va en el body).

### Frontend

Se agregó el botón **"Anular"** en la sección de facturas del tablero
(hoy en `FormularioLeads/src/app/(panel)/dashboard/dashboard-invoices.tsx`, con
la acción en `panel-datos.tsx`; antes todo vivía en `dashboard-client.tsx`), que llama a
`POST /api/crm/factura-anular` con `{factura_id}` — mismo patrón `/api/crm/[accion]`
que usan `cancelar`, `cerrar`, `cambio-aceptar` y `cambio-rechazar`
(`FormularioLeads/src/app/api/crm/[accion]/route.ts`, que sólo necesitó sumar
`"factura-anular": "factura-anular"` a la lista blanca de acciones).

---

## 4. Configuración

| Variable | Default | Qué hace |
|---|---|---|
| `PROPUESTA_PENDIENTE_HORAS_UMBRAL` | `24` | Horas desde `fecha_ingreso` sin `precio_propuesto` antes de que el cron de recordatorio empiece a insistir. |
| `FACTURA_VENCIDA_DIAS_GRACIA` | `7` | Días de atraso sobre `fecha_vencimiento` que tolera una factura `PENDIENTE` antes de pasar a `VENCIDA`. |

Ver `.env.example` para el detalle línea por línea.

---

## 5. Pruebas

`tests/smoke_code_nodes.mjs` ejecuta los tres nodos `Code` nuevos (`Code - Preparar
Aviso Propuestas Pendientes`, `Code - Resumen Facturas Vencidas`, `Code - Leer Anular
Factura`). `tests/parametros_sql.mjs` verifica que los tres nodos `Postgres` nuevos
pasen sus parámetros en forma de arreglo. `tests/verificar_afirmaciones.mjs` recalcula
los conteos del workflow (nodos, webhooks, crons — ver `docs/afirmaciones-tesis.json`)
y agrega dos afirmaciones cualitativas nuevas, `vencida-solo-desde-pendiente` y
`anulada-desde-pendiente-o-vencida`, que reemplazan a la afirmación anterior
`estados-pago-sin-asignar` (que declaraba, correctamente hasta hoy, que ningún nodo
escribía esas transiciones).

`tests/verificar_sql.mjs` (necesita Docker; no se pudo ejecutar en este entorno)
compilaría además las tres consultas nuevas contra el esquema real. Queda pendiente
correrlo donde haya Docker disponible antes de dar por cerrada la validación de SQL.
