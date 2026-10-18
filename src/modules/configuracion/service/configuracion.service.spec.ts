import { ConfiguracionService } from './configuracion.service';
import {
  ConfiguracionRepository,
  ConfiguracionRegistro,
} from '../repository/configuracion.repository';
import { TTL_CACHE_CONFIGURACION_MS } from '../configuracion.constants';

const registro = (
  over: Partial<ConfiguracionRegistro> = {},
): ConfiguracionRegistro => ({
  clave: 'clave',
  valor: 'valor',
  tipo: 'TEXTO',
  editable: true,
  ...over,
});

describe('ConfiguracionService', () => {
  let service: ConfiguracionService;
  const repository = {
    buscarPorClave: jest.fn(),
    listar: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ConfiguracionService(
      repository as unknown as ConfiguracionRepository,
    );
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('obtenerNumero', () => {
    it('convierte un valor NUMERO almacenado como texto', async () => {
      repository.buscarPorClave.mockResolvedValue(
        registro({ valor: '45', tipo: 'NUMERO' }),
      );

      await expect(service.obtenerNumero('clave', 120)).resolves.toBe(45);
    });

    it('usa el valor por defecto si la configuración no existe', async () => {
      repository.buscarPorClave.mockResolvedValue(null);

      await expect(service.obtenerNumero('clave', 120)).resolves.toBe(120);
    });

    it('usa el valor por defecto si el valor no es numérico', async () => {
      repository.buscarPorClave.mockResolvedValue(
        registro({ valor: 'no-numero', tipo: 'NUMERO' }),
      );

      await expect(service.obtenerNumero('clave', 120)).resolves.toBe(120);
    });

    it('usa el valor por defecto si el tipo almacenado no coincide', async () => {
      repository.buscarPorClave.mockResolvedValue(
        registro({ valor: '45', tipo: 'TEXTO' }),
      );

      await expect(service.obtenerNumero('clave', 120)).resolves.toBe(120);
    });

    it('acepta el cero como valor numérico válido', async () => {
      repository.buscarPorClave.mockResolvedValue(
        registro({ valor: '0', tipo: 'NUMERO' }),
      );

      await expect(service.obtenerNumero('clave', 120)).resolves.toBe(0);
    });
  });

  describe('obtenerTexto', () => {
    it('devuelve el valor textual almacenado', async () => {
      repository.buscarPorClave.mockResolvedValue(
        registro({ valor: 'America/Bogota', tipo: 'TEXTO' }),
      );

      await expect(service.obtenerTexto('clave', 'UTC')).resolves.toBe(
        'America/Bogota',
      );
    });

    it('usa el valor por defecto si la configuración no existe', async () => {
      repository.buscarPorClave.mockResolvedValue(null);

      await expect(service.obtenerTexto('clave', 'UTC')).resolves.toBe('UTC');
    });

    it('usa el valor por defecto si el tipo almacenado no coincide', async () => {
      repository.buscarPorClave.mockResolvedValue(
        registro({ valor: 'texto', tipo: 'NUMERO' }),
      );

      await expect(service.obtenerTexto('clave', 'UTC')).resolves.toBe('UTC');
    });
  });

  describe('obtenerBooleano', () => {
    it('convierte "true" a booleano verdadero', async () => {
      repository.buscarPorClave.mockResolvedValue(
        registro({ valor: 'true', tipo: 'BOOLEANO' }),
      );

      await expect(service.obtenerBooleano('clave', false)).resolves.toBe(true);
    });

    it('convierte "FALSE" a booleano falso', async () => {
      repository.buscarPorClave.mockResolvedValue(
        registro({ valor: 'FALSE', tipo: 'BOOLEANO' }),
      );

      await expect(service.obtenerBooleano('clave', true)).resolves.toBe(false);
    });

    it('usa el valor por defecto si el valor no es booleano', async () => {
      repository.buscarPorClave.mockResolvedValue(
        registro({ valor: 'quizas', tipo: 'BOOLEANO' }),
      );

      await expect(service.obtenerBooleano('clave', false)).resolves.toBe(
        false,
      );
    });

    it('usa el valor por defecto si la configuración no existe', async () => {
      repository.buscarPorClave.mockResolvedValue(null);

      await expect(service.obtenerBooleano('clave', true)).resolves.toBe(true);
    });
  });

  describe('obtenerJson', () => {
    it('parsea un valor JSON válido', async () => {
      repository.buscarPorClave.mockResolvedValue(
        registro({ valor: '{"a":1,"b":[2,3]}', tipo: 'JSON' }),
      );

      await expect(service.obtenerJson('clave', null)).resolves.toEqual({
        a: 1,
        b: [2, 3],
      });
    });

    it('usa el valor por defecto si el JSON es inválido', async () => {
      repository.buscarPorClave.mockResolvedValue(
        registro({ valor: '{json inválido', tipo: 'JSON' }),
      );

      await expect(
        service.obtenerJson('clave', { porDefecto: true }),
      ).resolves.toEqual({ porDefecto: true });
    });

    it('usa el valor por defecto si la configuración no existe', async () => {
      repository.buscarPorClave.mockResolvedValue(null);

      await expect(service.obtenerJson('clave', [])).resolves.toEqual([]);
    });
  });

  describe('caché', () => {
    it('reutiliza el valor cacheado sin volver a consultar la base', async () => {
      repository.buscarPorClave.mockResolvedValue(
        registro({ valor: '10', tipo: 'NUMERO' }),
      );

      await service.obtenerNumero('clave', 0);
      await service.obtenerNumero('clave', 0);

      expect(repository.buscarPorClave).toHaveBeenCalledTimes(1);
    });

    it('vuelve a consultar una vez expirado el TTL', async () => {
      const ahora = jest.spyOn(Date, 'now').mockReturnValue(1_000);
      repository.buscarPorClave.mockResolvedValue(
        registro({ valor: '10', tipo: 'NUMERO' }),
      );

      await service.obtenerNumero('clave', 0);
      ahora.mockReturnValue(1_000 + TTL_CACHE_CONFIGURACION_MS + 1);
      await service.obtenerNumero('clave', 0);

      expect(repository.buscarPorClave).toHaveBeenCalledTimes(2);
      ahora.mockRestore();
    });

    it('invalidarCache fuerza una nueva consulta', async () => {
      repository.buscarPorClave.mockResolvedValue(
        registro({ valor: '10', tipo: 'NUMERO' }),
      );

      await service.obtenerNumero('clave', 0);
      service.invalidarCache('clave');
      await service.obtenerNumero('clave', 0);

      expect(repository.buscarPorClave).toHaveBeenCalledTimes(2);
    });

    it('invalidarCache sin clave limpia toda la caché', async () => {
      repository.buscarPorClave.mockResolvedValue(
        registro({ valor: '10', tipo: 'NUMERO' }),
      );

      await service.obtenerNumero('clave', 0);
      service.invalidarCache();
      await service.obtenerNumero('clave', 0);

      expect(repository.buscarPorClave).toHaveBeenCalledTimes(2);
    });
  });
});
