import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ConfiguracionService } from './configuracion.service';
import {
  ConfiguracionRepository,
  ConfiguracionRegistro,
} from '../repository/configuracion.repository';
import {
  CLAVES_CONFIGURACION,
  LIMITES_MINUTOS_OPERATIVOS,
  TTL_CACHE_CONFIGURACION_MS,
} from '../configuracion.constants';
import { NegocioContextoService } from '../../negocios/negocio-contexto.service';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';
import { NegociosRepository } from '../../negocios/repository/negocios.repository';

const CLAVE = CLAVES_CONFIGURACION.RESERVA_CANCELACION_ANTELACION_MINUTOS;

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
    buscarPorClaveEnNegocio: jest.fn(),
    listar: jest.fn(),
    inicializarValoresOperativos: jest.fn(),
    guardarEnNegocio: jest.fn(),
  };

  const contextoService = {
    obtenerContexto: jest.fn(),
  };

  const aislamientoService = {
    ejecutarEnNegocio: jest.fn(),
  };

  const negociosRepository = {
    buscarPorId: jest.fn(),
    listar: jest.fn(),
  };

  /** Fija el contexto de negocio de la petición en curso. */
  const enNegocio = (id: number, slug = 'negocio-a') => {
    contextoService.obtenerContexto.mockReturnValue({ id, slug });
  };

  /** Valor por negocio: 30 en el negocio 1, 60 en el resto. */
  const valorPorNegocio = (negocioId: number) =>
    Promise.resolve(
      registro({
        valor: negocioId === 1 ? '30' : '60',
        tipo: 'NUMERO',
      }),
    );

  beforeEach(() => {
    jest.clearAllMocks();
    enNegocio(1);
    aislamientoService.ejecutarEnNegocio.mockImplementation(
      (_negocio: unknown, operacion: () => unknown) => operacion(),
    );
    negociosRepository.buscarPorId.mockResolvedValue({
      id: 1,
      slug: 'negocio-a',
      nombre: 'Negocio A',
    });

    service = new ConfiguracionService(
      repository as unknown as ConfiguracionRepository,
      contextoService as unknown as NegocioContextoService,
      aislamientoService as unknown as NegocioAislamientoService,
      negociosRepository as unknown as NegociosRepository,
    );
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('resolución del valor efectivo (ámbito de negocio)', () => {
    it('lee la configuración del negocio activo por (negocioId, clave)', async () => {
      repository.buscarPorClaveEnNegocio.mockResolvedValue(
        registro({ valor: '45', tipo: 'NUMERO' }),
      );

      await expect(service.obtenerNumero(CLAVE, 120)).resolves.toBe(45);
      expect(repository.buscarPorClaveEnNegocio).toHaveBeenCalledWith(1, CLAVE);
    });

    it('usa el valor por defecto si el negocio no tiene la clave y no hay global', async () => {
      repository.buscarPorClaveEnNegocio.mockResolvedValue(null);
      repository.buscarPorClave.mockResolvedValue(null);

      await expect(service.obtenerNumero(CLAVE, 120)).resolves.toBe(120);
    });

    it('recurre al valor global permitido cuando el negocio no tiene la clave', async () => {
      repository.buscarPorClaveEnNegocio.mockResolvedValue(null);
      repository.buscarPorClave.mockResolvedValue(
        registro({ valor: '90', tipo: 'NUMERO' }),
      );

      await expect(service.obtenerNumero(CLAVE, 120)).resolves.toBe(90);
    });

    it('no recurre al valor global si la clave no está en la política de compatibilidad', async () => {
      repository.buscarPorClaveEnNegocio.mockResolvedValue(null);
      repository.buscarPorClave.mockResolvedValue(
        registro({ valor: '90', tipo: 'NUMERO' }),
      );

      await expect(
        service.obtenerNumero('clave_plataforma', 120),
      ).resolves.toBe(120);
      expect(repository.buscarPorClave).not.toHaveBeenCalled();
    });

    it('obtenerTextoDelNegocio NUNCA recurre al ámbito global', async () => {
      repository.buscarPorClaveEnNegocio.mockResolvedValue(null);
      repository.buscarPorClave.mockResolvedValue(
        registro({ valor: 'Valor Global', tipo: 'TEXTO' }),
      );

      await expect(
        service.obtenerTextoDelNegocio('clave_plataforma', ''),
      ).resolves.toBe('');
      expect(repository.buscarPorClave).not.toHaveBeenCalled();
    });

    it('obtenerTextoDelNegocio lee el valor del negocio activo', async () => {
      repository.buscarPorClaveEnNegocio.mockResolvedValue(
        registro({ valor: 'Valor Del Negocio', tipo: 'TEXTO' }),
      );

      await expect(
        service.obtenerTextoDelNegocio('clave_plataforma', ''),
      ).resolves.toBe('Valor Del Negocio');
      expect(repository.buscarPorClaveEnNegocio).toHaveBeenCalledWith(
        1,
        'clave_plataforma',
      );
      expect(repository.buscarPorClave).not.toHaveBeenCalled();
    });

    it('descarta un valor del negocio con tipo incorrecto y sigue con el global', async () => {
      repository.buscarPorClaveEnNegocio.mockResolvedValue(
        registro({ valor: '45', tipo: 'TEXTO' }),
      );
      repository.buscarPorClave.mockResolvedValue(
        registro({ valor: '90', tipo: 'NUMERO' }),
      );

      await expect(service.obtenerNumero(CLAVE, 120)).resolves.toBe(90);
    });

    it('descarta un valor no numérico y aplica el valor por defecto', async () => {
      repository.buscarPorClaveEnNegocio.mockResolvedValue(
        registro({ valor: 'no-numero', tipo: 'NUMERO' }),
      );
      repository.buscarPorClave.mockResolvedValue(null);

      await expect(service.obtenerNumero(CLAVE, 120)).resolves.toBe(120);
    });
  });

  describe('límites del valor numérico', () => {
    it('rechaza un valor por debajo del mínimo y aplica el valor por defecto', async () => {
      repository.buscarPorClaveEnNegocio.mockResolvedValue(
        registro({ valor: '0', tipo: 'NUMERO' }),
      );
      repository.buscarPorClave.mockResolvedValue(null);

      await expect(
        service.obtenerNumero(CLAVE, 120, LIMITES_MINUTOS_OPERATIVOS),
      ).resolves.toBe(120);
    });

    it('rechaza un valor por encima del máximo y aplica el valor por defecto', async () => {
      repository.buscarPorClaveEnNegocio.mockResolvedValue(
        registro({ valor: '999999', tipo: 'NUMERO' }),
      );
      repository.buscarPorClave.mockResolvedValue(null);

      await expect(
        service.obtenerNumero(CLAVE, 120, LIMITES_MINUTOS_OPERATIVOS),
      ).resolves.toBe(120);
    });

    it('trunca a minutos enteros un valor decimal dentro de los límites', async () => {
      repository.buscarPorClaveEnNegocio.mockResolvedValue(
        registro({ valor: '45.5', tipo: 'NUMERO' }),
      );

      await expect(
        service.obtenerNumero(CLAVE, 120, LIMITES_MINUTOS_OPERATIVOS),
      ).resolves.toBe(45);
    });

    it('acepta el cero como valor numérico válido si no se exige un mínimo', async () => {
      repository.buscarPorClaveEnNegocio.mockResolvedValue(
        registro({ valor: '0', tipo: 'NUMERO' }),
      );

      await expect(service.obtenerNumero('clave', 120)).resolves.toBe(0);
    });
  });

  describe('escritura de configuración (protección del tipo)', () => {
    const CLAVE_NUMERO = CLAVES_CONFIGURACION.RECORDATORIO_MINUTOS_ANTICIPACION;
    const CLAVE_TEXTO = CLAVES_CONFIGURACION.NEGOCIO_DIRECCION;

    it('guardarNumero escribe con el tipo NUMERO', async () => {
      repository.guardarEnNegocio.mockResolvedValue(undefined);

      await service.guardarNumero(1, CLAVE_NUMERO, 45);

      expect(repository.guardarEnNegocio).toHaveBeenCalledWith(
        1,
        CLAVE_NUMERO,
        '45',
        'NUMERO',
        {},
      );
    });

    it('guardarTexto escribe con el tipo TEXTO', async () => {
      repository.guardarEnNegocio.mockResolvedValue(undefined);

      await service.guardarTexto(1, CLAVE_TEXTO, 'Carrera 6 # 3-45');

      expect(repository.guardarEnNegocio).toHaveBeenCalledWith(
        1,
        CLAVE_TEXTO,
        'Carrera 6 # 3-45',
        'TEXTO',
        {},
      );
    });

    it('un conflicto de tipo se propaga y NO invalida la caché', async () => {
      repository.guardarEnNegocio.mockRejectedValue(
        new ConflictException('La configuración ya existe con otro tipo.'),
      );
      const spy = jest.spyOn(service, 'invalidarCacheNegocio');

      await expect(
        service.guardarNumero(1, CLAVE_NUMERO, 45),
      ).rejects.toBeInstanceOf(ConflictException);

      // La escritura falló: el valor almacenado sigue siendo el anterior.
      expect(spy).not.toHaveBeenCalled();
    });

    it('la reparación explícita del tipo se envía al repositorio', async () => {
      repository.guardarEnNegocio.mockResolvedValue(undefined);

      await service.guardarNumero(1, CLAVE_NUMERO, 45, { corregirTipo: true });

      expect(repository.guardarEnNegocio).toHaveBeenCalledWith(
        1,
        CLAVE_NUMERO,
        '45',
        'NUMERO',
        { corregirTipo: true },
      );
    });
  });

  describe('caché segmentada por negocio', () => {
    it('dos negocios pueden tener valores distintos de la misma clave', async () => {
      repository.buscarPorClaveEnNegocio.mockImplementation(valorPorNegocio);

      enNegocio(1, 'negocio-a');
      await expect(service.obtenerNumero(CLAVE, 120)).resolves.toBe(30);

      enNegocio(2, 'negocio-b');
      await expect(service.obtenerNumero(CLAVE, 120)).resolves.toBe(60);
    });

    it('la caché de A no devuelve el valor de B', async () => {
      repository.buscarPorClaveEnNegocio.mockImplementation(valorPorNegocio);

      enNegocio(1, 'negocio-a');
      await service.obtenerNumero(CLAVE, 120);

      enNegocio(2, 'negocio-b');
      await expect(service.obtenerNumero(CLAVE, 120)).resolves.toBe(60);
    });

    it('invalidar la configuración de A no altera la de B', async () => {
      repository.buscarPorClaveEnNegocio.mockImplementation(valorPorNegocio);

      enNegocio(1, 'negocio-a');
      await service.obtenerNumero(CLAVE, 120);
      enNegocio(2, 'negocio-b');
      await service.obtenerNumero(CLAVE, 120);

      enNegocio(1, 'negocio-a');
      service.invalidarCache(CLAVE);
      await service.obtenerNumero(CLAVE, 120);

      // B conserva su valor (no se ha consultado de nuevo a la base).
      enNegocio(2, 'negocio-b');
      await expect(service.obtenerNumero(CLAVE, 120)).resolves.toBe(60);
      expect(repository.buscarPorClaveEnNegocio).toHaveBeenCalledTimes(3);
    });

    it('invalidarCacheNegocio solo afecta al negocio indicado', async () => {
      repository.buscarPorClaveEnNegocio.mockImplementation(valorPorNegocio);

      enNegocio(1, 'negocio-a');
      await service.obtenerNumero(CLAVE, 120);
      enNegocio(2, 'negocio-b');
      await service.obtenerNumero(CLAVE, 120);

      service.invalidarCacheNegocio(1, CLAVE);

      enNegocio(1, 'negocio-a');
      await service.obtenerNumero(CLAVE, 120);
      enNegocio(2, 'negocio-b');
      await service.obtenerNumero(CLAVE, 120);

      expect(repository.buscarPorClaveEnNegocio).toHaveBeenCalledTimes(3);
    });

    it('la caché global no se confunde con la caché de negocio', async () => {
      repository.buscarPorClaveEnNegocio.mockResolvedValue(null);
      repository.buscarPorClave.mockResolvedValue(
        registro({ valor: '90', tipo: 'NUMERO' }),
      );

      // El valor global se cachea en su propia clave.
      await expect(service.obtenerNumero(CLAVE, 120)).resolves.toBe(90);

      // El negocio define su propio valor: al invalidar SU entrada, se lee el
      // suyo y no el valor global cacheado.
      repository.buscarPorClaveEnNegocio.mockResolvedValue(
        registro({ valor: '30', tipo: 'NUMERO' }),
      );
      service.invalidarCacheNegocio(1, CLAVE);

      await expect(service.obtenerNumero(CLAVE, 120)).resolves.toBe(30);
    });

    it('el fallback global NO se cachea como configuración del negocio', async () => {
      repository.buscarPorClaveEnNegocio.mockResolvedValue(null);
      repository.buscarPorClave.mockResolvedValue(
        registro({ valor: '90', tipo: 'NUMERO' }),
      );

      await service.obtenerNumero(CLAVE, 120);

      // La segunda lectura del negocio no vuelve a consultar la base: la
      // ausencia se cachea en el ámbito del negocio, y el global en el suyo.
      await service.obtenerNumero(CLAVE, 120);

      expect(repository.buscarPorClaveEnNegocio).toHaveBeenCalledTimes(1);
      expect(repository.buscarPorClave).toHaveBeenCalledTimes(1);
    });

    it('reutiliza el valor cacheado sin volver a consultar la base', async () => {
      repository.buscarPorClaveEnNegocio.mockResolvedValue(
        registro({ valor: '10', tipo: 'NUMERO' }),
      );

      await service.obtenerNumero(CLAVE, 0);
      await service.obtenerNumero(CLAVE, 0);

      expect(repository.buscarPorClaveEnNegocio).toHaveBeenCalledTimes(1);
    });

    it('vuelve a consultar una vez expirado el TTL', async () => {
      const ahora = jest.spyOn(Date, 'now').mockReturnValue(1_000);
      repository.buscarPorClaveEnNegocio.mockResolvedValue(
        registro({ valor: '10', tipo: 'NUMERO' }),
      );

      await service.obtenerNumero(CLAVE, 0);
      ahora.mockReturnValue(1_000 + TTL_CACHE_CONFIGURACION_MS + 1);
      await service.obtenerNumero(CLAVE, 0);

      expect(repository.buscarPorClaveEnNegocio).toHaveBeenCalledTimes(2);
      ahora.mockRestore();
    });

    it('invalidarCache sin clave limpia toda la caché', async () => {
      repository.buscarPorClaveEnNegocio.mockResolvedValue(
        registro({ valor: '10', tipo: 'NUMERO' }),
      );

      await service.obtenerNumero(CLAVE, 0);
      service.invalidarCache();
      await service.obtenerNumero(CLAVE, 0);

      expect(repository.buscarPorClaveEnNegocio).toHaveBeenCalledTimes(2);
    });
  });

  describe('ámbito global de plataforma', () => {
    it('lee el parámetro global sin necesitar contexto de negocio', async () => {
      contextoService.obtenerContexto.mockReturnValue(undefined);
      repository.buscarPorClave.mockResolvedValue(
        registro({ valor: 'UTC', tipo: 'TEXTO' }),
      );

      await expect(
        service.obtenerTextoGlobal('zona_horaria', 'America/Bogota'),
      ).resolves.toBe('UTC');
      expect(repository.buscarPorClave).toHaveBeenCalledWith('zona_horaria');
    });

    it('usa el valor por defecto si el parámetro global no existe', async () => {
      repository.buscarPorClave.mockResolvedValue(null);

      await expect(
        service.obtenerTextoGlobal('zona_horaria', 'America/Bogota'),
      ).resolves.toBe('America/Bogota');
    });
  });

  describe('control de contexto', () => {
    it('una lectura operativa sin contexto válido falla de forma controlada', async () => {
      contextoService.obtenerContexto.mockReturnValue(undefined);

      await expect(service.obtenerNumero(CLAVE, 120)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(repository.buscarPorClaveEnNegocio).not.toHaveBeenCalled();
    });

    it('no lee los valores de otra barbería cuando no hay contexto', async () => {
      contextoService.obtenerContexto.mockReturnValue(undefined);

      await expect(service.obtenerNumero(CLAVE, 120)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(repository.buscarPorClave).not.toHaveBeenCalled();
    });
  });

  describe('otros tipos', () => {
    it('devuelve el valor textual del negocio', async () => {
      repository.buscarPorClaveEnNegocio.mockResolvedValue(
        registro({ valor: 'America/Bogota', tipo: 'TEXTO' }),
      );

      await expect(service.obtenerTexto('clave', 'UTC')).resolves.toBe(
        'America/Bogota',
      );
    });

    it('convierte el booleano del negocio', async () => {
      repository.buscarPorClaveEnNegocio.mockResolvedValue(
        registro({ valor: 'true', tipo: 'BOOLEANO' }),
      );

      await expect(service.obtenerBooleano('clave', false)).resolves.toBe(true);
    });

    it('parsea el JSON del negocio', async () => {
      repository.buscarPorClaveEnNegocio.mockResolvedValue(
        registro({ valor: '{"a":1}', tipo: 'JSON' }),
      );

      await expect(service.obtenerJson('clave', null)).resolves.toEqual({
        a: 1,
      });
    });
  });

  describe('inicialización de la configuración operativa', () => {
    it('crea las claves que faltan y conserva las existentes', async () => {
      repository.inicializarValoresOperativos.mockResolvedValue({
        creadas: [CLAVE],
        conservadas: [],
      });

      const resultado = await service.inicializarValoresOperativos(1);

      expect(resultado.creadas).toEqual([CLAVE]);
      expect(repository.inicializarValoresOperativos).toHaveBeenCalledWith(1);
    });

    it('se ejecuta dentro del contexto del negocio inicializado', async () => {
      negociosRepository.buscarPorId.mockResolvedValue({
        id: 7,
        slug: 'negocio-g',
        nombre: 'Negocio G',
      });
      repository.inicializarValoresOperativos.mockResolvedValue({
        creadas: [],
        conservadas: [CLAVE],
      });

      await service.inicializarValoresOperativos(7);

      expect(aislamientoService.ejecutarEnNegocio).toHaveBeenCalledWith(
        { id: 7, slug: 'negocio-g', nombre: 'Negocio G' },
        expect.any(Function),
      );
    });

    it('falla si el negocio no existe', async () => {
      negociosRepository.buscarPorId.mockResolvedValue(null);

      await expect(service.inicializarValoresOperativos(99)).rejects.toThrow(
        'El negocio no existe',
      );
    });
  });
});
