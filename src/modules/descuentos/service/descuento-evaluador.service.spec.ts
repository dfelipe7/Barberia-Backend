import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  EstadoProducto,
  EstadoServicio,
  WeekDay,
} from '../../../../generated/prisma/enums';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';
import { ProductoRepository } from '../../productos/repository/producto.repository';
import { ServiciosRepository } from '../../servicios/repository/servicios.repository';
import { DescuentoRepository } from '../repository/descuento.repository';
import { DescuentoEvaluadorService } from './descuento-evaluador.service';

describe('DescuentoEvaluadorService (HE-10-HU-05)', () => {
  const descuentoRepository = {
    buscarPorElemento: jest.fn(),
    obtenerZonaHorariaNegocio: jest.fn(),
  };
  const productoRepository = {
    obtenerPorId: jest.fn(),
  };
  const serviciosRepository = {
    obtenerServicioPorId: jest.fn(),
  };
  const aislamiento = {
    negocioIdRequerido: jest.fn(() => 7),
  };

  const service = new DescuentoEvaluadorService(
    descuentoRepository as unknown as DescuentoRepository,
    productoRepository as unknown as ProductoRepository,
    serviciosRepository as unknown as ServiciosRepository,
    aislamiento as unknown as NegocioAislamientoService,
  );

  const productoBase = {
    id: 10,
    nombre: 'Cera para cabello',
    precio: 35000,
    estado: EstadoProducto.ACTIVO,
    negocioId: 7,
  };

  const servicioBase = {
    id: 20,
    nombre: 'Corte clásico',
    precio: 25000,
    activo: true,
    negocioId: 7,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    aislamiento.negocioIdRequerido.mockReturnValue(7);
    descuentoRepository.obtenerZonaHorariaNegocio.mockResolvedValue(
      'America/Bogota',
    );
    productoRepository.obtenerPorId.mockResolvedValue(productoBase);
    serviciosRepository.obtenerServicioPorId.mockResolvedValue(servicioBase);
  });

  describe('Evaluación de productos', () => {
    it('HE-10-HU-05-CA-01: descuento activo en día actual aplica y calcula precio final', async () => {
      // Obtenemos el día actual en Bogotá
      const diaActual = service.obtenerDiaActualEnZona('America/Bogota');

      descuentoRepository.buscarPorElemento.mockResolvedValue({
        id: 1,
        activo: true,
        porcentaje: 10,
        diasSemana: [diaActual],
      });

      const resultado = await service.evaluarProducto(10);

      expect(resultado.aplica).toBe(true);
      expect(resultado.porcentajeAplicado).toBe(10);
      expect(resultado.precioOriginal).toBe(35000);
      expect(resultado.precioFinal).toBe(31500);
      expect(resultado.diaEvaluado).toBe(diaActual);
      expect(resultado.descuento?.activo).toBe(true);
    });

    it('HE-10-HU-05-CA-02 / CA-05: cálculo verificable con precio 100 y 10% da 90.00', async () => {
      productoRepository.obtenerPorId.mockResolvedValue({
        ...productoBase,
        precio: 100,
      });

      const diaActual = service.obtenerDiaActualEnZona('America/Bogota');
      descuentoRepository.buscarPorElemento.mockResolvedValue({
        id: 1,
        activo: true,
        porcentaje: 10,
        diasSemana: [diaActual],
      });

      const resultado = await service.evaluarProducto(10);

      expect(resultado.precioOriginal).toBe(100);
      expect(resultado.precioFinal).toBe(90);
    });

    it('HE-10-HU-05-CA-03: descuento activo pero en día no coincidente no aplica y mantiene precio original', async () => {
      // Asignamos un día que garantizadamente NO es el actual
      const diaActual = service.obtenerDiaActualEnZona('America/Bogota');
      const otroDia =
        diaActual === WeekDay.MONDAY ? WeekDay.TUESDAY : WeekDay.MONDAY;

      descuentoRepository.buscarPorElemento.mockResolvedValue({
        id: 1,
        activo: true,
        porcentaje: 15,
        diasSemana: [otroDia],
      });

      const resultado = await service.evaluarProducto(10);

      expect(resultado.aplica).toBe(false);
      expect(resultado.porcentajeAplicado).toBeNull();
      expect(resultado.precioOriginal).toBe(35000);
      expect(resultado.precioFinal).toBe(35000);
      expect(resultado.descuento?.activo).toBe(true);
    });

    it('HE-10-HU-05-CA-04: descuento inactivo no aplica y devuelve precio original sin indicador', async () => {
      const diaActual = service.obtenerDiaActualEnZona('America/Bogota');

      descuentoRepository.buscarPorElemento.mockResolvedValue({
        id: 1,
        activo: false,
        porcentaje: 20,
        diasSemana: [diaActual],
      });

      const resultado = await service.evaluarProducto(10);

      expect(resultado.aplica).toBe(false);
      expect(resultado.porcentajeAplicado).toBeNull();
      expect(resultado.precioFinal).toBe(35000);
      expect(resultado.descuento?.activo).toBe(false);
    });

    it('devuelve precio original y aplica false cuando no hay descuento configurado', async () => {
      descuentoRepository.buscarPorElemento.mockResolvedValue(null);

      const resultado = await service.evaluarProducto(10);

      expect(resultado.aplica).toBe(false);
      expect(resultado.descuento).toBeNull();
      expect(resultado.precioFinal).toBe(35000);
    });

    it('lanza NotFoundException si el producto no existe o está inactivo', async () => {
      productoRepository.obtenerPorId.mockResolvedValue(null);

      await expect(service.evaluarProducto(999)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      productoRepository.obtenerPorId.mockResolvedValue({
        ...productoBase,
        estado: EstadoProducto.INACTIVO,
      });

      await expect(service.evaluarProducto(10)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('Evaluación de servicios', () => {
    it('HE-10-HU-05-CA-08: servicio sin fecha devuelve precio base y condiciones sin precio final', async () => {
      descuentoRepository.buscarPorElemento.mockResolvedValue({
        id: 2,
        activo: true,
        porcentaje: 25,
        diasSemana: [WeekDay.FRIDAY],
      });

      const resultado = await service.evaluarServicio(20);

      expect(resultado.aplica).toBe(false);
      expect(resultado.diaEvaluado).toBeNull();
      expect(resultado.porcentajeAplicado).toBeNull();
      expect(resultado.precioOriginal).toBe(25000);
      expect(resultado.precioFinal).toBeNull();
      expect(resultado.descuento).toEqual({
        id: 2,
        activo: true,
        porcentaje: 25,
        diasSemana: [WeekDay.FRIDAY],
      });
      expect(resultado.mensaje).toContain('fecha');
    });

    it('HE-10-HU-05-CA-01 / CA-07: evalúa servicio con fecha de cita en zona horaria y aplica descuento', async () => {
      // 2026-11-13 es Viernes (FRIDAY)
      descuentoRepository.buscarPorElemento.mockResolvedValue({
        id: 2,
        activo: true,
        porcentaje: 20,
        diasSemana: [WeekDay.FRIDAY],
      });

      const resultado = await service.evaluarServicio(20, '2026-11-13');

      expect(resultado.aplica).toBe(true);
      expect(resultado.diaEvaluado).toBe(WeekDay.FRIDAY);
      expect(resultado.porcentajeAplicado).toBe(20);
      expect(resultado.precioOriginal).toBe(25000);
      expect(resultado.precioFinal).toBe(20000);
    });

    it('HE-10-HU-05-CA-03: servicio en día no coincidente mantiene precio original', async () => {
      // 2026-11-14 es Sábado (SATURDAY)
      descuentoRepository.buscarPorElemento.mockResolvedValue({
        id: 2,
        activo: true,
        porcentaje: 20,
        diasSemana: [WeekDay.FRIDAY],
      });

      const resultado = await service.evaluarServicio(20, '2026-11-14');

      expect(resultado.aplica).toBe(false);
      expect(resultado.diaEvaluado).toBe(WeekDay.SATURDAY);
      expect(resultado.porcentajeAplicado).toBeNull();
      expect(resultado.precioFinal).toBe(25000);
    });

    it('lanza BadRequestException si el formato de fecha es inválido', async () => {
      await expect(
        service.evaluarServicio(20, '13-11-2026'),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        service.evaluarServicio(20, '2026-02-31'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lanza NotFoundException si el servicio no existe o está inactivo', async () => {
      serviciosRepository.obtenerServicioPorId.mockResolvedValue(null);

      await expect(service.evaluarServicio(999)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      serviciosRepository.obtenerServicioPorId.mockResolvedValue({
        ...servicioBase,
        estado: EstadoServicio.INACTIVO,
      });

      await expect(service.evaluarServicio(20)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('Cálculo de precio final y redondeo', () => {
    it.each([
      [100, 10, 90],
      [35000, 10.25, 31412.5],
      [100, 99, 1],
      [100, 1, 99],
      [25000, 20, 20000],
      [10000, 33.33, 6667],
    ])(
      'calcula correctamente para precio %p y %p%% -> %p',
      (precio, pct, esperado) => {
        expect(service.calcularPrecioFinal(precio, pct)).toBe(esperado);
      },
    );
  });
});
