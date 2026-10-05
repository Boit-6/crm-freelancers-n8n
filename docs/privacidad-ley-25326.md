# Cumplimiento de la Ley 25.326 (Protección de Datos Personales) — estado y pendientes

> **Este documento y el aviso de privacidad que describe son un BORRADOR.** No constituyen
> asesoramiento legal ni sustituyen la revisión de un/a abogado/a especializado/a en protección
> de datos personales. No deben usarse para operar con datos reales de clientes sin esa revisión
> previa: el cumplimiento de la Ley 25.326 es una condición para operar con clientes reales, no
> una mejora opcional.

## 1. Contexto

El sistema capta, almacena y transfiere a
terceros (Supabase, el servicio de correo/Gmail y Telegram) datos de contacto de
personas físicas identificables — nombre, correo, teléfono, presupuesto y descripción del
proyecto — sin aviso de privacidad, consentimiento informado, política de retención ni
inscripción de la base ante el organismo de control, y que varios de esos destinatarios están
domiciliados en países que la Disposición 60-E/2016 no reconoce como de protección adecuada, lo
que activa además el régimen de transferencia internacional del art. 12 de la Ley 25.326.

Este trabajo implementa una primera respuesta parcial a esa deuda, acotada al frontend público
(`FormularioLeads`), que es el único punto de captación de datos personales del sistema.

## 2. Qué se implementó

### 2.1 Texto del aviso de privacidad

- Archivo: `web/src/app/components/AvisoPrivacidad.tsx`.
- Cubre los cinco elementos que exige el art. 6 de la Ley 25.326 al momento de recolectar el
  dato:
  1. Finalidad del tratamiento (punto 2 del aviso).
  2. Carácter obligatorio o facultativo de cada dato solicitado (punto 3).
  3. Destinatarios de los datos: Supabase, Gmail, Telegram (punto 4).
  4. Identidad del responsable, con placeholders a completar (punto 1).
  5. Posibilidad de ejercer los derechos de acceso, rectificación y supresión —derechos
     ARCO— (punto 5), incluyendo la mención a la Agencia de Acceso a la Información Pública
     (AAIP) como órgano de control.
- Agrega un párrafo **separado y explícito** de
  consentimiento para la transferencia internacional de datos a Supabase/Gmail/Telegram
  (punto 8 del aviso, arts. 11 y 12 de la Ley 25.326), distinto del consentimiento general para
  el tratamiento.
- Contiene placeholders explícitos donde falta un dato real de la organización responsable:
  `[RAZÓN SOCIAL / NOMBRE DEL RESPONSABLE]`, `[DOMICILIO LEGAL]`, `[CUIT/CUIL]` y
  `[EMAIL DE CONTACTO PARA EJERCER DERECHOS ARCO]`.

### 2.2 Integración en el formulario público

- `web/src/app/(plataforma)/privacidad/page.tsx`: nueva ruta que renderiza el aviso completo.
- `web/src/app/components/lead-form.tsx`:
  - Se agregó el campo `consentimiento: boolean` al estado del formulario (`FormData`),
    inicializado en `false`.
  - `handleChange` se extendió para soportar inputs de tipo `checkbox` (usa `checked` en lugar
    de `value`), siguiendo el mismo patrón de estado único de React que ya usaba el resto del
    formulario.
  - La función `validate()` —la misma que ya validaba nombre, email, servicio y descripción—
    ahora también exige `data.consentimiento === true`; si no está marcado, el formulario **no
    se envía** y se muestra el mismo tipo de mensaje de error que usan las demás validaciones
    ("Debés aceptar la Política de Privacidad para poder enviar el formulario.").
  - Se agregó un checkbox obligatorio, con el texto "He leído y acepto el tratamiento de mis
    datos personales, incluida su transferencia internacional a los prestadores mencionados,
    conforme a la Política de Privacidad", con un enlace a `/privacidad` (se abre en una pestaña
    nueva para no perder los datos ya cargados en el formulario).
  - El valor de `consentimiento` viaja en el `body` del POST al webhook `lead/nuevo` junto con el
    resto de los campos (se hace `...formData` como ya hacía el código existente), de modo que
    queda registrado en el payload que recibe n8n en el momento del envío.

## 3. Qué queda pendiente

Esto es lo que hace falta y que el aviso **no** resuelve:

1. **Completar los placeholders con datos reales** de la persona o razón social responsable del
   tratamiento, y hacer que un profesional del derecho revise el texto completo del aviso antes
   de publicarlo con datos de clientes reales.
2. **Inscripción de la base de datos ante la Agencia de Acceso a la Información Pública (AAIP)**,
   conforme al art. 21 de la Ley 25.326. No se realizó ningún trámite ni gestión ante el
   organismo; es un paso administrativo externo al código.
3. **Política de retención concreta.** El aviso menciona en términos generales que los datos se
   conservan mientras sean necesarios y luego se suprimen (art. 4.7), pero no define plazos
   exactos por tipo de dato, ni implementa ningún proceso automático de purga o anonimización en
   la base (`db/schema.sql` no tiene hoy ninguna rutina de expiración o borrado de leads
   antiguos). Definir esa política y automatizarla es trabajo futuro.
4. **Cláusulas contractuales tipo (Disposición 60-E/2016) con cada encargado** domiciliado fuera
   de los países de protección adecuada (Supabase, Google/Gmail, Telegram), como vía
   alternativa o complementaria al consentimiento expreso del titular para la transferencia
   internacional. No se gestionó ni redactó ninguna cláusula contractual con estos proveedores;
   el trabajo se apoyó únicamente en la vía del consentimiento expreso del titular (art. 11 y
   12).
5. **Registro auditable del consentimiento en la base de datos.** Hoy el valor de
   `consentimiento` viaja en el payload que recibe el webhook de n8n, pero no se agregó ninguna
   columna en `db/schema.sql` (tabla `leads`) para persistirlo de forma consultable, ni se
   modificó el flujo de n8n (`workflow/crm_postgres.json`) para grabarlo. Deliberadamente no se
   tocó el esquema de base de datos ni el nodo `Postgres - Insert Lead` en este trabajo, para no
   introducir cambios de esquema sin poder probarlos contra una instancia real (ver también la
   Tarea 2 de este mismo cambio, sobre las limitaciones de probar el flujo de n8n sin poder
   levantarlo). Persistir el consentimiento con marca de tiempo y versión del aviso aceptado es
   necesario para poder demostrar, ante una eventual auditoría o reclamo, que el consentimiento
   se prestó.
6. **Aviso equivalente en otros puntos de captación**, si en el futuro se agregan (por ejemplo,
   un formulario de alta de usuarios distinto del que ya usa Supabase Auth en `register-form.tsx`,
   que no fue analizado en el alcance de este cambio).
7. **Revisión de RLS y accesos internos** desde la óptica del art. 9 (medidas de seguridad): este
   trabajo no auditó las políticas de Row Level Security de `db/schema.sql` con ese criterio
   específico; ver `docs/seguridad.md` para lo ya evaluado en materia de
   seguridad técnica (que es una dimensión relacionada pero distinta de la conformidad con la
   Ley 25.326).
