/**
 * Trazabilidad:
 * - REQ: REQ-009
 * - Modelo ejecutor: minimax-m3.1-flash-free
 * - Propósito: doble de prueba del proveedor externo de WhatsApp (baileys).
 * - Responsabilidad: simular la sesión de WhatsApp en las pruebas que NO verifican la integración real.
 *
 * Alcance: solo se usa en las suites que arrancan la aplicación en pruebas
 * (jest unitario, jest E2E y jest multitenant). Ninguna de ellas verifica la
 * integración real con WhatsApp: eso exigiría una cuenta y una sesión reales.
 * Las funciones de identificación de JID se exportan completas porque el
 * servicio de WhatsApp las invoca al recibir mensajes.
 */
const makeWASocket = jest.fn().mockReturnValue({
  ev: {
    on: jest.fn(),
    removeAllListeners: jest.fn(),
  },
  end: jest.fn(),
  logout: jest.fn(),
  sendMessage: jest.fn().mockResolvedValue(true),
});

module.exports = {
  __esModule: true,
  default: makeWASocket,
  makeWASocket,
  DisconnectReason: {
    connectionClosed: 428,
    connectionLost: 408,
    connectionReplaced: 440,
    timedOut: 408,
    loggedOut: 401,
    badSession: 500,
    restartRequired: 515,
    multideviceMismatch: 411,
  },
  useMultiFileAuthState: jest.fn().mockResolvedValue({
    state: {},
    saveCreds: jest.fn(),
  }),
  isJidBroadcast: jest.fn().mockReturnValue(false),
  isJidStatusBroadcast: jest.fn().mockReturnValue(false),
  isJidNewsletter: jest.fn().mockReturnValue(false),
};
