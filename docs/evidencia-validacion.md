# Evidencia de validación funcional

> Generado por `node tests/escenarios.mjs`. **No se edita a mano.**
>
> Cada escenario dispara los webhooks reales de n8n y verifica el estado resultante
> en la base. Reemplaza el autorreporte de §5 por una corrida reproducible: cualquiera
> con el entorno levantado obtiene esta misma tabla.

**Ejecución:** 2026-08-31T18:16:30.224Z  ·  **n8n:** `http://localhost:5678`

## Escenarios

| # | Tabla 9 | Escenario | Resultado | Tiempo |
|---|---|---|---|---|
| 1 | E1 | Un lead de presupuesto alto se califica HOT y queda esperando propuesta | OK | 6009 ms |
| 2 | E1b | El profesional fija precio, plazo y alcance, y recién ahí sale la propuesta | OK | 3413 ms |
| 3 | E2 | Un lead de valor medio se califica WARM y también espera propuesta | OK | 4119 ms |
| 4 | E3 | Un lead de presupuesto bajo se califica COLD y NO recibe propuesta | OK | 4553 ms |
| 5 | E4 | Un lead inválido se rechaza sin persistirse y queda registrado | OK | 4997 ms |
| 6 | — | La propuesta se lee sólo con el token correcto | OK | 618 ms |
| 7 | E5/E6 | Aceptación válida y reutilización del enlace: una sola factura | OK | 9257 ms |
| 8 | — | El pago simulado es idempotente | OK | 4540 ms |
| 9 | E8 | El rechazo de la propuesta deja el lead en PERDIDO | OK | 5095 ms |
| 10 | E9 | El pedido de cambios vuelve el lead a EN_SEGUIMIENTO y guarda el mensaje | OK | 4595 ms |
| 11 | E10 | El estado del trabajo se actualiza desde el panel y se sincroniza | OK | 709 ms |
| 12 | — | Un token vencido no permite aceptar la propuesta | OK | 7538 ms |

> La columna «Tabla 9» sólo se completa donde el mapeo con el documento es inequívoco.
> Los `—` hay que cotejarlos contra la Tabla 9 antes de citarlos en la tesis.

## Comprobaciones

### lead-hot — Un lead de presupuesto alto se califica HOT y queda esperando propuesta

- ✅ tier: "HOT"
- ✅ score (40 presupuesto + 30 urgencia + 20 servicio + 5 teléfono + 5 descripción): 100
- ✅ queda esperando los términos del profesional: "NUEVO"
- ✅ todavía no hay precio fijado: null

### propuesta-enviar — El profesional fija precio, plazo y alcance, y recién ahí sale la propuesta

- ✅ el webhook del panel aceptó la credencial (200)
- ✅ precio de la propuesta, fijado por el profesional: 7200
- ✅ plazo comprometido: "3 semanas"
- ✅ el precio no es el presupuesto que declaró el cliente (5000)
- ✅ se generó el token de aceptación
- ✅ el token tiene fecha de vencimiento
- ✅ se registró la fecha de propuesta
- ✅ una segunda petición no reabre la propuesta (status = invalido)

### lead-warm — Un lead de valor medio se califica WARM y también espera propuesta

- ✅ tier: "WARM"
- ✅ score (20 presupuesto + 15 urgencia + 12 servicio + 0 + 0): 47
- ✅ queda esperando los términos, igual que el HOT: "NUEVO"

### lead-cold — Un lead de presupuesto bajo se califica COLD y NO recibe propuesta

- ✅ tier: "COLD"
- ✅ score (10 presupuesto + 5 urgencia + 5 servicio + 0 + 0): 20
- ✅ sigue en NUEVO (no se le envió propuesta): "NUEVO"
- ✅ fallas registradas al procesar el lead COLD: 0

### lead-invalido — Un lead inválido se rechaza sin persistirse y queda registrado

- ✅ correo sin arroba: el webhook respondió 200 sin caerse
- ✅ nombre de un carácter: el webhook respondió 200 sin caerse
- ✅ presupuesto cero: el webhook respondió 200 sin caerse
- ✅ las tres condiciones a la vez (entrada de la Tabla 12): el webhook respondió 200 sin caerse
- ✅ filas nuevas en leads para las 4 entradas inválidas: 0
- ✅ filas nuevas en logs con nivel ERROR: 4 (el RNF3 pide al menos 3)

### propuesta-lectura — La propuesta se lee sólo con el token correcto

- ✅ con el token correcto devuelve la propuesta
- ✅ con un token inválido no filtra datos del lead

### aceptacion-atomica — Aceptación válida y reutilización del enlace: una sola factura

- ✅ ninguna de las dos peticiones concurrentes devolvió error de servidor
- ✅ días entre emisión y vencimiento de la factura: 15
- ✅ la factura guardó el enlace de pago (http://localhost:5678/webhook/pago-confirmado?fa…)
- ✅ monto facturado = precio fijado por el profesional (el cliente había declarado 5000): 7200
- ✅ ninguna de las dos peticiones consecutivas devolvió error de servidor
- ✅ facturas tras cuatro aceptaciones (2 concurrentes + 2 consecutivas): 1
- ✅ el lead quedó en FACTURADO

### pago-idempotente — El pago simulado es idempotente

- ✅ la fecha de cobro no cambió al reusar el enlace: "2026-08-31T18:14:27.939493+00:00"

### rechazo — El rechazo de la propuesta deja el lead en PERDIDO

- ✅ el lead quedó en PERDIDO

### pedido-cambios — El pedido de cambios vuelve el lead a EN_SEGUIMIENTO y guarda el mensaje

- ✅ el mensaje del cliente quedó guardado en notas

### estado-trabajo — El estado del trabajo se actualiza desde el panel y se sincroniza

- ✅ el webhook del panel aceptó la credencial (403 = revisar CRM_PANEL_TOKEN)
- ✅ el lead tiene card_id: la sincronización con Notion está activa

### token-vencido — Un token vencido no permite aceptar la propuesta

- ✅ el lead NO se aceptó (quedó en PROPUESTA_ENVIADA)
- ✅ no se emitió factura con el token vencido: 0

## Métricas del entorno controlado

> Responde la recomendación 5 del dictamen v4. Son tiempos de punta a punta:
> incluyen la latencia de red, el procesamiento de n8n y los servicios externos.

| Escenario | Medición | Tiempo | Detalle |
|---|---|---|---|
| lead-hot | alta del lead en la base | 2063 ms | POST /lead/nuevo → fila en leads (hot) |
| propuesta-enviar | propuesta enviada | 1504 ms | incluye el email de propuesta y la card de Notion |
| lead-warm | alta del lead en la base | 819 ms | POST /lead/nuevo → fila en leads (warm) |
| lead-cold | alta del lead en la base | 813 ms | POST /lead/nuevo → fila en leads (cold) |
| aceptacion-atomica | aceptación → factura emitida | 3045 ms | incluye la generación del PDF con Gotenberg y el envío por email |
| aceptacion-atomica | respuesta al navegador | 3631 ms | las dos peticiones de aceptación en paralelo |
| pago-idempotente | pago confirmado | 241 ms | marca la factura como COBRADO |
| rechazo | alta del lead en la base | 906 ms | POST /lead/nuevo → fila en leads (rechazo) |
| rechazo | rechazo procesado | 260 ms |  |
| pedido-cambios | alta del lead en la base | 900 ms | POST /lead/nuevo → fila en leads (cambios) |
| pedido-cambios | pedido de cambios procesado | 260 ms |  |
| estado-trabajo | cambio de estado de trabajo | 216 ms | incluye la sincronización con Notion |
| token-vencido | alta del lead en la base | 909 ms | POST /lead/nuevo → fila en leads (vencido) |

**Generación de la factura en PDF (Gotenberg), extremo a extremo:** 3045 ms.

