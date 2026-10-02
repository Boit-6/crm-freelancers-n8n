# Cobro con Stripe Connect (RAMA 8)

> **Alcance:** describe el esquema y workflow versionados, no confirma que estén
> aplicados en una instancia remota. Al desplegar esta versión, aplicar primero
> `db/schema.sql` (reservas, `checkout_revisiones` y `pagos_no_aplicados`) y sólo después importar y
> activar el workflow que los usa. No se ejecutaron pagos reales para esta guía.

Desde el 24-sep-2026 la plataforma es compartida: cada desarrollador cobra sus
propias facturas. El cobro pasó de MercadoPago a **Stripe Connect**, en dólares:

- cada desarrollador conecta **su** cuenta de Stripe (Express) desde el panel;
- lo que paga su cliente va a esa cuenta;
- la plataforma se queda con su comisión (`COMISION_PLATAFORMA_PORCENTAJE`, 1%
  por defecto), que Stripe separa sola en el momento del cobro
  (`application_fee_amount`).

Con MercadoPago la comisión era sólo contable (quedaba anotada para liquidar
aparte) y todo cobraba una única cuenta. MercadoPago Argentina, además, cobra
sólo en pesos.

Sin `STRIPE_SECRET_KEY`, el sistema funciona igual que antes en desarrollo: el
enlace de la factura lleva al pago simulado.

---

## 1. Cómo funciona

### Alta de cobros del desarrollador

Desde **Tu espacio → Cobros online**, el panel llama a `/api/crm/stripe-conectar`.
El route handler le pone el espacio de la sesión (lo que mande el navegador se
ignora) y lo reenvía a n8n con la credencial del panel:

1. `🏦 Webhook - Stripe Conectar` busca el espacio. Si todavía no tiene cuenta,
   la crea (`POST /v1/accounts`, `type=express`, con `Idempotency-Key` por
   espacio: dos clics no crean dos cuentas) y la guarda en
   `espacios.stripe_account_id`.
2. Pide un enlace de onboarding (`POST /v1/account_links`) y el panel redirige
   al desarrollador a Stripe.
3. Stripe lo devuelve a `/dashboard/espacio?stripe=volvio`. El panel llama a
   `stripe-estado`, que lee la cuenta (`GET /v1/accounts/{id}`) y guarda
   `stripe_cobros_activos` (= `charges_enabled`).

El desarrollador no puede escribir `stripe_account_id` ni
`stripe_cobros_activos` (GRANT por columna): si pudiera, cobraría en la cuenta
de otro.

### Emisión de la factura

`Code - Generar ID Factura` arma la factura en USD con su comisión, y
`Code - Resolver Link de Pago` le pone un **enlace propio**:
`<N8N_PUBLIC_URL>webhook/pagar?f=<factura_id>&t=<pago_token>`.

Al emitir no se crea nada en Stripe: la sesión se crea al abrir el enlace,
porque vence mucho antes que la factura. El workflow actual pide una sesión de
**35 minutos**. La reserva local no caduca ni se renueva automáticamente:
si su resultado queda incierto o la sesión expira, exige conciliación manual.

### El cliente abre el enlace (`💳 Webhook - Pagar Factura`)

`Code - Decidir Pago` resuelve, con la factura y el espacio de la base:

| Caso | Respuesta |
|---|---|
| factura y token no coinciden | 404 "Enlace inválido" |
| ya COBRADO | "Factura pagada" |
| ANULADA | 410 "Factura anulada" |
| sin `STRIPE_SECRET_KEY` | 303 al pago simulado (modo de desarrollo) |
| el desarrollador no habilitó los cobros | "Pago online no disponible", con la indicación de responder el correo |
| URL guardada y `stripe_checkout_expira_en` a más de un minuto | reutiliza la URL y redirige (303) |
| reserva sin URL, sesión expirada o datos heredados sin vencimiento verificado | no crea otra sesión: queda pendiente de conciliación manual (`checkout_revisiones`) |
| no hay reserva ni sesión previa | reclama un UUID de intento y crea una sesión |

La sesión es un *destination charge*: `transfer_data[destination]` es la cuenta
del desarrollador y `application_fee_amount` la comisión. El importe sale de la
base, nunca del enlace. `Postgres - Buscar Factura a Pagar` hace un `UPDATE`
condicional que reclama la reserva de esa factura antes de llamar a Stripe;
`Postgres - Guardar Checkout` sólo conserva ID, URL y vencimiento si coincide
el UUID de intento reclamado y la sesión aún tiene más de un minuto de vida.
Una respuesta tardía de Stripe no puede sobrescribir otro intento: si no
llega un ID externo o se creó una sesión que no se pudo persistir, el flujo
intenta registrar `checkout_revisiones` con el UUID de intento. Además, el
cron incorpora reservas de más de 15 minutos sin ID o con sesión vencida;
una caída antes de registrar la respuesta no depende de que el cliente vuelva
a abrir el enlace. La fila de revisión es duradera. El cron consulta **todas** las filas sin
resolver ni `aviso_avisado_en`, incluidas las creadas en visitas anteriores,
espera el ACK de persistencia del aviso en el panel y sólo después marca la
fila. Si el aviso falla, reintenta en el siguiente cron; si hubo persistencia
pero falla la marca, puede duplicarse (al menos una vez, no exactamente una).
El ACK no acredita entrega por Gmail/Telegram ni un despliegue actualizado.
Una URL se reutiliza **sólo antes de `stripe_checkout_expira_en`**; al vencer,
no se renueva automáticamente. Las reservas inciertas y los registros
heredados con `stripe_checkout_id` pero sin los campos nuevos requieren
revisión manual antes de habilitar un nuevo intento. La sesión normal puede
expirar sin pago: el cliente necesitará que un operador resuelva el estado;
no hay renovación autónoma.

### Stripe confirma el pago (`💳 Webhook - Stripe`)

Stripe manda `checkout.session.completed` al webhook de la **plataforma** (con
destination charges, la sesión es de la cuenta de la plataforma).
`Code - Verificar Evento Stripe`:

- verifica `Stripe-Signature` (HMAC SHA-256 de `<t>.<cuerpo crudo>` con
  `STRIPE_WEBHOOK_SECRET`, comparación en tiempo constante). El webhook tiene
  `rawBody` porque la firma es sobre el cuerpo tal cual llegó;
- rechaza con 400 si no hay secreto configurado, si la firma no coincide o si
  tiene más de 5 minutos (un evento viejo reenviado no sirve);
- ignora con 200 lo que no es un pago acreditado, para que Stripe no reintente.

`Postgres - Marcar Cobrado Stripe` marca COBRADO sólo desde PENDIENTE o VENCIDA,
y sólo si el monto y la moneda coinciden con la factura (`metodo_cobro =
'STRIPE'`, `stripe_pago_id` = el PaymentIntent). Es idempotente respecto del
**registro en la base**: el reintento de un pago ya registrado no vuelve a
aplicar ese estado. Este `UPDATE` no garantiza que Stripe no haya recibido
otro pago externo; por eso existen la reserva y las colas de revisión. Antes de activar el workflow, verificar también los
`GRANT` efectivos de `n8n_writer` sobre las columnas nuevas del esquema; no
inferirlos de las credenciales exportadas.

### Un pago confirmado que no se pudo aplicar

Si el pago no marcó la factura, `Code - Clasificar Pago No Aplicado` distingue
el reintento esperable (mismo PaymentIntent, ya registrado: no se avisa) de lo
que no puede pasar en silencio: factura ANULADA, inexistente, ya cobrada con
otro pago (pago doble) o un importe distinto. Esos casos se insertan con clave
única por PaymentIntent en `pagos_no_aplicados` (`estado = 'pendiente'`) y
quedan en `logs`; se genera un aviso **crítico**. **No hay reembolso automático**:
un operador debe comprobar el cargo y decidir cómo conciliarlo antes de
registrar el caso como resuelto (ver §4).

### Anulación

La anulación no aplica mientras hay una reserva sin sesión guardada:
el resultado externo aún puede ser incierto. Al anular una factura con una
sesión de Checkout guardada,
`HTTP - Stripe Expirar Checkout` la expira (`POST
/v1/checkout/sessions/{id}/expire`). Así un cliente que había abierto el enlace
antes no puede pagar la factura anulada. Si la sesión ya no estaba abierta,
Stripe responde error y el nodo sigue; no sustituye la conciliación de un
pago que pudiera haberse confirmado durante la carrera.

---

## 2. Configuración

| Variable | Para qué |
|---|---|
| `STRIPE_SECRET_KEY` | Clave de la cuenta de Stripe de la plataforma, con Connect activado. Vacía = pago simulado. |
| `STRIPE_WEBHOOK_SECRET` | Secreto del endpoint `<N8N_PUBLIC_URL>webhook/stripe` (evento `checkout.session.completed`). Obligatorio. |
| `STRIPE_API_BASE` | Vacía = `https://api.stripe.com`. Sólo cambia para usar el doble local. |
| `COMISION_PLATAFORMA_PORCENTAJE` | Comisión de la plataforma (1 por defecto). |
| `NEXT_PUBLIC_COMISION_PORCENTAJE` | La misma, para mostrársela al desarrollador en el panel. |

Pasos en Stripe: activar Connect en la cuenta de la plataforma, crear el
endpoint del webhook y copiar su secreto.

---

## 3. Cómo se verificó

- `tests/firmas.mjs`: el nodo real de verificación con firmas válidas, falsas,
  truncadas, viejas y ausentes, y con eventos que no son un pago.
- `tests/idempotencia.mjs`: la consulta real de cobro (PENDIENTE, VENCIDA,
  ANULADA, monto o moneda distintos, pago doble, reintento) y la
  clasificación de lo que no se aplicó.
- `tests/stripe-doble.mjs`: un doble de la API de Stripe (cuentas, onboarding,
  Checkout, expiración y el evento firmado) con el que se probó el circuito de
  punta a punta contra n8n y la base: alta de la cuenta, factura, pago,
  confirmación, avisos, enlace ya pagado, firma falsa, espacio sin cobros y
  anulación con una sesión abierta.

**Pendiente:** la prueba con una cuenta de Stripe real en modo de prueba. El
doble reproduce el contrato documentado, pero no reemplaza a Stripe.

---

## 4. Conciliación manual (sin ejecutar cargos desde esta guía)

Ante un pago confirmado que no se aplicó, una sesión expirada, una reserva
sin resultado o datos heredados, **no abrir otro Checkout a ciegas**. Con
acceso administrativo autorizado, inspeccionar sólo lectura:

```sql
SELECT tipo, referencia_id, identidad, stripe_checkout_id, motivo, detectado_en
FROM checkout_revisiones WHERE resuelto_en IS NULL ORDER BY detectado_en;

SELECT stripe_pago_id, factura_id, hito_id, motivo, detectado_en
FROM pagos_no_aplicados WHERE estado = 'pendiente' ORDER BY detectado_en;

SELECT factura_id, estado_pago, stripe_checkout_reservado_en,
       stripe_checkout_intento_id, stripe_checkout_id,
       stripe_checkout_expira_en, stripe_checkout_url, stripe_pago_id
FROM facturas
WHERE stripe_checkout_reservado_en IS NOT NULL OR stripe_checkout_id IS NOT NULL;
```

Correlacionar en Stripe la sesión por `stripe_checkout_id` o buscar el UUID de
intento en metadata; comparar PaymentIntent, importe, moneda y estado con la
factura. En registros heredados sin UUID/vencimiento no inferir que la sesión
expiró sólo por su antigüedad local. Si hay pago, conciliarlo **primero**;
si no se puede confirmar el resultado externo, mantener el bloqueo manual.
Sólo después de verificar que la sesión expiró **sin pago** o que nunca se
creó, un operador autorizado puede limpiar los campos de Checkout y marcar
`checkout_revisiones.resuelto_en` **en una misma transacción con bloqueo de
la fila** (`SELECT ... FOR UPDATE`), siguiendo el caso concreto; esta guía no
proporciona un `UPDATE` genérico para evitar una liberación insegura. Nunca
repetir un `POST` a Stripe ni marcar COBRADO por intuición. Resolver
`pagos_no_aplicados` sólo tras registrar el resultado de conciliación o
reembolso manual. Las claves de idempotencia de Stripe
[pueden descartarse después de al menos 24 horas](https://docs.stripe.com/api/idempotent_requests).

## 5. Historia

Hasta el 24-sep-2026 el cobro era con MercadoPago (Checkout Pro): la
preferencia se creaba al emitir la factura, la notificación se verificaba
consultando el pago en la API de MercadoPago y la comisión era sólo contable.
Las columnas `mp_preference_id` y `mp_payment_id` quedan en `facturas` por las
facturas emitidas en esa etapa, que están en ARS.
