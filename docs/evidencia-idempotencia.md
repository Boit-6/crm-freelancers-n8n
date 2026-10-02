# evidencia idempotencia

| campo | valor |
| --- | --- |
| comando | `node tests/idempotencia.mjs` |
| marca temporal (UTC) | 2026-09-30T18:04:33.469Z |
| commit | 625d05db22a5aa3fe63a17d540eed461c5586fc9 |
| commit (corto) | 625d05d |
| arbol de trabajo | CON CAMBIOS SIN CONFIRMAR |
| codigo de salida | 0 |
| duracion | 12.4 s |

## salida

```
· Levantando postgres:16-alpine …
· Aplicando el esquema …

── S6 · Deduplicación por correo en la captación ──

OK    el primer envío del formulario crea el lead
OK    el segundo envío con el mismo correo NO crea un lead nuevo (doble clic)
OK    y tampoco creó una segunda fila en la base
OK    el correo se compara sin distinguir mayúsculas
OK    otro interesado, con otro correo, sí entra
OK    el mismo correo, en el formulario de OTRO espacio, sí entra
OK    y queda en ese espacio, no en el del admin
OK    el doble clic dentro de ese mismo espacio sigue sin duplicar
OK    un formulario con una dirección que no existe no crea nada
OK    la descripción con comas llegó entera (los parámetros no se partieron)
OK    el lead conserva su puntaje y su nivel
OK    guarda el rango de presupuesto y el consentimiento de compartirlo en la bolsa
OK    vencida la ventana, el mismo correo vuelve a generar un lead
OK    dos envíos SIMULTÁNEOS del mismo correo dejan un solo lead

── S5 · Reconciliación de la factura perdida ──

OK    la consulta encuentra el lead ACEPTADO sin factura
OK    no toca la aceptación en vuelo (dentro del período de gracia)
OK    no toca el lead que sí tiene factura
OK    la primera corrida del cron emite la factura que faltaba
OK    la segunda corrida NO emite una segunda factura
OK    tampoco la emite si el identificador cambia: el candado es el lead
OK    la base tiene exactamente una factura para ese lead
OK    la factura reconciliada nace PENDIENTE, como cualquier otra
OK    conserva el precio que fijó el profesional, no el presupuesto declarado
OK    el lead pasa a FACTURADO
OK    y una segunda pasada no vuelve a aplicarlo
OK    reconciliado, el lead ya no aparece como pendiente
OK    la factura recuperada entra al circuito de recordatorios de pago

── Cobro por Stripe: ningún pago confirmado se pierde en silencio ──

OK    un pago por el monto justo cobra la factura PENDIENTE
OK    y queda registrado que la cobró Stripe, con su PaymentIntent
OK    la notificación repetida del mismo pago no vuelve a aplicarse
OK    y no genera alerta (Stripe reintenta: es ruido esperable)
OK    un pago tardío cobra la factura VENCIDA (antes se perdía)
OK    un pago sobre una factura ANULADA no la cobra
OK    pero deja alerta: la plata ya entró
OK    un pago por menos de lo facturado no cobra la factura
OK    y la alerta dice cuánto se pagó y cuánto se facturó
OK    un pago en otra moneda tampoco la cobra
OK    un segundo pago sobre una factura ya cobrada se detecta como pago doble
OK    un pago que apunta a una factura inexistente deja alerta
OK    un evento sin factura (factura_id vacío) no toca nada ni alerta
OK    n8n_writer puede dejar la alerta en logs
OK    y el pago queda en la cola de conciliación
OK    la misma alerta repetida no duplica el log

── metrics_mensuales: una factura ANULADA no es facturación ──

OK    cerrar el proyecto marca la factura como cobrada por cierre, no por un pago
OK    la facturación del mes no suma la anulada (600 + 300 + 100)
OK    lo cobrado es sólo lo COBRADO
OK    lo pendiente suma PENDIENTE y VENCIDA, no la anulada
OK    la tasa de cobro se calcula sobre lo facturado sin anular (60 %)
OK    las vencidas se siguen contando aparte
OK    el tablero puede separar lo cobrado sólo por cierre

── Aceptación: el token se revalida en el mismo UPDATE ──

OK    con un token que no es el vigente no se acepta
OK    con el token vencido no se acepta
OK    con el token vigente se acepta
OK    y una segunda aceptación con el mismo token no vuelve a aplicar

── Tickets: siembra del CRM y envejecimiento ──

OK    sembrar dos veces el mismo ticket del proyecto no lo duplica
OK    las etiquetas llegan como arreglo y la vista trae el cliente
OK    el score crece con los días abierto (BAJA 10 + 2×11 = 32)
OK    un ticket cerrado vale 0
OK    el cron arma un resumen por espacio
OK    el resumen de Ana tiene sólo su ticket, y lo escaló
OK    el cron escala sólo al que superó lo que tolera su prioridad
OK    sube un escalón y el reloj se reinicia
OK    el cerrado y el reciente no se tocan
OK    CRITICA es el tope: no escala, pero aparece en el resumen
OK    el resumen cuenta los abiertos
OK    correrlo de nuevo el mismo día no vuelve a escalar
OK    pasar a HECHO lo cierra (cerrado_en)
OK    reabrirlo limpia cerrado_en

Resultado: 68 OK, 0 FALLA
```
