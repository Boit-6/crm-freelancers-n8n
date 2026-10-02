import type {ServicioTipo, UrgenciaTipo} from "@/types/supabase";

// Cómo se muestran los enums de la base a una persona. Code - Email Rechazo
// Pedido (n8n) tiene la misma tabla para el asunto del correo.
export const SERVICIO_LEGIBLE: Record<ServicioTipo, string> = {
  desarrollo_web: "Desarrollo web",
  ecommerce: "Tienda online",
  app_movil: "App móvil",
  automatizacion: "Automatización",
  marketing: "Marketing digital",
  seo: "SEO",
  diseno_ui: "Diseño UX/UI",
  consultoria: "Consultoría",
  soporte: "Soporte",
};

export const URGENCIA_LEGIBLE: Record<UrgenciaTipo, string> = {
  alta: "Lo antes posible",
  media: "Próximas semanas",
  baja: "Sin apuro",
};
