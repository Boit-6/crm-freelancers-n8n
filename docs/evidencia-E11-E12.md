# Evidencia de los escenarios E11 y E12

> Extraído del registro de trabajo de la sesión del 23 de agosto de 2026
> (`docs/dictamen-v6-reejecucion.md`, apartados «Actualización — tercera pasada» y
> «Actualización — cuarta pasada»), reorganizado por escenario para que quede citable desde
> el Anexo A con el mismo criterio que `docs/evidencia-validacion.md` y
> `docs/evidencia-E15-E16.md` usan para el resto de la suite. No se reejecutó nada para
> producir este documento: reproduce hechos ya registrados el día en que ocurrieron.

## E11 — Proceso programado de seguimiento

**Ejecución:** 23 de agosto de 2026, disparando manualmente el `scheduleTrigger` de la rama
«Follow-up 9AM L-V» desde el selector *Execute workflow → from* del editor de n8n (no hay
forma de esperar a la hora real del cron dentro de una sesión de trabajo; el efecto de
dispararlo así es idéntico al de que corra solo).

**Resultado observado:**
- El correo de seguimiento se envió.
- Se insertó una fila nueva en `seguimientos`.
- `leads.seguimientos` se incrementó.
- `fecha_ultimo_seguimiento` se actualizó.
- Los cuatro puntos anteriores se confirmaron leyendo directamente la base, no solo por
  ausencia de error del webhook.

**Defecto real encontrado y corregido en el momento:** el nodo `IF - Es Ultimo Seguimiento?`
fallaba con `Multiple matches found` — una expresión `.item` que deja de ser inequívoca para
n8n cuando, más arriba en la cadena, un `UPDATE` de Postgres colapsa varios ítems en uno
solo. Se corrigió (`.item` → `.all()[$itemIndex]`), se publicó el cambio en el editor y se
volvió a disparar el cron para confirmar en vivo que ya no fallaba. El mismo cambio se
replicó en `workflow/crm_postgres.json` para que el repositorio no quedara desincronizado
del n8n real.

**Consecuencia del defecto, mientras estuvo abierto:** dejó un lead de prueba con
`seguimientos = 3` en un estado inconsistente —la transición a PERDIDO del tercer
seguimiento no llegó a completarse antes de la corrección—, pendiente de reconciliación
manual. Se declara así en la Tabla 12 en lugar de omitirlo.

**Hallazgos adicionales del mismo patrón, en la misma rama:** auditando el resto del flujo
por el mismo tipo de expresión ambigua aparecieron dos casos más sin disparar todavía,
downstream del mismo nodo `Postgres - Update Lead Seguimiento`: `Telegram - Lead Perdido` y
`Notion - Estado Perdido`. No se habían detectado antes porque ningún lead de prueba había
llegado a su tercer seguimiento sin respuesta. Se corrigieron con el mismo criterio.

## E12 — Proceso programado de recordatorios de pago

**Ejecución:** 23 de agosto de 2026, disparando manualmente el `scheduleTrigger` de
«Recordatorios Pago 10AM».

**Defecto real encontrado y corregido, primera vuelta:** `IF - Pago Urgente?` y
`Telegram - Pago Urgente` fallaban con el mismo `Multiple matches found` que E11 —tres
expresiones distintas dentro del mismo mensaje, todas con el mismo patrón de `.item`
ambiguo—. Corregidas las tres.

**Hallazgo nuevo, segunda vuelta:** al volver a probar `Telegram - Pago Urgente` ya con el
fix anterior, Telegram devolvió `Bad Request: chat_id is empty`. La causa: la variable
`TELEGRAM_CHAT_ID` del `.env` estaba declarada pero vacía. Afecta, por diseño, a los trece
nodos de Telegram del flujo del CRM (uno por rama), no solo a este cron. Se resolvió
obteniendo el `chat_id` real vía `getUpdates` de la API de Telegram, escribiéndolo en
`.env` y recreando el contenedor de n8n con `docker compose up -d n8n` —un `restart` simple
no alcanza porque las variables de entorno de Compose se fijan al crear el contenedor, no
se releen en caliente—.

**Hallazgo nuevo, tercera vuelta:** con el `chat_id` ya correcto apareció un segundo
problema independiente del primero: la credencial «Telegram account» configurada en n8n
tenía un token de bot vencido o revocado (`Unauthorized`). Se actualizó con el token
vigente; n8n confirmó «Connection tested successfully».

**Resultado final, verificado de punta a punta:** la re-ejecución del cron devolvió
`ok: true` con el `message_id` real que Telegram asignó al mensaje —confirmado contra la
API del proveedor, no solo por ausencia de error del nodo—.

**Alcance de lo que esta corrida acredita:** las facturas de prueba disponibles ese día
estaban vencidas hace 42 a 57 días, no a exactamente 3 días del vencimiento, así que el
nivel que la corrida asignó fue URGENTE y no RECORDATORIO. El escalón RECORDATORIO
específico —el que se activa a los 3 días exactos— no llegó a ejercitarse por falta de
datos de prueba en ese rango puntual. Se declara así en la Tabla 12 (cobertura parcial del
RF9) en lugar de presentar el escenario como agotado.

## Nota de alcance

Esta corrida no dejó capturas de pantalla —a diferencia de E15 y E16, que sí las tienen
como salida de consola citable—, porque en el momento en que se ejecutó (23-ago-2026) el
procedimiento de captura de evidencia por script todavía no existía. Lo que este documento
aporta es la reconstrucción fiel, a partir del registro de trabajo contemporáneo a la
corrida, de qué se ejecutó, qué falló, cómo se corrigió y qué se verificó — no una
re-ejecución posterior con datos nuevos.
