# Seguridad y verificación

Qué protege el sistema, cómo está implementado y con qué prueba se comprueba.
La idea de fondo: **toda garantía de seguridad tiene que poder ejecutarse**, no
sólo estar descrita.

> **Alcance:** describe el esquema y los workflows versionados en este
> repositorio. Que una instancia concreta los tenga aplicados es un paso de
> quien despliega.

## 1. Qué cubre cada prueba

| Riesgo | Prueba | Qué hace |
|---|---|---|
| Un rol lee o escribe lo que no debe | `npm run test:rls` | Aplica `db/schema.sql` en un PostgreSQL desechable y ejecuta las políticas rol por rol |
| Una consulta de un nodo no compila contra el esquema | `npm run test:sql` | `PREPARE` de cada consulta de los workflows |
| Un lead o una factura se duplica | `npm run test:idempotencia` | Ejecuta de verdad la deduplicación y la reconciliación de facturas |
| Inyección de HTML desde el formulario público | `npm run test:escape` | Corre los nodos que arman correos, factura y avisos con un nombre hostil |
| Un evento de pago falsificado | `npm run test:firmas` | Firmas de Stripe válidas, falsas, truncadas y ausentes |
| Parámetros SQL concatenados o mal pasados | `npm run test:parametros` | Revisa la forma en que cada nodo Postgres pasa sus valores |
| El ciclo completo deja de funcionar | `npm run test:escenarios` | Dispara los webhooks reales y verifica el estado en la base (necesita el sistema levantado) |
| Un webhook queda expuesto sin control | `npm run test:exposicion` | Invoca los webhooks desde un cliente que no es un navegador (necesita el sistema levantado) |

## 2. Comandos

```bash
npm test                # suite offline: nodos Code, scoring, parámetros SQL, escape de HTML, firmas
npm run test:docker     # SQL + RLS + idempotencia, sobre un PostgreSQL desechable
npm run test:escenarios # ciclo completo contra el sistema levantado
```

## 3. Verificación de la RLS

`npm run test:rls` levanta `postgres:16-alpine`, monta el andamiaje mínimo de
Supabase (los roles `anon` / `authenticated` / `service_role`, el esquema `auth`
y la función `auth.uid()`), aplica **`db/schema.sql` tal cual está en el
repositorio** —dos veces, para comprobar que es idempotente— y después intenta,
rol por rol, todo lo que el modelo de seguridad promete impedir. Los casos están
en `tests/rls/casos.sql`.

Requiere PostgreSQL 15 o superior: las vistas se declaran
`WITH (security_invoker = true)`. Con `--imagen postgres:14-alpine` la corrida
falla a propósito, antes de crear política alguna.

Lo que cubren los casos:

- **El público (`anon`) no accede a nada**: ni tablas ni vistas. Lo que una
  página pública necesita pasa por funciones `SECURITY DEFINER` acotadas.
- **Cada desarrollador ve y opera sólo su espacio.** Ser `admin` de la
  plataforma no concede acceso a espacios ajenos.
- **Las vistas respetan RLS** mediante `security_invoker`.
- **La auditoría está cerrada**: ni siquiera el admin puede leer `logs`.
- **Los leads no se escriben desde el navegador**; `authenticated` sólo tiene
  operaciones acotadas sobre tickets y el espacio propio.
- **No hay escalada de privilegios**: un usuario no puede darse el rol `admin`
  ni cambiar su tipo de cuenta.
- **`profiles` es privada**: cada uno ve sólo su fila.
- **`service_role` evita la RLS**: se reserva para administración y no la usa
  ni la aplicación ni n8n.
- **`n8n_writer`**, el rol de la integración, tiene permisos por tabla y
  columna, sin `BYPASSRLS` ni `DELETE`. Su alcance exacto está en los `GRANT`
  y políticas de `db/schema.sql`.

---

## 4. Decisiones de seguridad

### 4.1 Vigencia del enlace de aceptación

El token UUID no vencía nunca. Ahora `leads.token_expira_en` se estampa al
enviar (o reenviar) la propuesta, con `TOKEN_VIGENCIA_DIAS` días de validez, y
**todas** las consultas que aceptan el token la revalidan:

```sql
... AND (token_expira_en IS NULL OR token_expira_en > now())
```

`IS NULL` deja pasar los leads anteriores a la columna: los enlaces ya emitidos
siguen funcionando. La condición está en las cuatro consultas que aceptan token
(ver propuesta, aceptar, rechazar, pedir cambios), no sólo en la de aceptación.

### 4.1.1 Rotación del token en cada reenvío

La primera idea fue guardar un resumen criptográfico de `accept_token` en vez
del valor en claro. No es viable tal cual: los
recordatorios de seguimiento (`Code - Preparar Follow-up`) releen el token en
claro de la base, días después del envío inicial, para reconstruir el mismo
enlace — un hash irreversible lo impediría.

Se optó por rotación en su lugar: `accept_token` cambia en cada punto donde se
reenvía la propuesta a un correo que ya la había recibido antes —
`/cambio-aceptar`, `/cambio-rechazar` y el cron de seguimiento—, pero no en el
envío inicial, porque ahí no hay ningún token previo que invalidar. Consecuencia
observable: un cliente que abre un correo de propuesta viejo después de que
salió un reenvío ve `status = ya_procesado` en vez de la propuesta, aunque el
enlace nunca se haya usado. La sección siguiente diferencia ese caso.

Verificado en vivo contra el sistema levantado: el
token rota en las tres ramas, el enlace anterior deja de aceptar y el nuevo sí.
Queda declarado, sin resolver, un caso límite: si el cron procesa varios leads
en una corrida y el envío de Gmail falla para uno de ellos, su token ya rotó
en la base aunque el correo con el token nuevo nunca haya salido.

### 4.1.2 Los cuatro desenlaces de un enlace no vigente, diferenciados

Antes, `POST /lead-acepta` (y el `GET
/lead-propuesta` que carga la pantalla antes de que el cliente llegue a tocar
«Aceptar») devolvían el mismo cartel genérico «este enlace ya fue usado» para
cuatro situaciones distintas:

1. El token ya se usó de verdad (aceptación legítima anterior con este mismo
   token).
2. El lead expiró: pasó a `PERDIDO` por agotar los tres seguimientos.
3. El token rotó porque la propuesta se reenvió (4.1.1) — el enlace que se
   clickeó ya no es el vigente, aunque nunca se haya usado.
4. El `lead_id`/token no corresponde a ningún lead.

La consulta que traía el lead filtraba por `lead_id`, `accept_token` y
vigencia a la vez (`... AND accept_token = $2::uuid AND (token_expira_en IS
NULL OR token_expira_en > now())`), así que un token que no matcheaba —por la
razón que fuera— simplemente no devolvía fila, y las cuatro situaciones eran
indistinguibles para el nodo siguiente.

Se separaron las dos responsabilidades: la consulta ahora trae el lead sólo
por `lead_id` (`Postgres - Buscar Lead (token)` en `/lead-acepta`, `Postgres -
Buscar Propuesta` en `/lead-propuesta`), y un nodo Code nuevo (`Code -
Clasificar Aceptacion` — en `/lead-propuesta` la misma lógica vive dentro de
`Code - Armar Respuesta`, que ya era Code) compara en JavaScript el token
recibido contra `accept_token` y revisa `estado` y `token_expira_en` para
decidir una `categoria`: `invalido` (no se encontró el lead), `expirado`
(`estado = 'PERDIDO'`, o el mismo token venció por tiempo antes de que el cron
llegara a marcarlo `PERDIDO`), `rotado` (el token no coincide con el vigente y
el lead ya pasó de `NUEVO`), `ya_procesado` (el token coincide y el lead ya
está `ACEPTADO`/`FACTURADO`) o `valido` (el token coincide y el lead sigue en
`PROPUESTA_ENVIADA`/`EN_SEGUIMIENTO`). Tres nodos IF encadenados bifurcan por
esa `categoria` hacia tres respuestas nuevas —`Respond - Enlace Invalido`,
`Respond - Oportunidad Vencida`, `Respond - Enlace Desactualizado`— antes de
llegar al `IF - Lead Valido?` original, que ahora sólo tiene que distinguir
`valido` de `ya_procesado`.

**Contrato de respuesta, retrocompatible.** El campo `status` sigue mandando
únicamente `ok` / `ya_procesado` / `invalido`, exactamente los tres valores
que ya existían: un cliente HTTP viejo que sólo mira `status` se comporta
igual que antes. Se agregó un campo aditivo, `motivo`
(`token_usado`/`expirado`/`rotado`/`invalido`), que el frontend usa para
elegir el título y el ícono específicos cuando está presente, y cae al
comportamiento anterior si no lo está. `mensaje` ya viajaba en la respuesta
desde antes y ahora trae el texto específico de cada categoría en vez del
genérico «este enlace ya fue usado».

`web/src/app/aceptar/[leadId]/aceptar-propuesta.tsx` agrega los
estados de UI `expirado` y `rotado` (antes cualquier `status` no reconocido
caía a `invalido`) y una función `resolverEstadoFalla` que lee `motivo` antes
que `status`.

No cambia la garantía de atomicidad: la transición a `ACEPTADO`
sigue siendo el mismo `UPDATE ... WHERE estado IN ('PROPUESTA_ENVIADA',
'EN_SEGUIMIENTO')` de siempre; lo que cambia es sólo el diagnóstico que se
arma ANTES de intentarlo.

### 4.2 Credencial en los webhooks del panel

Los webhooks que dispara el panel interno (`trabajo-estado`, `lead-cancelar`,
`cambio-aceptar`, `cambio-rechazar`) mutan el estado del negocio y **se llamaban
desde el navegador sin ninguna credencial**: cualquiera que conociera la URL
pública de n8n podía cancelar un pedido.

Ahora usan **Header Auth** de n8n y el navegador ya no los llama directo: pasan
por `/api/crm/[accion]`, un route handler de Next.js que revalida sesión + rol
`admin` y agrega el header del lado del servidor.

**Por qué no se hizo lo mismo con el resto.** El formulario público
(`lead-nuevo`) y los enlaces del cliente (`lead-acepta`, `lead-rechaza`,
`lead-modifica`, `lead-propuesta`) no pueden llevar un secreto: los ejecuta el
navegador de un tercero y quedaría expuesto en el código. Esos siguen
protegidos por el token UUID —ahora con vencimiento— que es el mecanismo
adecuado para ese caso. Poner ahí un secreto compartido sería seguridad
aparente.

### 4.2.1 Token por factura en el pago de modo desarrollo

`GET /webhook/pago-confirmado` es un caso distinto de los cuatro anteriores: no
tiene un cliente legítimo que necesite acceder sin ninguna credencial —el
enlace lo recibe un único destinatario, el cliente deudor, en el PDF de su
propia factura—, así que el razonamiento de "no puede llevar secreto" no
aplica acá. Hasta el 31 de agosto de 2026 exigía sólo `factura_id`
(`FAC-<año>-<4 dígitos>`, 10.000 combinaciones adivinables por año) y ninguna
otra credencial. Se agregó `pago_token`: una columna UUID nueva en `facturas`
(mismo mecanismo que `accept_token`), generada al emitir la factura,
incluida en `pay_url` y exigida por `Code - Validar Pago` antes de continuar,
con la verificación repetida en el `WHERE` de `Postgres - Marcar Cobrado`. La
mejora es parcial: vale para `pago-confirmado`, y no para
los cinco webhooks del párrafo anterior, que siguen sin cambios por la misma
razón ya expuesta.

### 4.3 Rol acotado para la conexión de n8n

Hasta el 31 de agosto de 2026, toda la escritura del flujo se hacía con la
`service_role` key: en un proyecto de Supabase real ese rol evade la RLS por
completo (`BYPASSRLS`) y alcanza más que las cinco tablas de este esquema. Si
esa credencial se filtraba, el
radio de daño era el de un superusuario de facto.

`n8n_writer` es el rol previsto para la credencial Postgres del nodo homónimo
de n8n (`db/schema.sql`, sección 5.1):

- Sin `BYPASSRLS`. Sujeto a políticas de fila propias
  (`leads_rw_n8n_writer`, `facturas_rw_n8n_writer`, `seguimientos_rw_n8n_writer`,
  `logs_rw_n8n_writer`), sin las cuales no podría hacer nada aunque tuviera el
  `GRANT` — la RLS deniega por omisión.
- En el corte original, `GRANT SELECT, INSERT, UPDATE` sobre cuatro tablas
  (`leads`, `facturas`, `seguimientos`, `logs`). El esquema vigente también
  concede operaciones específicas sobre `espacios`, `rate_limit_log`, `avisos`,
  `tickets`, `bolsa_pedidos`, `mensajes`, `hitos`,
  `checkout_revisiones` y `hitos_movimientos_revision`, entre otros objetos, además
  de funciones y vistas;
  no tiene acceso directo a `profiles` ni al esquema `auth`. No se debe inferir
  un radio de daño de sólo cuatro tablas.
- Sin `DELETE`: ningún nodo del flujo borra una fila.

La mitigación más simple —políticas de escritura acotadas por rol, sin tocar
la credencial— no tenía
efecto real: `service_role` con `BYPASSRLS` ignora cualquier política que se
le agregue. Lo que sí cierra el problema es reemplazar el rol de la conexión, y
eso exigía antes cobertura de pruebas que no existía: `tests/idempotencia.mjs`
corría como superusuario (con la RLS inerte) y sólo un caso de
`tests/rls/casos.sql` ejercitaba una escritura bajo `service_role`. Se agregó:

- **Nueve casos nuevos en `tests/rls/casos.sql`** bajo `n8n_writer`: inserta,
  actualiza y lee `leads` y `logs`; lee `facturas_pendientes`; y confirma que
  no puede borrar, ni leer `profiles`, ni leer `auth.users`.
- **`tests/idempotencia.mjs` ejecuta con `SET ROLE n8n_writer`** las cuatro
  consultas reales del flujo que ya cubría (la inserción condicional del lead
  y las tres consultas de reconciliación), en vez de como superusuario.
  Si el rol acotado careciera de un privilegio que alguna de ellas necesita,
  esta verificación se pone en rojo antes de que el cambio llegue a producción.

**Cerrada — 31-ago-2026, verificado contra el proyecto real.** El esquema
versionado define el rol, sus `GRANT` y sus políticas, y ambos verificadores
del harness de Docker (`npm run test:docker`) pasan en verde con la nueva
cobertura. El paso operativo —dar `LOGIN` y contraseña a `n8n_writer` en el
proyecto de Supabase real y reemplazar la credencial Postgres del nodo
homónimo de n8n— también se completó. La verificación quedó registrada dos
veces: primero, con la contraseña todavía desactualizada en n8n, el nodo
`Postgres - Insert Lead` falló con `password authentication failed for user
"n8n_writer"` —el propio error de Postgres ya nombraba a `n8n_writer` como
usuario de la conexión, confirmando que la credencial apuntaba al rol
correcto—; corregida la contraseña, un alta de lead disparada contra el
webhook real (`POST /webhook/lead/nuevo`) se persistió en `leads` sin error.
Ese resultado acredita la instancia y fecha de aquella prueba; no permite
afirmar qué credencial usa una instancia desplegada hoy sin comprobarla allí.

### 4.3.1 Rate limiting de los cinco webhooks públicos

El esquema/workflow versionado usa `rate_limit_cuotas`: un `INSERT ... ON
CONFLICT DO UPDATE` incrementa el contador de `(ip_o_clave, ruta,
ventana_inicio)` atómicamente dentro de una ventana fija. `rate_limit_log`
conserva intentos para auditoría, pero **ya no** determina el cupo. Las cinco
rutas son `lead/nuevo`, `lead-propuesta`, `lead-acepta`, `lead-rechaza` y
`lead-modifica`. Los umbrales son 5 por minuto para `lead/nuevo`, 30 cada
5 minutos para `lead-propuesta` y 10 cada 5 minutos para aceptar, rechazar y
modificar. La ventana fija permite ráfagas al cruzar su límite temporal.

La clave usa el último tramo de `X-Forwarded-For` y **sólo es fiable detrás
de un proxy que controle ese encabezado**. `lead/nuevo` corta el proceso
interno al exceder el cupo pero conserva el acuse inmediato; las otras cuatro
rutas responden 429. No hay captcha validado por el servidor. Estos son
contratos del código actual: no consta aquí una medición contra un despliegue.

La implementación inicial del 01-sep-2026 contaba entradas en
`rate_limit_log` con `SELECT + INSERT` y no era atómica. Las evidencias de
esa fecha describen aquel artefacto, no el contador actual. Para comprobar
el vigente hacen falta esquema aplicado antes del workflow, pruebas de
concurrencia y verificación del proxy/429 en el entorno concreto.

### 4.3.2 Enmascarado del accept_token en la tabla de auditoría

El `accept_token` viaja en la query string (`/aceptar/[leadId]?token=...`) y
podía terminar en claro en `logs` si algún nodo llegaba a persistir el mensaje
de un error que lo mencionara. Auditados los cuatro nodos que insertan en
`logs` (`Postgres - Log Propuesta`, `Postgres - Log Aceptado`, `Postgres - Log
Cierre`, `Postgres - Log Error`): los tres primeros escriben literales
estáticos (`'Propuesta enviada correctamente'`, etc.), ninguno vuelca el
token, una URL completa ni el objeto de query params/headers sin filtrar. El
cuarto, `Postgres - Log Error`, es el único que persiste texto dinámico
(`error.message`, truncado a 300 caracteres) y es el punto de paso de
cualquier error no controlado de los 203 nodos del flujo — incluida una futura
validación que, por descuido, interpolara el token en su mensaje.

Se endureció `Code - Formatear Error` (el nodo que arma la fila antes del
INSERT) para enmascarar ahí, de forma genérica, cualquier UUID que aparezca en
`detalle` o `error_msg` — no sólo `accept_token`, también `pago_token`,
`mp_payment_id` o cualquier otro identificador con esa forma — dejando sólo
los primeros 8 caracteres seguidos de `…`. Revisado también
`web/src/proxy.ts` y el resto del server-side de Next.js (rutas
`api/crm/[accion]` y `auth/*`): ninguno loguea `req.url` ni los query params de
una ruta con `token=`; los `console.error` de la página de aceptación
(`aceptar-propuesta.tsx`) corren en el navegador del cliente, no en logs de
servidor, y sólo registran el propio `Error` de red, no la URL.

### 4.3.3 Inyección de HTML desde el formulario público

`nombre`, `email` y el mensaje de un pedido de cambios los escribe cualquiera,
y ningún nodo los escapaba antes de interpolarlos en tres lugares que
interpretan HTML:

- **Correos de Gmail.** El acuse del lead frío (`Gmail - Acuse Lead Frio`) se
  manda a la dirección que puso quien completó el formulario. Con un `nombre`
  armado a propósito, cualquiera podía hacer que la cuenta del negocio enviara
  HTML arbitrario (enlaces de phishing incluidos) a terceros, a razón de cinco
  por minuto por IP.
- **El PDF de la factura.** Gotenberg renderiza el HTML con Chromium dentro de
  `crm-net`, la misma red que n8n, con JavaScript habilitado y sin restricción
  de URLs. Se verificó con contenedores reales que un `<iframe>` hacia un
  servicio interno terminaba impreso en el PDF que se le envía al cliente
  (SSRF), y que un `<script>` se ejecutaba.
- **Telegram** (`parse_mode: HTML`). Además de la inyección, un `&` o un `<`
  suelto hace que la API rechace el mensaje entero: un cliente legítimo
  llamado «García & Asociados» se quedaba sin aviso.

Cambios:

- Los ocho nodos Code que arman HTML pasan cada valor por `esc()` (`&`, `<`,
  `>`, comillas). Las expresiones `{{ }}` de Telegram, del subflujo de
  notificaciones y del cuerpo de Gmail escapan los campos libres (`nombre`,
  `cliente`, `mensaje`, `error_msg`, `detalle`).
- Gotenberg arranca con `--chromium-disable-javascript=true` y
  `--chromium-allow-list=^file:///tmp/.*` (`docker-compose.yml`): la factura
  no usa scripts ni recursos externos, así que sólo puede cargar el propio
  `index.html`. Con esa configuración, el mismo `<iframe>` y el mismo
  `<script>` dejan de tener efecto y la factura se renderiza igual.
- `Code - Normalizar Lead` rechaza nombres de más de 100 caracteres o con un
  enlace (`://`, `www.`), y el formulario aplica la misma regla. El nombre
  aparece tal cual en el acuse, así que sin ese límite el correo seguía
  sirviendo como spam en texto plano aunque ya no aceptara HTML.

`tests/escape-html.mjs` (dentro de `npm test`) ejecuta cada nodo con un
payload hostil, exige el escape en cada expresión y comprueba las flags de
Gotenberg. Contra el workflow anterior da 36 fallos.

### 4.3.4 Token revalidado en la escritura y secretos en tiempo constante

- **Aceptación.** `Code - Clasificar Aceptacion` valida el token al leer el
  lead, pero `Postgres - Marcar Aceptado` sólo miraba el estado. Si entre la
  lectura y la escritura la propuesta se reenviaba (el token rota, 4.1.1) o
  vencía, se aceptaba igual con el token viejo. El `UPDATE` ahora exige
  `accept_token` y vigencia en la misma sentencia. `tests/idempotencia.mjs`
  lo ejecuta contra PostgreSQL con token ajeno, vencido y vigente.
- **Comparación de secretos.** La firma `x-signature` de MercadoPago y el
  `x-api-key` de tickets se comparaban con `===`, que corta en el primer
  carácter distinto y deja medir cuánto de un secreto se acertó. Ahora la
  firma usa `crypto.timingSafeEqual` y tickets una comparación de largo fijo
  (sus nodos Code no cargan `crypto`). El comentario de tickets que decía que
  sin clave el módulo «queda abierto» estaba al revés: falla cerrado.
  `tests/firmas.mjs` (en `npm test`) ejecuta ambos nodos con firmas y claves
  válidas, falsas, truncadas y ausentes.

### 4.4 Qué sigue abierto

- **Despliegue y proxy no verificados:** el contador del artefacto es atómico,
  pero depende del último tramo de `X-Forwarded-For` escrito por un proxy de
  confianza. Sin él, un cliente puede alterar la clave o varios usuarios
  compartir `ip-desconocida`. No se ha comprobado aquí el 429 del despliegue;
  `lead/nuevo` conserva el acuse inmediato y sólo corta el procesamiento.
- **Abuso del formulario:** el acuse de un lead frío aún puede dirigirse a un
  email no verificado. Falta captcha validado por el servidor y su operación.
- **Tokens en URL:** `accept_token` y `pago_token` pueden quedar en logs de
  intermediarios. El enmascarado de auditoría propia no controla esos logs.
- **Cobros y movimientos externos:** la reserva de Checkout con UUID de intento y los `UPDATE` condicionales
  protegen estados de base, no garantizan ausencia de doble cargo en Stripe.
  No hay renovación automática de sesiones inciertas o expiradas: los
  resultados de creación sin ID se insertan en `checkout_revisiones` y un
  cron incorpora reservas de más de 15 minutos sin ID o ya vencidas. Esto
  requiere que el workflow esté activo; no confirma cobertura en despliegue. `pagos_no_aplicados` y los movimientos sin ID
  (`hitos_movimientos_revision`) exigen conciliación manual; ver [`modulo-pagos.md`](modulo-pagos.md) y
  [`modulo-hitos.md`](modulo-hitos.md). No hay evidencia aquí de pagos reales
  ni del estado de credenciales/despliegue.
- **Entrega de avisos:** el ACK del subworkflow confirma persistencia duradera
  del aviso en el panel, no entrega opcional por Gmail o Telegram. Un envío
  externo seguido de fallo al marcar puede producir duplicados.
- **Datos públicos de contacto:** el esquema versionado rechaza indicios de
  contacto en algunos campos de publicación (`bolsa_publicar` y
  `publicar_proyecto`). Son validaciones acotadas, no una garantía general de
  ausencia de PII ni de cumplimiento normativo.

---

## 5. Robustez

- **La aceptación responde antes de la cadena larga.** Con `executionOrder: v1`
  las ramas corren en el orden del array de conexiones, y la cadena
  factura → Gotenberg → Gmail estaba **antes** del nodo que responde: si algo
  fallaba ahí, el webhook nunca contestaba y el front tiraba
  `Unexpected end of JSON`. Ahora el `Respond` va primero.
- **Los PATCH a Notion no tumban la ejecución** (`onError: continuar`). Cubre más
  casos que un `IF` por `card_id` vacío: página borrada, token revocado, rate
  limit o lead anterior a la integración.
- **`card_id` a prueba de fallos**: si la creación de la card falla, el `UPDATE`
  usa `COALESCE(NULLIF($1, ''), card_id)` y deja el valor como estaba en vez de
  escribir basura.
- **Los valores llegan enteros a la consulta** (27-ago-2026). El nodo Postgres de
  n8n acepta los parámetros como texto (`"a,b"`) o como arreglo, y no son
  equivalentes: la forma de texto se resuelve con `stringToArray`, que hace
  `.split(',').filter(entry => entry)`. Descarta los valores vacíos —los que
  siguen se corren un lugar y la consulta muere con «there is no parameter $N»— y
  parte los que traen comas internas. Eso volvía inútil la tolerancia del punto
  anterior: cuando Notion fallaba, `card_id` llegaba como `''`, n8n lo descartaba
  y el `UPDATE` se caía en vez de dejar el valor como estaba. El mismo defecto se
  comprobó en el n8n vivo sobre `GET /webhook/lead-propuesta` sin `token`: el
  visitante recibía una página en blanco en lugar del cartel «Enlace no válido o
  vencido». Los 28 nodos Postgres pasaron a la forma de arreglo, y de paso los dos
  valores que todavía viajaban concatenados dentro del texto del SQL
  (`precio` y `mp_payment_id`) pasaron a ser parámetros.
  `npm run test:parametros` deja el criterio escrito y falla si vuelve.

---

## 6. Índices y restricciones

`db/schema.sql` sumó:

- Índices en `logs` (`creado_en`, `lead_id`, y uno parcial sobre `nivel` para
  `WARN`/`ERROR`): la tabla de auditoría no tenía ninguno y es la que más crece.
- `facturas(estado_pago, fecha_vencimiento)`: resuelve filtro y orden juntos para
  el cron de recordatorios.
- `leads(accept_token, token_expira_en)`: la ruta caliente del flujo de aceptación.
- `chk_facturas_fechas` (`NOT VALID`): exige coherencia de fechas en las filas
  nuevas sin invalidar las existentes, para que el script siga siendo ejecutable
  sobre una base con datos.

> **Honestidad de alcance:** a la escala del MVP estos índices no cambian los
> tiempos de forma observable. Se agregan porque las consultas que los usan ya
> están escritas y son las que crecerían en un uso real. No se presentan como
> una mejora de rendimiento medida.

---

