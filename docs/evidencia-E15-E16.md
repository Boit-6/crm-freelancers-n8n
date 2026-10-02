# Evidencia de los escenarios E15 y E16

> Generado a partir de `node tests/trazabilidad.mjs` y `node tests/exposicion-webhooks.mjs`.
> **No se edita a mano** salvo para agregar corridas nuevas al final.
>
> A diferencia de la suite principal (`tests/escenarios.mjs`, que regenera
> `docs/evidencia-validacion.md` en cada ejecución), estos dos escenarios no escriben su
> salida a un archivo por sí mismos. Este documento la reproduce tal como se imprimió en
> consola, sin editar, para que E15 y E16 queden respaldados con la misma fecha y la misma
> reproducibilidad que el resto de los escenarios del Capítulo 5.

## E15 — Trazabilidad

**Ejecución:** 2026-08-30T21:56:56Z · **Comando:** `npm run test:trazabilidad` · **n8n:** `http://localhost:5678`

```
E15 — Trazabilidad: reconstrucción del ciclo desde lo registrado

Recorrido del ciclo
  · alta enviada (HTTP 200)
  · lead persistido: LD-1788127017302-BOYW (tier HOT, score 100)
  · propuesta enviada desde el panel (HTTP 200)

Reconstrucción a partir de lo registrado (sólo lecturas a la base)
  línea de tiempo reconstruida:
      2026-08-30T21:55:24.469Z  NUEVO              (fecha_ingreso)
      2026-08-30T21:55:28.120Z  PROPUESTA_ENVIADA  (fecha_propuesta)
      2026-08-30T21:55:31.573Z  auditoría INFO      propuesta_enviada

Comprobaciones
  ✅ el ciclo tiene al menos una transición fechada: 2 marcas
  ✅ la reconstrucción arranca en el alta del lead: NUEVO
  ✅ las marcas temporales son cronológicamente consistentes
  ✅ el estado actual se explica por la última transición fechada: estado=PROPUESTA_ENVIADA · última marca=PROPUESTA_ENVIADA
  ✅ la calificación quedó registrada junto al lead: score=100 tier=HOT
  ✅ los términos que fijó el profesional son recuperables y distintos del presupuesto declarado: precio=8400 · presupuesto declarado=6000
  ✅ el envío de la propuesta quedó fechado: 2026-08-30T21:55:28.12044+00:00
  ✅ el envío dejó rastro en el registro de auditoría: 1 fila(s) en logs
  ✅ los seguimientos registrados permiten auditar su espaciado: 0 seguimiento(s)
  ✅ la oportunidad es identificable y ubicable en el ciclo sólo con la base

  (lead de prueba LD-1788127017302-BOYW eliminado)

Resultado: 10/10 comprobaciones en verde
```

## E16 — Exposición de los webhooks

**Ejecución:** 2026-08-30T21:56:39Z · **Comando:** `npm run test:exposicion` · **n8n:** `http://localhost:5678`

```
E16 — Exposición de los webhooks a un cliente que no es un navegador

Instancia: http://localhost:5678
Cliente:   Node v24.18.0, sin cabecera Origin ni Referer

Respuesta a una invocación sin credencial:

  webhook           mét.  HTTP  ¿exige credencial?  declarado en Tabla 10
  ──────────────────────────────────────────────────────────────────────────
  lead/nuevo        POST  200   NO                  sin auth
  lead-propuesta    GET   200   NO                  sin auth
  lead-acepta       POST  200   NO                  sin auth
  lead-rechaza      POST  200   NO                  sin auth
  lead-modifica     POST  200   NO                  sin auth
  pago-confirmado   GET   200   NO                  sin auth
  mp/notificacion   POST  200   NO                  firma opcional
  propuesta-enviar  POST  403   sí (403)            Header Auth
  proyecto-cerrado  POST  403   sí (403)            Header Auth
  trabajo-estado    POST  403   sí (403)            Header Auth
  lead-cancelar     POST  403   sí (403)            Header Auth
  cambio-aceptar    POST  403   sí (403)            Header Auth
  cambio-rechazar   POST  403   sí (403)            Header Auth

Medición
  · 6 de 13 webhooks atendieron a un cliente sin credencial y sin navegador.
  · 6 de 6 webhooks del panel interno respondieron 403.
  · 1 webhook de pasarela: acepta la notificación y la contrasta contra la API del proveedor (S8).

Consecuencia observada sobre el sistema de registro
  ❗ El alta prosperó: se persistió LD-1788127001806-R28Q (tier WARM, fuente «test_exposicion»)
     desde un cliente que no es un navegador y sin credencial alguna. Es la
     demostración de lo que la nota de la Tabla 10 afirma: CORS es un control
     del navegador, no una autenticación de origen.

  (lead de prueba LD-1788127001806-R28Q eliminado)

Resultado: el reparto coincide con la Tabla 11 (S1)
```

## Nota de reproducibilidad

Ambas corridas se ejecutaron contra la misma instancia local de n8n (`docker compose up -d`,
puerto 5678) y la misma Supabase declarada en `.env`, en la sesión del 30 de agosto de 2026,
con quince segundos de diferencia entre una y otra. Los datos de prueba son ficticios
(`test_trazabilidad`, `test_exposicion`) conforme al protocolo de la Tabla 4, y ambos scripts
eliminan el lead que crean al finalizar. Los resultados coinciden exactamente con lo que
declaran la Tabla 11 (S1) y la Tabla 12 (E15, E16) del documento.

## E16 — Reejecución tras el cierre de S8 (firma obligatoria)

**Ejecución:** 2026-08-31T15:20:30Z · **Comando:** `npm run test:exposicion` · **n8n:** `http://localhost:5678`

El 31 de agosto de 2026 se cerró la deuda S8 de la Tabla 11: el nodo `Code - Leer Notificacion MP`
pasó de aceptar por defecto una notificación sin firma (`firmaValida = true` inicial) a
rechazarla por defecto (`firmaValida = false` inicial), con `MP_WEBHOOK_SECRET` obligatorio.
Esta corrida reejecuta E16 contra el sistema real ya con el cambio aplicado y reimportado en
la instancia de n8n (workflow `kRyDrREl40a1if0K`, reactivado y con el contenedor recreado para
tomar el nuevo valor por defecto de `MP_WEBHOOK_SECRET` en `docker-compose.yml`).

```
E16 — Exposición de los webhooks a un cliente que no es un navegador

Instancia: http://localhost:5678
Cliente:   Node v24.18.0, sin cabecera Origin ni Referer

Respuesta a una invocación sin credencial:

  webhook           mét.  HTTP  ¿exige credencial?  declarado en Tabla 10
  ──────────────────────────────────────────────────────────────────────────
  lead/nuevo        POST  200   NO                  sin auth
  lead-propuesta    GET   200   NO                  sin auth
  lead-acepta       POST  200   NO                  sin auth
  lead-rechaza      POST  200   NO                  sin auth
  lead-modifica     POST  200   NO                  sin auth
  pago-confirmado   GET   200   NO                  sin auth
  mp/notificacion   POST  200   NO                  firma obligatoria
  propuesta-enviar  POST  403   sí (403)            Header Auth
  proyecto-cerrado  POST  403   sí (403)            Header Auth
  trabajo-estado    POST  403   sí (403)            Header Auth
  lead-cancelar     POST  403   sí (403)            Header Auth
  cambio-aceptar    POST  403   sí (403)            Header Auth
  cambio-rechazar   POST  403   sí (403)            Header Auth

Medición
  · 6 de 13 webhooks atendieron a un cliente sin credencial y sin navegador.
  · 6 de 6 webhooks del panel interno respondieron 403.
  · mp/notificacion: notificación SIN firma → se ignoró sin persistir cambios (S8 cerrada).

Consecuencia observada sobre el sistema de registro
  ❗ El alta prosperó: se persistió LD-1788189630394-IKL3 (tier WARM, fuente «test_exposicion»)
     desde un cliente que no es un navegador y sin credencial alguna. Es la
     demostración de lo que la nota de la Tabla 10 afirma: CORS es un control
     del navegador, no una autenticación de origen.

  (lead de prueba LD-1788189630394-IKL3 eliminado)

Resultado S1: el reparto coincide con la Tabla 11
Resultado S8: la firma es obligatoria: una notificación sin firmar se ignora
```

**Nota sobre S1.** El reparto de S1 no cambió: 6 de 13 webhooks siguen sin autenticar el origen
y 6 de 6 del panel siguen exigiendo Header Auth. `mp/notificacion` nunca contó para ese reparto
(vive en su propio grupo, `pasarela`, ajeno a los conteos de S1) — el cierre de S8 se mide por
separado, a partir de si la notificación sin firma se aplica o se ignora, porque el webhook de
pasarela responde HTTP 200 en los dos casos por diseño (para que MercadoPago no reintente); la
señal está en el cuerpo de la respuesta, no en el código de estado.

**Nota complementaria — E14 contra el doble, con la firma ya obligatoria.** La misma sesión
reejecutó `node tests/e14-cobro-mp.mjs` (contra `tests/mp-doble.mjs`, con `MP_API_BASE` del
contenedor apuntado temporalmente a `http://host.docker.internal:8799` y repuesto al valor por
defecto al terminar) para confirmar que el camino firmado sigue aplicándose correctamente tras
el cierre de S8: las quince comprobaciones del escenario, incluidas las dos de idempotencia,
terminaron en verde (`estado_pago` PENDIENTE → COBRADO, `mp_payment_id` persistido y sin cambio
ante la notificación repetida). El detalle completo de E14 se reporta en la Tabla 12 (§5.1).

## S1 (pago-confirmado) — verificación en vivo tras el cierre parcial

**Ejecución:** 2026-08-31T17:08:59Z · **n8n:** `http://localhost:5678` · **Supabase:** la
declarada en `.env`

El 31 de agosto de 2026 se cerró la deuda S1 de la Tabla 11 para el webhook `pago-confirmado`
(modo desarrollo): antes exigía sólo `factura_id` (formato `FAC-<año>-<4 dígitos>`, 10.000
combinaciones adivinables por año) y ninguna otra credencial. Se agregó `pago_token`, una
columna nueva en `facturas` (`UUID NOT NULL DEFAULT gen_random_uuid()`, mismo mecanismo que
`accept_token`), generada al emitir la factura, incluida en `pay_url` y exigida por
`Code - Validar Pago` y verificada en el `WHERE` de `Postgres - Marcar Cobrado`. Los otros cinco
webhooks sin autenticación de origen (`lead/nuevo`, `lead-acepta`, `lead-propuesta`,
`lead-rechaza`, `lead-modifica`) quedan sin cambios: `docs/verificacion-y-seguridad.md` §5.2
desarrolla por qué un secreto compartido ahí sería seguridad aparente, y por qué la mitigación
que les corresponde es rate limiting, declarado como trabajo futuro (Capítulo 8).

La corrida siguiente ejercita el ciclo completo contra el sistema real, con un lead y una
factura de prueba que se eliminan al finalizar:

```
Verificación en vivo de S1 (pago-confirmado exige pago_token)

1. Alta y calificación HOT
  ✓ webhook de captación respondió 200
  ✓ lead calificado HOT — score=100

2. El profesional fija los términos (propuesta-enviar)
  ✓ propuesta-enviar respondió 200 — status=200
  ✓ el lead tiene accept_token

3. Aceptación (crea la factura en modo desarrollo, con pago_token)
  ✓ lead-acepta respondió 200
  ✓ la factura tiene pago_token — pago_token=220a6e84-93c3-4a8a-9947-c573eb9a15ee
  ✓ estado_pago inicial PENDIENTE
  ✓ pay_url incluye el pago_token correcto — http://localhost:5678/webhook/pago-confirmado?factura_id=FAC-2026-9956&pago_token=220a6e84-93c3-4a8a-9947-c573eb9a15ee&lead_id=LD-1788196140164-0WXE

4. Intento con pago_token INCORRECTO (no debe marcar como cobrado)
  ✓ la petición con token incorrecto no rompe el webhook (200, respuesta de rechazo)
  ✓ CRÍTICO: con token incorrecto, la factura SIGUE PENDIENTE (no se marcó cobrada) — estado_pago=PENDIENTE

5. Intento con pago_token CORRECTO (debe marcar como cobrado)
  ✓ la petición con token correcto respondió 200
  ✓ con token correcto, la factura pasó a COBRADO

6. Reintento con el token correcto (idempotencia)
  ✓ la petición repetida respondió 200
  ✓ sigue COBRADO (no rompió el estado)

────────────────────────────────────────────────────────────────────────
S1: todas las comprobaciones pasaron.
────────────────────────────────────────────────────────────────────────
(lead y factura de prueba eliminados: LD-1788196140164-0WXE)
```

**Nota sobre un hallazgo colateral, corregido en la misma sesión.** Al verificar S1 se detectó
que el nodo `Postgres - Marcar Cobrado MP` —sin relación con S1, no tocado por este cambio— tenía
en el n8n vivo una versión desactualizada respecto del repositorio: interpolaba `mp_payment_id`
como texto dentro de la propia consulta SQL en vez de pasarlo como parámetro, y su
`queryReplacement` era escalar en lugar de arreglo. El defecto se manifestaba únicamente cuando
`Code - Procesar Pago MP` entregaba un `factura_id` vacío (una notificación de pago con un id
inexistente, que fuerza una consulta real contra la API de MercadoPago sin token configurado):
la consulta fallaba con `there is no parameter $1` y el webhook devolvía un cuerpo vacío en lugar
de `{"ok": false}`. No afectaba ninguna factura real (0 filas, sin escritura) ni la garantía de
S8 (la notificación se rechaza igual, antes de llegar a este nodo). Se sincronizó el nodo del
n8n vivo con la forma ya correcta del repositorio (parámetro `$2` real y `queryReplacement` en
arreglo) y se verificó que `POST /webhook/mp/notificacion` sin firma vuelve a responder
`{"ok": false}` de forma limpia.

## S3 (accept_token) — verificación en vivo de la rotación en cada reenvío

**Ejecución:** 2026-08-31, entre las 17:11 y las 17:20 UTC · **n8n:** `http://localhost:5678` ·
**Supabase:** la declarada en `.env`

El 31 de agosto de 2026 se cerró la deuda S3 de la Tabla 11: `accept_token` pasó de generarse una
única vez y reutilizarse en todo el ciclo de vida de la propuesta, a rotar en cada punto donde se
reenvía la propuesta a un correo que ya la había recibido antes. El mecanismo elegido es rotación,
no un resumen criptográfico del valor —la mitigación que la Tabla 11 proponía originalmente—,
porque el sistema necesita reconstruir el mismo enlace en los recordatorios de seguimiento
(`Code - Preparar Follow-up` relee `accept_token` de la base días después del envío inicial), y un
hash irreversible haría eso imposible. El envío inicial (`propuesta-enviar`) no rota: no hay ningún
token previo que invalidar la primera vez que se envía. Rotan tres puntos: `Postgres - Reabrir
Propuesta` (`/cambio-aceptar`), `Postgres - Reabrir Original` (`/cambio-rechazar`) y
`Postgres - Leer Leads Follow-up` (el cron de seguimiento, que pasó de `SELECT` a
`UPDATE ... RETURNING *` para que el token nuevo ya esté en la fila antes de que se arme el correo).

**Verificación 1 — `cambio-aceptar`.** Ciclo completo contra el sistema real: alta, propuesta,
pedido de cambios del cliente, y el profesional acepta el pedido. El enlace del correo original
(con el token previo a la rotación) deja de aceptar la propuesta; el enlace nuevo sí la acepta.

```
Verificación en vivo de S3 (rotación de accept_token)

1. Alta, calificación HOT y envío de la propuesta (no debe rotar)
  ✓ webhook de captación respondió 200
  ✓ lead calificado HOT
  ✓ propuesta-enviar respondió 200
  ✓ el envío inicial generó accept_token — 843586e4-cd31-4c0d-8d79-2574b34c1b6b

2. Pedido de cambios del cliente (vuelve a EN_SEGUIMIENTO)
  ✓ lead-modifica respondió 200
  ✓ el token NO cambió con el pedido de cambios (correcto: lead-modifica no lo toca)

3. El profesional acepta el pedido de cambios (cambio-aceptar → debe ROTAR el token)
  ✓ cambio-aceptar respondió 200
  ✓ CRÍTICO: el token ROTÓ tras cambio-aceptar — antes=843586e4-cd31-4c0d-8d79-2574b34c1b6b después=948bfafa-0e1b-40f5-b5af-0d1e3ba85d25

4. El enlace VIEJO (correo original) ya no debe funcionar
  ✓ el token del correo original ya no acepta (enlace inválido/vencido) — status=ya_procesado
  ✓ el lead NO quedó aceptado con el token viejo — estado=PROPUESTA_ENVIADA

5. El enlace NUEVO (rotado) sí debe funcionar
  ✓ el token nuevo (rotado) sí acepta la propuesta — status=ok

────────────────────────────────────────────────────────────────────────
S3 (cambio-aceptar): todas las comprobaciones pasaron.
────────────────────────────────────────────────────────────────────────
```

Un dato no anticipado: el token viejo no responde "enlace inválido", sino `status = ya_procesado`
— es semánticamente correcto y coincide con la observación que el propio §4.3.2 ya hace sobre el
mismo desenlace ambiguo ("PERDIDO por agotamiento de seguimientos + clic tardío"): un enlace
rotado y uno usado producen hoy el mismo mensaje, aunque la causa sea distinta.

**Verificación 2 — `cambio-rechazar`** (rama simétrica, `Postgres - Reabrir Original`), mismo
protocolo:

```
El profesional RECHAZA el pedido de cambios (cambio-rechazar → debe ROTAR el token)
  ✓ cambio-rechazar respondió 200
  ✓ CRÍTICO: el token ROTÓ tras cambio-rechazar — antes=ed295271-1e56-46d7-96f6-c094be9e0b4c después=dd5f03a6-77ae-4756-be5e-9ec37c6c731c
  ✓ el token del correo original ya no acepta — status=ya_procesado
  ✓ el token nuevo (rotado) sí acepta — status=ok

────────────────────────────────────────────────────────────────────────
S3 (cambio-rechazar): todas las comprobaciones pasaron.
────────────────────────────────────────────────────────────────────────
```

**Verificación 3 — cron de seguimiento (`Postgres - Leer Leads Follow-up`).** Sin webhook propio
—se dispara desde el editor de n8n, mismo protocolo que ya usan E11 a E13 (Tabla 4)—. Se preparó
un lead con la propuesta enviada y `fecha_propuesta` forzada a cuatro días atrás (elegible según
el criterio del nodo: `3 * (seguimientos + 1)` días desde la última interacción), y se ejecutó
manualmente sólo ese nodo (`Execute step`) desde el editor:

```
accept_token ANTES del cron: ea8e63a6-fb81-432d-8257-af525d86bb41
accept_token DESPUÉS:        12df34ce-9048-4b20-90f7-d5ad04e8e0e7

✓ CRÍTICO: el token ROTÓ tras el cron de seguimiento
```

`seguimientos` no incrementó en esta corrida porque `Execute step` ejecuta únicamente el nodo
señalado, no la cadena completa hasta `Postgres - Update Lead Seguimiento` (que es el que
incrementa el contador). Eso no compromete la verificación: lo que había que confirmar —que el
nuevo `UPDATE` rota el token en runtime real, no sólo en la lectura del código— quedó probado. Que
el correo salga con el token ya rotado y no con el anterior está garantizado por el orden de
conexiones del flujo (`Postgres - Leer Leads Follow-up` → `Code - Preparar Follow-up` →
`Gmail - Enviar Follow-up`), verificado contra `workflow/crm_postgres.json` antes de aplicar el
cambio.

**Caso límite declarado, no resuelto esta ronda.** El cron procesa varios leads elegibles en una
sola corrida. Si el envío de Gmail falla para un lead puntual dentro del lote, su token ya rotó
en la base aunque el correo con el token nuevo nunca haya salido: el enlace anterior (que sí llegó
a destino) queda inválido sin que uno nuevo lo reemplace. No es un caso nuevo introducido por este
cambio —el contador de seguimientos de hoy ya avanza sin garantía de que el envío de Gmail haya
sido exitoso—, y se declara en la Tabla 11 y en §4.3.5 como parte del alcance de la mitigación.
