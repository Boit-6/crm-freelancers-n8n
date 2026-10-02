# Verificación y seguridad del artefacto

Este documento reúne lo que se agregó para responder, con evidencia ejecutable,
las observaciones del `dictamen-tesisv4.md` y las cuestiones de la defensa oral.

> **Alcance temporal:** las cifras y corridas de la defensa son evidencia de su
> fecha, no garantías del despliegue actual. Para los permisos vigentes del
> artefacto versionado, consultar `db/schema.sql` y volver a ejecutar los tests;
> este documento no verifica credenciales ni políticas aplicadas en producción.

La idea de fondo: **todo lo que la tesis afirma sobre el artefacto tiene que
poder re-ejecutarlo otra persona**. Donde antes había una descripción en prosa
más una captura, ahora hay además un comando.

---

## 1. Mapa: qué responde cada cosa

| Observación del dictamen | Gravedad | Qué se agregó |
|---|---|---|
| §D8 — la validación por escenarios «mantiene un componente de autorreporte» | **Media** | `tests/escenarios.mjs`: dispara los webhooks reales y verifica el estado en la base |
| Recomendación 5 — «reportar métricas mínimas del entorno controlado» | Opcional | Tiempos medidos por `tests/escenarios.mjs` + `FormularioLeads/scripts/medir-realtime.mjs` |
| Cuestión 1 — ¿cómo evita la doble factura ante peticiones concurrentes? | — | Escenario `aceptacion-atomica`: dispara **dos aceptaciones en paralelo** y verifica que haya una sola factura |
| Cuestión 2 — ¿la RLS está aplicada o sólo en el script? | — | `tests/verificar_rls.mjs`: 24 casos contra un PostgreSQL real |
| Cuestión 3 — ¿sobre qué base se fijaron los umbrales de scoring? | — | Los umbrales son configurables (`SCORING_*`); `tests/scoring.mjs` prueba 9240 combinaciones |
| Cuestión 4 — ¿qué mitigaciones tiene el token del enlace? | — | Vigencia temporal (`TOKEN_VIGENCIA_DIAS`), revalidada en la base |
| Cuestión 5 — ¿cómo se aseguró la reproducibilidad de E1–E10? | — | La suite escribe `docs/evidencia-validacion.md` en cada corrida |
| Deriva entre documento y código | — | `tests/verificar_afirmaciones.mjs` recalcula los números que afirma la tesis |

La evidencia archivada de E7 está en `docs/evidencia-realtime.md`: es una
corrida histórica, no un resultado del medidor actual ni una garantía de
Realtime en una instancia desplegada hoy.

---

## 2. Comandos

```bash
npm test                # suite offline: nodos Code, scoring, tickets, parámetros SQL, escape de HTML, afirmaciones
npm run test:docker     # SQL, RLS e idempotencia sobre un PostgreSQL desechable (necesita Docker)
npm run test:escenarios # validación funcional de punta a punta (necesita el sistema levantado)
```

Para repetir **E7 / RNF6**, el medidor canónico es
`FormularioLeads/scripts/medir-realtime.mjs`; `scripts/medir-realtime.mjs` de
la raíz sólo reenvía a él. Necesita una cuenta de prueba con sesión y espacio
propio (`REALTIME_TEST_EMAIL` / `REALTIME_TEST_PASSWORD`), URL y anon key de
Supabase y `SUPABASE_SERVICE_ROLE_KEY` para crear y eliminar **su propio lead
ficticio**. La suscripción usa la sesión de esa cuenta, no una anon key sin
sesión. El script informa si falla la limpieza y el ID afectado. No se debe
ejecutar sobre producción sin planificar ese dato de prueba. La tabla `leads`
debe estar publicada para Realtime. Una ejecución directa desde la raíz,
sin sobrescribir la evidencia archivada, sería:

```bash
node FormularioLeads/scripts/medir-realtime.mjs --n 5
```

`npm run test:realtime` sí reemplaza el archivo de evidencia. Ninguna de esas
mediciones se ejecutó al actualizar esta guía.

`npm run --silent manifest:deployment` emite huellas SHA-256 locales de
`db/schema.sql` y `workflow/*.json`; `npm run --silent manifest:verify -- <manifiesto.json>`
compara ese manifiesto con los archivos **locales**. Sirve
para cotejar la fuente transferida antes de importar/aplicar, no para demostrar el
estado de n8n o Supabase remotos. Para el navegador fuera de la máquina local,
el compose exige un proxy HTTPS/túnel hacia `127.0.0.1:5678`: configurar
`N8N_PUBLIC_URL` no publica ese puerto por sí mismo.
Para CORS, `npm run workflow:render -- --out <directorio-nuevo>` requiere
`CORS_ORIGINS` explícito y genera copias JSON importables con literales y un
`render-manifest.json` separado (SHA-256 de fuente y copia). No incluye el
esquema, no importa a n8n y no valida el despliegue. Cambiar la variable
requiere volver a renderizar e importar; no basta reiniciar.

Las dos primeras corren en CI (`.github/workflows/ci.yml`) en cada push, con los
tres pasos de Docker por separado para que el informe diga cuál falló. La
tercera es manual: necesita n8n publicado, la base configurada y las
credenciales, porque **no simula nada**.

---

## 3. Verificación de la RLS

`npm run test:rls` levanta `postgres:16-alpine`, monta el andamiaje mínimo de
Supabase (los roles `anon` / `authenticated` / `service_role`, el esquema `auth`
y la función `auth.uid()`), aplica **`db/schema.sql` tal cual está en el
repositorio** —dos veces, para comprobar que es idempotente— y después intenta,
rol por rol, todo lo que el modelo de seguridad promete impedir. La salida queda
archivada en `docs/evidencia-rls.md`.

La imagen se puede cambiar: `npm run test:rls --imagen postgres:14-alpine`. Es
el contraste que acredita la versión del motor en la Tabla 13 del informe, y su
resultado esperado es **rojo**: `db/schema.sql` declara las vistas
`metrics_mensuales` y `facturas_pendientes` `WITH (security_invoker = true)`,
opción que PostgreSQL incorporó recién en la 15, así que una 14 aborta con
`ERROR: unrecognized parameter "security_invoker"` antes de crear política
alguna. Como ambas vistas existen en el proyecto de Supabase, la instancia real
es 15 o superior. Esa corrida no se versiona, justamente porque falla a
propósito: la evidencia archivada es siempre la de la imagen por defecto.

En el corte de la defensa, los 33 casos resumidos aquí cubrían:

- **El público (`anon`) no accede a nada**: ni tablas ni vistas.
- **Estar logueado no alcanza**: en el modelo original, un usuario sin rol
  `admin` veía 0 filas. El esquema actual usa propiedad del espacio para los
  datos del desarrollador; ser `admin` no concede acceso a espacios ajenos.
- **Las vistas respetan RLS** mediante `security_invoker`.
- **La auditoría está cerrada**: ni siquiera el admin puede leer `logs`.
- **Los leads no se escriben desde el navegador**; el esquema actual sí permite
  operaciones acotadas de `authenticated` sobre tickets y el espacio propio.
- **No hay escalada de privilegios**: un usuario no puede darse el rol `admin`.
- **`profiles` es privada**: cada uno ve sólo su fila.
- **`service_role` evita la RLS**; debe reservarse para administración, no
  asumirse como credencial operativa del flujo a partir del repositorio.
- **`n8n_writer`** se probó entonces con nueve casos sobre las tablas iniciales.
  El esquema actual le concede además permisos para espacios, rate limiting,
  tickets, avisos, bolsa, mensajes e hitos; la lista anterior de cuatro tablas
  ya no define su radio de acceso. Sus permisos exactos dependen de los `GRANT`
  y políticas de `db/schema.sql`, no de este resumen histórico.

La respuesta a la cuestión 2 de la defensa pasa a ser: *«está aplicada, y así se
verifica — mirá»*.

> **Alcance.** El harness verifica el **esquema versionado**, que es el artefacto
> que entrega la tesis. Que una instancia productiva concreta tenga ese esquema
> aplicado sigue siendo un paso del desplegador (el reencuadre M2 del dictamen).
> Lo que ya no se puede afirmar es que las políticas «no estén probadas».

---

## 4. Validación funcional (E1–E10)

`tests/escenarios.mjs` ejercita el ciclo completo contra el sistema levantado:
alta de lead HOT y COLD, lectura de la propuesta con y sin token válido,
aceptación concurrente, pago idempotente, rechazo, pedido de cambios, estado del
trabajo y token vencido.

Cada escenario mide cuánto tardó. La corrida escribe
`docs/evidencia-validacion.md` con la tabla de resultados y la de métricas,
listo para citar en §5.

Dos detalles que importan para la defensa:

- **La aceptación concurrente se prueba de verdad**: las dos peticiones salen
  con `Promise.all`, sin esperar a que la primera termine. Es el escenario que
  respalda la afirmación de §4.3.2.
- **La columna «Tabla 9» del reporte se completa sólo donde el mapeo es
  inequívoco** (E8, E9, E10, confirmados por el checklist del dictamen v2). El
  resto queda en `—`: hay que cotejarlo contra el documento antes de citarlo.
  El runner no inventa la correspondencia.

Antes de correrla:

```bash
node tests/escenarios.mjs --verificar   # chequea configuración y conectividad
```

---

## 5. Cambios de seguridad

### 5.1 Vigencia del enlace de aceptación

El token UUID no vencía nunca. Ahora `leads.token_expira_en` se estampa al
enviar (o reenviar) la propuesta, con `TOKEN_VIGENCIA_DIAS` días de validez, y
**todas** las consultas que aceptan el token la revalidan:

```sql
... AND (token_expira_en IS NULL OR token_expira_en > now())
```

`IS NULL` deja pasar los leads anteriores a la columna: los enlaces ya emitidos
siguen funcionando. La condición está en las cuatro consultas que aceptan token
(ver propuesta, aceptar, rechazar, pedir cambios), no sólo en la de aceptación.

### 5.1.1 Rotación del token en cada reenvío (31-ago-2026, S3)

La Tabla 11 (S3) proponía originalmente guardar un resumen criptográfico de
`accept_token` en vez del valor en claro. No es viable tal cual: los
recordatorios de seguimiento (`Code - Preparar Follow-up`) releen el token en
claro de la base, días después del envío inicial, para reconstruir el mismo
enlace — un hash irreversible lo impediría.

Se optó por rotación en su lugar: `accept_token` cambia en cada punto donde se
reenvía la propuesta a un correo que ya la había recibido antes —
`/cambio-aceptar`, `/cambio-rechazar` y el cron de seguimiento—, pero no en el
envío inicial, porque ahí no hay ningún token previo que invalidar. Consecuencia
observable: un cliente que abre un correo de propuesta viejo después de que
salió un reenvío ve `status = ya_procesado` en vez de la propuesta, aunque el
enlace nunca se haya usado — el mismo desenlace ambiguo que §4.3.2 ya señala
para el caso de un lead PERDIDO por agotamiento de seguimientos.

Verificado en vivo contra el sistema real (`docs/evidencia-E15-E16.md`): el
token rota en las tres ramas, el enlace anterior deja de aceptar y el nuevo sí.
Queda declarado, sin resolver, un caso límite: si el cron procesa varios leads
en una corrida y el envío de Gmail falla para uno de ellos, su token ya rotó
en la base aunque el correo con el token nuevo nunca haya salido.

### 5.1.2 Los cuatro desenlaces de un enlace no vigente, diferenciados (01-sep-2026)

§4.3.2 documentaba, como deuda, que `POST /lead-acepta` (y el `GET
/lead-propuesta` que carga la pantalla antes de que el cliente llegue a tocar
«Aceptar») devolvían el mismo cartel genérico «este enlace ya fue usado» para
cuatro situaciones distintas:

1. El token ya se usó de verdad (aceptación legítima anterior con este mismo
   token).
2. El lead expiró: pasó a `PERDIDO` por agotar los tres seguimientos.
3. El token rotó porque la propuesta se reenvió (§5.1.1) — el enlace que se
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

`FormularioLeads/src/app/aceptar/[leadId]/aceptar-propuesta.tsx` agrega los
estados de UI `expirado` y `rotado` (antes cualquier `status` no reconocido
caía a `invalido`) y una función `resolverEstadoFalla` que lee `motivo` antes
que `status`.

No cambia la garantía de atomicidad de §4.3.2/RNF2: la transición a `ACEPTADO`
sigue siendo el mismo `UPDATE ... WHERE estado IN ('PROPUESTA_ENVIADA',
'EN_SEGUIMIENTO')` de siempre (`tests/verificar_afirmaciones.mjs`,
`aceptacion-condicional-atomica`); lo que cambia es sólo el diagnóstico que se
arma ANTES de intentarlo.

### 5.2 Credencial en los webhooks del panel

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

### 5.2.1 Token por factura en el pago de modo desarrollo (31-ago-2026)

`GET /webhook/pago-confirmado` es un caso distinto de los cuatro anteriores: no
tiene un cliente legítimo que necesite acceder sin ninguna credencial —el
enlace lo recibe un único destinatario, el cliente deudor, en el PDF de su
propia factura—, así que el razonamiento de "no puede llevar secreto" no
aplica acá. Hasta el 31 de agosto de 2026 exigía sólo `factura_id`
(`FAC-<año>-<4 dígitos>`, 10.000 combinaciones adivinables por año) y ninguna
otra credencial. Se agregó `pago_token`: una columna UUID nueva en `facturas`
(mismo mecanismo que `accept_token`), generada al emitir la factura,
incluida en `pay_url` y exigida por `Code - Validar Pago` antes de continuar,
con la verificación repetida en el `WHERE` de `Postgres - Marcar Cobrado`. Es
S1 de la Tabla 11, cerrada de forma parcial: para `pago-confirmado`, y no para
los cinco webhooks del párrafo anterior, que siguen sin cambios por la misma
razón ya expuesta.

### 5.3 Rol acotado para la conexión de n8n (31-ago-2026, S4)

Hasta el 31 de agosto de 2026, toda la escritura del flujo se hacía con la
`service_role` key: en un proyecto de Supabase real ese rol evade la RLS por
completo (`BYPASSRLS`) y alcanza más que las cinco tablas de este esquema. Si
esa credencial se filtraba —ya ocurrió una vez, ver S7 y §6.3 de la tesis—, el
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

La mitigación de código que la Tabla 11 proponía originalmente para S4
—políticas de escritura acotadas por rol, sin tocar la credencial— no tenía
efecto real: `service_role` con `BYPASSRLS` ignora cualquier política que se
le agregue. Lo que sí cierra la deuda es reemplazar el rol de la conexión, y
eso exigía antes cobertura de pruebas que no existía: `tests/idempotencia.mjs`
corría como superusuario (con la RLS inerte) y sólo un caso de
`tests/rls/casos.sql` ejercitaba una escritura bajo `service_role`. Se agregó:

- **Nueve casos nuevos en `tests/rls/casos.sql`** bajo `n8n_writer`: inserta,
  actualiza y lee `leads` y `logs`; lee `facturas_pendientes`; y confirma que
  no puede borrar, ni leer `profiles`, ni leer `auth.users`.
- **`tests/idempotencia.mjs` ejecuta con `SET ROLE n8n_writer`** las cuatro
  consultas reales del flujo que ya cubría (inserción condicional del lead de
  S6, las tres consultas de reconciliación de S5), en vez de como superusuario.
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

### 5.3.1 Rate limiting de los cinco webhooks públicos (artefacto actual)

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

### 5.3.2 Enmascarado del accept_token en la tabla de auditoría (01-sep-2026, S3 remanente)

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
`FormularioLeads/src/proxy.ts` y el resto del server-side de Next.js (rutas
`api/crm/[accion]` y `auth/*`): ninguno loguea `req.url` ni los query params de
una ruta con `token=`; los `console.error` de la página de aceptación
(`aceptar-propuesta.tsx`) corren en el navegador del cliente, no en logs de
servidor, y sólo registran el propio `Error` de red, no la URL.

### 5.3.3 Inyección de HTML desde el formulario público (23-sep-2026)

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

`tests/escape_html.mjs` (dentro de `npm test`) ejecuta cada nodo con un
payload hostil, exige el escape en cada expresión y comprueba las flags de
Gotenberg. Contra el workflow anterior da 36 fallos.

### 5.3.4 Token revalidado en la escritura y secretos en tiempo constante (23-sep-2026)

- **Aceptación.** `Code - Clasificar Aceptacion` valida el token al leer el
  lead, pero `Postgres - Marcar Aceptado` sólo miraba el estado. Si entre la
  lectura y la escritura la propuesta se reenviaba (el token rota, §5.1.1) o
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

### 5.4 Qué sigue abierto

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

## 6. Robustez

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

## 7. Índices y restricciones

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

## 8. Coherencia entre el documento y el código

`npm run test:afirmaciones` recalcula desde el repositorio los números que
afirma la tesis (nodos, webhooks, crons, tablas, vistas, enums, umbrales de
scoring) y los compara contra `docs/afirmaciones-tesis.json`.

Los cambios posteriores al corte documental se declaran ahí con
`delta_documentado` + `nota`, de modo que aparecen **explicados** en vez de como
una falla. Hoy hay dos: los 2 nodos que el módulo de tickets sumó al CRM.

> ⚠️ **Pendiente tuyo:** la tesis dice «128 nodos funcionales» y el CRM tiene
> ahora 130. Hay que resolverlo en el `.docx` —lo más limpio es documentar el
> módulo de tickets como extensión posterior fechada, que además muestra
> evolución del trabajo—. El verificador deja el desvío a la vista para que no
> se pase por alto.
