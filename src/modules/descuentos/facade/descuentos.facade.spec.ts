import { TipoDescuento, WeekDay } from '../../../../generated/prisma/enums';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';
import {
  MENSAJE_DESCUENTOS_LISTADOS,
  MENSAJE_SIN_DESCUENTOS,
} from '../descuentos.constants';
import { DescuentoEvaluadorService } from '../service/descuento-evaluador.service';
import { DescuentoService } from '../service/descuento.service';
import { DescuentosFacade } from './descuentos.facade';

describe('DescuentosFacade', () => {
  const descuentoService = {
    crear: jest.fn(),
    obtenerPorId: jest.fn(),
    actualizar: jest.fn(),
    cambiarEstado: jest.fn(),
    listar: jest.fn(),
  };
  const descuentoEvaluadorService = {
    evaluarProducto: jest.fn(),
    evaluarServicio: jest.fn(),
  };
  const aislamiento = { negocioIdRequerido: jest.fn() };
  const facade = new DescuentosFacade(
    descuentoService as unknown as DescuentoService,
    descuentoEvaluadorService as unknown as DescuentoEvaluadorService,
    aislamiento as unknown as NegocioAislamientoService,
  );

  const dto = {
    tipo: TipoDescuento.PRODUCTO,
    elementoId: 10,
    porcentaje: 10.25,
    diasSemana: [WeekDay.MONDAY],
  };
  const descuento = { id: 1, activo: false };

  beforeEach(() => {
    jest.clearAllMocks();
    aislamiento.negocioIdRequerido.mockReturnValue(7);
    descuentoService.crear.mockResolvedValue(descuento);
    descuentoService.obtenerPorId.mockResolvedValue(descuento);
    descuentoService.actualizar.mockResolvedValue(descuento);
    descuentoService.listar.mockResolvedValue([descuento]);
  });

  describe('HE-10-HU-05 — evaluación de descuentos aplicables', () => {
    it('exige contexto de negocio y delega evaluación de producto', async () => {
      const respuesta = {
        tipo: TipoDescuento.PRODUCTO,
        elementoId: 10,
        nombreElemento: 'Cera',
        aplica: true,
        diaEvaluado: WeekDay.MONDAY,
        zonaHoraria: 'America/Bogota',
        porcentajeAplicado: 10,
        precioOriginal: 100,
        precioFinal: 90,
        descuento: null,
        mensaje: 'Descuento aplicable para el día evaluado',
      };
      descuentoEvaluadorService.evaluarProducto.mockResolvedValue(respuesta);

      const res = await facade.evaluarDescuentoProducto(10);

      expect(aislamiento.negocioIdRequerido).toHaveBeenCalled();
      expect(descuentoEvaluadorService.evaluarProducto).toHaveBeenCalledWith(
        10,
      );
      expect(res).toBe(respuesta);
    });

    it('exige contexto de negocio y delega evaluación de servicio', async () => {
      const respuesta = {
        tipo: TipoDescuento.SERVICIO,
        elementoId: 20,
        nombreElemento: 'Corte',
        aplica: true,
        diaEvaluado: WeekDay.FRIDAY,
        zonaHoraria: 'America/Bogota',
        porcentajeAplicado: 20,
        precioOriginal: 25000,
        precioFinal: 20000,
        descuento: null,
        mensaje: 'Descuento aplicable para el día evaluado',
      };
      descuentoEvaluadorService.evaluarServicio.mockResolvedValue(respuesta);

      const res = await facade.evaluarDescuentoServicio(20, '2026-11-13');

      expect(aislamiento.negocioIdRequerido).toHaveBeenCalled();
      expect(descuentoEvaluadorService.evaluarServicio).toHaveBeenCalledWith(
        20,
        '2026-11-13',
      );
      expect(res).toBe(respuesta);
    });
  });

  describe('HE-10-HU-01 — listar', () => {
    it('CA-01: exige contexto de negocio y devuelve lista de descuentos con mensaje y total', async () => {
      const resultado = await facade.listar();

      expect(aislamiento.negocioIdRequerido).toHaveBeenCalled();
      expect(descuentoService.listar).toHaveBeenCalled();
      expect(resultado).toEqual({
        mensaje: MENSAJE_DESCUENTOS_LISTADOS,
        descuentos: [descuento],
        total: 1,
      });
    });

    it('CA-03: devuelve mensaje descriptivo y total 0 cuando la lista está vacía', async () => {
      descuentoService.listar.mockResolvedValue([]);

      const resultado = await facade.listar();

      expect(aislamiento.negocioIdRequerido).toHaveBeenCalled();
      expect(descuentoService.listar).toHaveBeenCalled();
      expect(resultado).toEqual({
        mensaje: MENSAJE_SIN_DESCUENTOS,
        descuentos: [],
        total: 0,
      });
    });
  });

  it('exige contexto de negocio y delega la creación en el servicio', async () => {
    await expect(facade.crear(dto)).resolves.toEqual({
      mensaje: 'Descuento creado correctamente',
      descuento,
    });

    expect(aislamiento.negocioIdRequerido).toHaveBeenCalled();
    expect(descuentoService.crear).toHaveBeenCalledWith(dto);
  });

  it('HE-10-HU-03-CA-01: exige contexto de negocio y delega la consulta por id', async () => {
    await expect(facade.obtenerPorId(1)).resolves.toEqual(descuento);

    expect(aislamiento.negocioIdRequerido).toHaveBeenCalled();
    expect(descuentoService.obtenerPorId).toHaveBeenCalledWith(1);
  });

  it('HE-10-HU-03-CA-02: exige contexto de negocio y delega la actualización', async () => {
    const cambios = { porcentaje: 20 };
    await expect(facade.actualizar(1, cambios)).resolves.toEqual({
      mensaje: 'Descuento actualizado correctamente',
      descuento,
    });

    expect(aislamiento.negocioIdRequerido).toHaveBeenCalled();
    expect(descuentoService.actualizar).toHaveBeenCalledWith(1, cambios);
  });

  it('propaga el error del servicio sin ocultarlo', async () => {
    const error = new Error('conflicto');
    descuentoService.crear.mockRejectedValue(error);

    await expect(facade.crear(dto)).rejects.toBe(error);
  });

  it('HE-10-HU-04-CA-03: exige contexto de negocio y responde confirmación al activar', async () => {
    const descuentoActivo = { id: 1, activo: true };
    descuentoService.cambiarEstado.mockResolvedValue(descuentoActivo);

    await expect(facade.cambiarEstado(1, { activo: true })).resolves.toEqual({
      mensaje: 'Descuento activado correctamente',
      descuento: descuentoActivo,
    });

    expect(aislamiento.negocioIdRequerido).toHaveBeenCalled();
    expect(descuentoService.cambiarEstado).toHaveBeenCalledWith(1, true);
  });

  it('HE-10-HU-04-CA-03: exige contexto de negocio y responde confirmación al desactivar', async () => {
    const descuentoInactivo = { id: 1, activo: false };
    descuentoService.cambiarEstado.mockResolvedValue(descuentoInactivo);

    await expect(facade.cambiarEstado(1, { activo: false })).resolves.toEqual({
      mensaje: 'Descuento desactivado correctamente',
      descuento: descuentoInactivo,
    });

    expect(aislamiento.negocioIdRequerido).toHaveBeenCalled();
    expect(descuentoService.cambiarEstado).toHaveBeenCalledWith(1, false);
  });
});
