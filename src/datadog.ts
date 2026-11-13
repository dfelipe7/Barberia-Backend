/**
 * Trazabilidad:
 * - REQ: IAST (Interactive Application Security Testing) con Datadog
 * - Modelo ejecutor: gemini-2.5-pro
 * - Propósito: inicializar el agente interactivo de Datadog APM/IAST antes de cargar los módulos de NestJS.
 * - Responsabilidad: instrumentar en runtime el flujo de datos para detectar vulnerabilidades en tiempo de ejecución.
 */
import tracer from 'dd-trace';

if (process.env.DD_IAST_ENABLED === 'true' || process.env.DD_API_KEY) {
  tracer.init({
    service: process.env.DD_SERVICE || 'barberia-backend',
    env: process.env.DD_ENV || 'development',
    logInjection: true,
    appsec: true,
    iast: {
      enabled: true,
    },
  });
}

export default tracer;
