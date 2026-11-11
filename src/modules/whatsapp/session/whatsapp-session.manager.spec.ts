import { WhatsAppSessionManager } from './whatsapp-session.manager';
import { SesionWhatsAppNegocio } from '../types/whatsapp.types';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { EventEmitter } from 'node:events';

jest.mock('node:os', () => {
  const actual = jest.requireActual('node:os');
  return {
    ...actual,
    homedir: () => (global as any).__mockHomedir || actual.homedir(),
  };
});

const mockSaveCreds = jest.fn().mockResolvedValue(undefined);
let mockSocketEv = new EventEmitter();
let lastCreatedSocket: any = null;

const mockMakeWASocket = jest.fn().mockImplementation((opts) => {
  mockSocketEv = new EventEmitter();
  lastCreatedSocket = {
    ev: {
      on: jest.fn((event: string, cb: (...args: any[]) => void) => {
        mockSocketEv.on(event, cb);
      }),
      removeAllListeners: jest.fn((event?: string) => {
        mockSocketEv.removeAllListeners(event);
      }),
    },
    ws: {
      close: jest.fn(),
      terminate: jest.fn(),
    },
    end: jest.fn().mockResolvedValue(undefined),
    logout: jest.fn().mockResolvedValue(undefined),
    opts,
  };
  return lastCreatedSocket;
});

jest.mock('@whiskeysockets/baileys', () => {
  const actual = jest.requireActual('@whiskeysockets/baileys');
  return {
    __esModule: true,
    ...actual,
    useMultiFileAuthState: jest.fn().mockImplementation(() =>
      Promise.resolve({
        state: {},
        saveCreds: mockSaveCreds,
      }),
    ),
    default: (...args: any[]) => mockMakeWASocket(...args),
  };
});

jest.mock('qrcode', () => ({
  toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,mocked-qr-data-url'),
}));

describe('WhatsAppSessionManager', () => {
  let tempBaseDir: string;
  let sesionesMap: Map<number, SesionWhatsAppNegocio>;
  let manager: WhatsAppSessionManager;

  beforeEach(() => {
    jest.clearAllMocks();
    tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-test-session-'));
    sesionesMap = new Map();
    manager = new WhatsAppSessionManager(sesionesMap, tempBaseDir);
  });

  afterEach(() => {
    for (const sesion of sesionesMap.values()) {
      manager.limpiarTimerInactividad(sesion);
      manager.destruirSocket(sesion);
    }
    jest.restoreAllMocks();
    try {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    } catch {}
  });

  describe('obtenerDirectorioSesion', () => {
    it('genera la ruta de sesión esperada para cualquier negocio', () => {
      const ruta = manager.obtenerDirectorioSesion(5);
      expect(ruta).toBe(path.join(tempBaseDir, 'negocio_5'));
    });

    it('migra archivos de ~/.kyrios_whatsapp_session para negocio 1 si existe', () => {
      const fakeHome = path.join(tempBaseDir, 'fake-home');
      fs.mkdirSync(fakeHome, { recursive: true });
      (global as any).__mockHomedir = fakeHome;

      const dirHistorico = path.join(fakeHome, '.kyrios_whatsapp_session');
      fs.mkdirSync(dirHistorico, { recursive: true });
      fs.writeFileSync(path.join(dirHistorico, 'dummy_kyrios.json'), '{}');

      const dir1 = manager.obtenerDirectorioSesion(1);
      expect(fs.existsSync(dir1)).toBe(true);
      expect(fs.existsSync(path.join(dir1, 'dummy_kyrios.json'))).toBe(true);

      delete (global as any).__mockHomedir;
    });
  });

  describe('obtenerOCrearSesion', () => {
    it('crea una nueva sesión en reposo si no existe en el mapa', () => {
      const sesion = manager.obtenerOCrearSesion(2);

      expect(sesion.negocioId).toBe(2);
      expect(sesion.isConnected).toBe(false);
      expect(sesion.enReposo).toBe(true);
      expect(sesion.sock).toBeNull();
      expect(sesionesMap.has(2)).toBe(true);
    });

    it('retorna la sesión existente si ya fue instanciada', () => {
      const sesion1 = manager.obtenerOCrearSesion(3);
      sesion1.enReposo = false;

      const sesion2 = manager.obtenerOCrearSesion(3);
      expect(sesion2.enReposo).toBe(false);
      expect(sesion2).toBe(sesion1);
    });
  });

  describe('tieneSesionGuardada', () => {
    it('retorna false si el directorio o creds.json no existen', () => {
      expect(manager.tieneSesionGuardada(10)).toBe(false);
    });

    it('retorna true cuando existe creds.json con credenciales autenticadas', () => {
      const dirNegocio = path.join(tempBaseDir, 'negocio_10');
      fs.mkdirSync(dirNegocio, { recursive: true });
      fs.writeFileSync(
        path.join(dirNegocio, 'creds.json'),
        JSON.stringify({ me: { id: '573187594854:1@s.whatsapp.net', name: 'Barberia' } }),
      );

      expect(manager.tieneSesionGuardada(10)).toBe(true);
    });

    it('retorna false si creds.json contiene JSON inválido o sin propiedad me', () => {
      const dirNegocio = path.join(tempBaseDir, 'negocio_11');
      fs.mkdirSync(dirNegocio, { recursive: true });
      fs.writeFileSync(path.join(dirNegocio, 'creds.json'), '{ invalido: true }');

      expect(manager.tieneSesionGuardada(11)).toBe(false);
    });
  });

  describe('limpiarTimerInactividad y reiniciarTimerInactividad', () => {
    it('limpia el timer activo si existe', () => {
      const sesion = manager.obtenerOCrearSesion(4);
      sesion.qrInactivityTimer = setTimeout(() => {}, 10000);

      manager.limpiarTimerInactividad(sesion);
      expect(sesion.qrInactivityTimer).toBeNull();
    });

    it('reinicia el timer de 60 segundos si no hay sesión guardada ni conectada', () => {
      const sesion = manager.obtenerOCrearSesion(4);
      manager.reiniciarTimerInactividad(sesion);

      expect(sesion.qrInactivityTimer).not.toBeNull();
      manager.limpiarTimerInactividad(sesion);
    });

    it('ejecuta el callback de inactividad pasando a reposo y limpiando qr', () => {
      let timerCb: () => void = () => {};
      jest.spyOn(global, 'setTimeout').mockImplementationOnce(((cb: () => void) => {
        timerCb = cb;
        return 123 as any;
      }) as any);

      const sesion = manager.obtenerOCrearSesion(14);
      sesion.enReposo = false;
      sesion.qrDataUrl = 'data:image/png;base64,data';

      manager.reiniciarTimerInactividad(sesion);
      expect(sesion.qrInactivityTimer).not.toBeNull();

      timerCb();

      expect(sesion.enReposo).toBe(true);
      expect(sesion.qrDataUrl).toBeNull();
    });
  });

  describe('destruirSocket', () => {
    it('limpia listeners y cierra websocket de forma segura', () => {
      const mockRemove = jest.fn();
      const mockClose = jest.fn();
      const mockEnd = jest.fn().mockResolvedValue(undefined);

      const sesion = manager.obtenerOCrearSesion(7);
      sesion.sock = {
        ev: { removeAllListeners: mockRemove },
        ws: { close: mockClose },
        end: mockEnd,
      } as any;

      manager.destruirSocket(sesion);

      expect(mockRemove).toHaveBeenCalledWith('connection.update');
      expect(mockRemove).toHaveBeenCalledWith('creds.update');
      expect(mockClose).toHaveBeenCalled();
      expect(sesion.sock).toBeNull();
      expect(sesion.isConnecting).toBe(false);
    });
  });

  describe('limpiarCarpetaSesion y limpiarCarpetaSesionIncompleta', () => {
    it('elimina la carpeta física de sesión en disco', () => {
      const sesion = manager.obtenerOCrearSesion(8);
      fs.mkdirSync(sesion.sessionDir, { recursive: true });
      fs.writeFileSync(path.join(sesion.sessionDir, 'dummy.txt'), 'data');

      expect(fs.existsSync(sesion.sessionDir)).toBe(true);
      manager.limpiarCarpetaSesion(sesion);
      expect(fs.existsSync(sesion.sessionDir)).toBe(false);
    });

    it('limpia carpeta incompleta si no hay sesión autenticada', () => {
      const sesion = manager.obtenerOCrearSesion(9);
      fs.mkdirSync(sesion.sessionDir, { recursive: true });

      manager.limpiarCarpetaSesionIncompleta(sesion);
      expect(fs.existsSync(sesion.sessionDir)).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('retorna estado desconectado y sin QR por defecto', () => {
      const status = manager.getStatus(20);
      expect(status).toEqual({ conectado: false, qr: null });
    });

    it('retorna el QR si la sesión tiene qrDataUrl y no está conectada', () => {
      const sesion = manager.obtenerOCrearSesion(21);
      sesion.qrDataUrl = 'data:image/png;base64,mockqr';
      sesion.isConnected = false;

      const status = manager.getStatus(21);
      expect(status).toEqual({ conectado: false, qr: 'data:image/png;base64,mockqr' });
    });

    it('retorna conectado true y qr null si la sesión ya está conectada', () => {
      const sesion = manager.obtenerOCrearSesion(22);
      sesion.isConnected = true;
      sesion.qrDataUrl = 'data:image/png;base64,oldqr';

      const status = manager.getStatus(22);
      expect(status).toEqual({ conectado: true, qr: null });
    });
  });

  describe('hayAlgunaSesionConectada', () => {
    it('retorna false si ninguna sesión está conectada', () => {
      manager.obtenerOCrearSesion(1);
      manager.obtenerOCrearSesion(2);
      expect(manager.hayAlgunaSesionConectada()).toBe(false);
    });

    it('retorna true si al menos una sesión en el mapa está conectada', () => {
      const s1 = manager.obtenerOCrearSesion(1);
      const s2 = manager.obtenerOCrearSesion(2);
      s2.isConnected = true;

      expect(manager.hayAlgunaSesionConectada()).toBe(true);
    });
  });

  describe('pausar', () => {
    it('pone la sesión en reposo si no está conectada ni tiene sesión guardada', () => {
      const sesion = manager.obtenerOCrearSesion(30);
      sesion.enReposo = false;
      sesion.qrDataUrl = 'data:image/png;base64,qr';

      const res = manager.pausar(30, () => false);
      expect(res).toEqual({ mensaje: 'WhatsApp en modo reposo.' });
      expect(sesion.enReposo).toBe(true);
      expect(sesion.qrDataUrl).toBeNull();
    });

    it('retorna mensaje de activo si ya tiene sesión guardada', () => {
      const res = manager.pausar(31, () => true);
      expect(res).toEqual({ mensaje: 'WhatsApp activo con sesión guardada.' });
    });
  });

  describe('desconectar', () => {
    it('ejecuta logout, destruye socket y limpia directorio', async () => {
      const mockLogout = jest.fn().mockResolvedValue(undefined);
      const sesion = manager.obtenerOCrearSesion(40);
      sesion.sock = {
        logout: mockLogout,
        ev: { removeAllListeners: jest.fn() },
        ws: { close: jest.fn() },
        end: jest.fn(),
      } as any;
      fs.mkdirSync(sesion.sessionDir, { recursive: true });

      const res = await manager.desconectar(40);

      expect(mockLogout).toHaveBeenCalled();
      expect(res).toEqual({ mensaje: 'Dispositivo WhatsApp desvinculado con éxito.' });
      expect(sesion.isConnected).toBe(false);
      expect(sesion.enReposo).toBe(true);
    });

    it('maneja error al ejecutar logout en socket roto', async () => {
      const mockLogout = jest.fn().mockRejectedValue(new Error('Socket disconnected'));
      const sesion = manager.obtenerOCrearSesion(41);
      sesion.sock = {
        logout: mockLogout,
        ev: { removeAllListeners: jest.fn() },
        ws: { close: jest.fn() },
        end: jest.fn(),
      } as any;

      const res = await manager.desconectar(41);
      expect(res).toEqual({ mensaje: 'Dispositivo WhatsApp desvinculado con éxito.' });
    });
  });

  describe('iniciarSocket retornos tempranos', () => {
    it('retorna inmediatamente si ya está conectándose (isConnecting)', async () => {
      const sesion = manager.obtenerOCrearSesion(50);
      sesion.isConnecting = true;

      await manager.iniciarSocket(50);
      expect(sesion.sock).toBeNull();
    });

    it('retorna inmediatamente si ya está conectado', async () => {
      const sesion = manager.obtenerOCrearSesion(51);
      sesion.isConnected = true;
      sesion.sock = {} as any;

      await manager.iniciarSocket(51);
      expect(sesion.isConnected).toBe(true);
    });
  });

  describe('iniciarSocket y ciclo de vida de conexión Baileys', () => {
    it('cancela inicio si sesion.enReposo es true tras leer auth state', async () => {
      const sesion = manager.obtenerOCrearSesion(60);
      sesion.enReposo = true;
      await manager.iniciarSocket(60);
      expect(mockMakeWASocket).not.toHaveBeenCalled();
    });

    it('inicializa socket y registra listeners cuando sesion.enReposo es false', async () => {
      const sesion = manager.obtenerOCrearSesion(61);
      sesion.enReposo = false;
      await manager.iniciarSocket(61, { nombreNegocio: 'Studio Test' });

      expect(mockMakeWASocket).toHaveBeenCalled();
      expect(sesion.sock).toBe(lastCreatedSocket);
    });

    it('guarda credenciales al emitir creds.update', async () => {
      const sesion = manager.obtenerOCrearSesion(62);
      sesion.enReposo = false;
      await manager.iniciarSocket(62);

      mockSocketEv.emit('creds.update');
      expect(mockSaveCreds).toHaveBeenCalled();
    });

    it('genera qrDataUrl cuando recibe evento qr', async () => {
      const sesion = manager.obtenerOCrearSesion(63);
      sesion.enReposo = false;
      await manager.iniciarSocket(63);

      mockSocketEv.emit('connection.update', { qr: 'mock-qr-code-string' });
      await new Promise((r) => setImmediate(r));

      expect(sesion.qrDataUrl).toBe('data:image/png;base64,mocked-qr-data-url');
      expect(sesion.isConnected).toBe(false);
      manager.limpiarTimerInactividad(sesion);
    });

    it('establece isConnected en true y ejecuta callback onConnected al abrir conexion', async () => {
      const sesion = manager.obtenerOCrearSesion(64);
      sesion.enReposo = false;
      const onConnectedMock = jest.fn();

      await manager.iniciarSocket(64, { onConnected: onConnectedMock });

      mockSocketEv.emit('connection.update', { connection: 'open' });
      await new Promise((r) => setImmediate(r));

      expect(sesion.isConnected).toBe(true);
      expect(sesion.enReposo).toBe(false);
      expect(sesion.qrDataUrl).toBeNull();
      expect(onConnectedMock).toHaveBeenCalledWith(64);
    });

    it('cierra socket sin reconectar cuando la sesion fue reemplazada (440)', async () => {
      const sesion = manager.obtenerOCrearSesion(65);
      sesion.enReposo = false;
      await manager.iniciarSocket(65);

      mockSocketEv.emit('connection.update', {
        connection: 'close',
        lastDisconnect: {
          error: { output: { statusCode: 440 } } as any,
        },
      });
      await new Promise((r) => setImmediate(r));

      expect(sesion.sock).toBeNull();
    });

    it('limpia credenciales en disco al cerrar sesion por loggedOut (401)', async () => {
      const sesion = manager.obtenerOCrearSesion(66);
      sesion.enReposo = false;
      fs.mkdirSync(sesion.sessionDir, { recursive: true });
      fs.writeFileSync(path.join(sesion.sessionDir, 'creds.json'), '{}');

      await manager.iniciarSocket(66);

      mockSocketEv.emit('connection.update', {
        connection: 'close',
        lastDisconnect: {
          error: { output: { statusCode: 401 } } as any,
        },
      });
      await new Promise((r) => setImmediate(r));

      expect(fs.existsSync(sesion.sessionDir)).toBe(false);
    });

    it('programa reconexion cuando la sesion esta autenticada en disco y se desconecta', async () => {
      let reconnCb: () => void = () => {};
      jest.spyOn(global, 'setTimeout').mockImplementationOnce(((cb: () => void) => {
        reconnCb = cb;
        return 999 as any;
      }) as any);

      const sesion = manager.obtenerOCrearSesion(67);
      sesion.enReposo = false;
      fs.mkdirSync(sesion.sessionDir, { recursive: true });
      fs.writeFileSync(
        path.join(sesion.sessionDir, 'creds.json'),
        JSON.stringify({ me: { id: '573187594854:1@s.whatsapp.net' } }),
      );

      await manager.iniciarSocket(67);

      mockSocketEv.emit('connection.update', {
        connection: 'close',
        lastDisconnect: {
          error: { output: { statusCode: 500 } } as any,
        },
      });
      await new Promise((r) => setImmediate(r));

      expect(sesion.isConnected).toBe(false);
      expect(typeof reconnCb).toBe('function');
    });

    it('programa regeneracion de QR cuando WhatsApp solicita reinicio (515) sin sesion guardada', async () => {
      let restartCb: () => void = () => {};
      jest.spyOn(global, 'setTimeout').mockImplementationOnce(((cb: () => void) => {
        restartCb = cb;
        return 998 as any;
      }) as any);

      const sesion = manager.obtenerOCrearSesion(68);
      sesion.enReposo = false;

      await manager.iniciarSocket(68);

      mockSocketEv.emit('connection.update', {
        connection: 'close',
        lastDisconnect: {
          error: { output: { statusCode: 515 } } as any,
        },
      });
      await new Promise((r) => setImmediate(r));

      expect(sesion.isConnected).toBe(false);
      expect(typeof restartCb).toBe('function');
    });

    it('pone en reposo y limpia carpeta preliminar ante cierre generico sin sesion', async () => {
      const sesion = manager.obtenerOCrearSesion(69);
      sesion.enReposo = false;
      fs.mkdirSync(sesion.sessionDir, { recursive: true });

      await manager.iniciarSocket(69);

      mockSocketEv.emit('connection.update', {
        connection: 'close',
        lastDisconnect: {
          error: { output: { statusCode: 408 } } as any,
        },
      });
      await new Promise((r) => setImmediate(r));

      expect(sesion.enReposo).toBe(true);
      expect(fs.existsSync(sesion.sessionDir)).toBe(false);
    });

    it('ignora connection.update y cierra socket si la sesion ya entro en reposo', async () => {
      const sesion = manager.obtenerOCrearSesion(70);
      sesion.enReposo = false;

      await manager.iniciarSocket(70);
      sesion.enReposo = true;

      mockSocketEv.emit('connection.update', { connection: 'open' });
      await new Promise((r) => setImmediate(r));

      expect(sesion.isConnected).toBe(false);
    });
  });
});
