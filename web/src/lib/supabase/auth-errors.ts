// Traducción al español de los códigos de error que devuelve Supabase Auth.
//
// El 100 % de los códigos que la plataforma puede devolver en los flujos de la
// aplicación se tiene que mostrar traducido. Los códigos que
// hay que cubrir son los que pueden originar las tres operaciones que la
// aplicación usa —signUp, signInWithPassword y verifyOtp—, y están declarados,
// con su origen, en `CODIGOS_ALCANZABLES` de tests/auth-errores.mjs, que falla
// si alguno queda sin traducir.
const MESSAGES_BY_CODE: Record<string, string> = {
  // ── signInWithPassword ──────────────────────────────────────────────────
  invalid_credentials: "Email o contraseña incorrectos.",
  email_not_confirmed: "Confirmá tu email antes de iniciar sesión.",
  user_banned: "Esta cuenta está bloqueada.",
  user_not_found: "Email o contraseña incorrectos.",

  // ── signUp ──────────────────────────────────────────────────────────────
  user_already_exists: "Ya existe una cuenta con ese email.",
  email_exists: "Ya existe una cuenta con ese email.",
  weak_password: "La contraseña es demasiado débil.",
  email_address_invalid: "El email no tiene un formato válido.",
  email_address_not_authorized: "Ese email no está autorizado para registrarse.",
  email_provider_disabled: "El registro con email y contraseña está deshabilitado.",
  signup_disabled: "El registro de nuevas cuentas está deshabilitado.",

  // ── verifyOtp (enlace de confirmación del email) ────────────────────────
  otp_expired: "El enlace de confirmación venció. Pedí uno nuevo desde el registro.",
  otp_disabled: "La confirmación por email está deshabilitada.",
  flow_state_expired: "El enlace de confirmación venció. Pedí uno nuevo desde el registro.",
  flow_state_not_found: "Este enlace de confirmación ya no es válido. Pedí uno nuevo.",
  bad_code_verifier:
    "Abrí el enlace de confirmación en el mismo navegador desde el que te registraste.",

  // ── Comunes a las tres operaciones ──────────────────────────────────────
  over_request_rate_limit: "Demasiados intentos. Esperá un momento e intentá de nuevo.",
  over_email_send_rate_limit: "Demasiados intentos. Esperá un momento e intentá de nuevo.",
  validation_failed: "Revisá los datos ingresados: alguno no tiene el formato esperado.",
  captcha_failed: "No pudimos verificar que no seas un robot. Intentá de nuevo.",
  request_timeout: "La solicitud tardó demasiado. Intentá de nuevo.",
  unexpected_failure: "El servicio de autenticación no está disponible. Intentá más tarde.",

  // ── Fuera del conjunto alcanzable, se traduce igual ─────────────────────
  // No hay pantalla de cambio de contraseña, así que hoy no puede dispararse;
  // se conserva para que agregarla no reintroduzca un mensaje en inglés.
  same_password: "La nueva contraseña no puede ser igual a la anterior.",
};

function getErrorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const {code} = error as {code: unknown};

    if (typeof code === "string") return code;
  }

  return undefined;
}

export function translateAuthError(error: unknown, fallback: string): string {
  const code = getErrorCode(error);

  if (code && MESSAGES_BY_CODE[code]) return MESSAGES_BY_CODE[code];

  return error instanceof Error ? error.message : fallback;
}
