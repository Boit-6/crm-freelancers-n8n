// Verifica el RNF5 en su mitad medible: que el 100 % de los códigos de error
// que la plataforma de autenticación puede devolver en los flujos de la
// aplicación tenga un mensaje en español.
//
// El requisito se enunciaba con un método —«recuento de códigos cubiertos por
// translateAuthError sobre el total de códigos posibles»— que nunca se ejecutó,
// y por eso el RNF5 figuraba como verificado sólo parcialmente. El problema de
// ese enunciado es «el total de códigos posibles»: Supabase Auth documenta 83,
// y la mayoría corresponde a proveedores y factores que esta aplicación no
// habilita (OAuth, SAML/SSO, teléfono y SMS, MFA, sesiones anónimas, hooks y
// operaciones de administración). Medir contra los 83 no diría nada útil.
//
// El denominador correcto es el conjunto de códigos que pueden originar las
// tres operaciones que la aplicación efectivamente invoca: signUp con email y
// contraseña (register-form.tsx), signInWithPassword (login-form.tsx) y
// verifyOtp (manejador /auth/confirm). Ese conjunto se declara abajo, código
// por código y con la operación que lo origina, tomado de la documentación de
// códigos de error de Supabase Auth.
//
// Uso: node tests/auth-errores.mjs
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const FUENTE = path.join(
  aqui, '..', 'web', 'src', 'lib', 'supabase', 'auth-errors.ts',
);

// Denominador del RNF5: qué puede devolver la plataforma en ESTOS flujos.
const CODIGOS_ALCANZABLES = [
  // signInWithPassword
  ['invalid_credentials',          'signIn',  'credenciales que no coinciden'],
  ['email_not_confirmed',          'signIn',  'la cuenta existe pero no confirmó el email'],
  ['user_banned',                  'signIn',  'la cuenta tiene un bloqueo activo'],
  ['user_not_found',               'signIn',  'la cuenta fue eliminada'],

  // signUp (email + contraseña)
  ['user_already_exists',          'signUp',  'ya existe el usuario'],
  ['email_exists',                 'signUp',  'el email ya está en el sistema'],
  ['weak_password',                'signUp',  'la contraseña no alcanza la fortaleza exigida'],
  ['email_address_invalid',        'signUp',  'dominio de email no admitido'],
  ['email_address_not_authorized', 'signUp',  'restricción del SMTP por defecto'],
  ['email_provider_disabled',      'signUp',  'el alta con email y contraseña está deshabilitada'],
  ['signup_disabled',              'signUp',  'el alta de cuentas nuevas está deshabilitada'],
  ['over_email_send_rate_limit',   'signUp',  'demasiados correos de confirmación enviados'],

  // verifyOtp (enlace de confirmación que llega por correo)
  ['otp_expired',                  'verifyOtp', 'el enlace de confirmación venció'],
  ['otp_disabled',                 'verifyOtp', 'la confirmación por email está deshabilitada'],
  ['flow_state_expired',           'verifyOtp', 'venció el estado PKCE del flujo'],
  ['flow_state_not_found',         'verifyOtp', 'el estado PKCE ya no existe'],
  ['bad_code_verifier',            'verifyOtp', 'se abrió el enlace en otro navegador'],

  // Comunes a las tres
  ['over_request_rate_limit',      'todas',   'demasiadas peticiones desde la misma IP'],
  ['validation_failed',            'todas',   'parámetros con formato incorrecto'],
  ['captcha_failed',               'todas',   'falló la verificación de CAPTCHA si está activa'],
  ['request_timeout',              'todas',   'la petición excedió el tiempo límite'],
  ['unexpected_failure',           'todas',   'falla no especificada del servicio'],
];

// Extrae las claves del mapa `MESSAGES_BY_CODE` leyendo la fuente. Se lee el
// archivo real y no una copia, con el mismo criterio que el resto de la suite:
// si el mapa cambia, esta verificación lo ve.
function codigosTraducidos() {
  const src = readFileSync(FUENTE, 'utf8');
  const inicio = src.indexOf('MESSAGES_BY_CODE');
  if (inicio === -1) throw new Error('No se encontró MESSAGES_BY_CODE en ' + FUENTE);

  const abre = src.indexOf('{', inicio);
  const cierra = src.indexOf('\n};', abre);
  if (abre === -1 || cierra === -1) throw new Error('No se pudo delimitar MESSAGES_BY_CODE');

  const cuerpo = src.slice(abre + 1, cierra);
  const claves = new Map();
  // `codigo: "mensaje"`, ignorando comentarios de línea.
  const re = /^\s*([a-z0-9_]+)\s*:\s*"([^"]*)"/gm;
  let m;
  while ((m = re.exec(cuerpo)) !== null) claves.set(m[1], m[2]);
  return claves;
}

const traducidos = codigosTraducidos();
let fallas = 0;

console.log(`── Códigos alcanzables por los flujos de la aplicación (${CODIGOS_ALCANZABLES.length})\n`);

for (const [codigo, operacion, motivo] of CODIGOS_ALCANZABLES) {
  const mensaje = traducidos.get(codigo);
  if (!mensaje) {
    fallas++;
    console.log(`FALTA ${codigo}  (${operacion}: ${motivo})`);
  } else if (!mensaje.trim()) {
    fallas++;
    console.log(`VACÍO ${codigo}  (${operacion})`);
  } else {
    console.log(`OK    ${codigo}  ->  «${mensaje}»`);
  }
}

const cubiertos = CODIGOS_ALCANZABLES.length - fallas;
const pct = ((cubiertos / CODIGOS_ALCANZABLES.length) * 100).toFixed(1);

const extra = [...traducidos.keys()].filter(
  (c) => !CODIGOS_ALCANZABLES.some(([codigo]) => codigo === c),
);
if (extra.length) {
  console.log(`\nTraducidos fuera del conjunto alcanzable (no penalizan): ${extra.join(', ')}`);
}

console.log(`\nCobertura del RNF5: ${cubiertos}/${CODIGOS_ALCANZABLES.length} (${pct} %)`);
console.log(`Resultado: ${cubiertos} OK, ${fallas} sin traducir`);
process.exit(fallas ? 1 : 0);
