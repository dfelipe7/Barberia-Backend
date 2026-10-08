import { Test, TestingModule } from '@nestjs/testing';
import { ServiciosController } from './servicios.controller';
import { ServiciosService } from '../service/servicios.service';
import { KeycloakAuthGuard } from '../../../auth/keycloak-auth/keycloak-auth.guard';
import { RolesGuard } from '../../../auth/roles/roles.guard';

jest.mock('../../../../generated/prisma/enums', () => ({
    EstadoServicio: { ACTIVO: 'ACTIVO', INACTIVO: 'INACTIVO' },
    EstadoUsuario: { ACTIVO: 'ACTIVO', INACTIVO: 'INACTIVO' },
    RolUsuario: { SUPERADMIN: 'SUPERADMIN', ADMINISTRADOR: 'ADMINISTRADOR', BARBERO: 'BARBERO' }
}));

import { EstadoServicio } from '../../../../generated/prisma/enums';
import { BadRequestException } from '@nestjs/common';

describe('ServiciosController', () => {
    let controller: ServiciosController;
    let serviciosServiceMock: any;

    beforeEach(async () => {
        serviciosServiceMock = {
            crearServicio: jest.fn().mockResolvedValue({ id: 1, nombre: 'Corte' }),
            obtenerServiciosGestion: jest.fn().mockResolvedValue([]),
            obtenerServiciosPorBarbero: jest.fn().mockResolvedValue([]),
            obtenerServiciosCatalogo: jest.fn().mockResolvedValue([]),
            obtenerServicioPorId: jest.fn().mockResolvedValue({ id: 1 }),
            cambiarEstadoServicio: jest.fn().mockResolvedValue({ id: 1, estado: EstadoServicio.INACTIVO }),
            actualizarServicio: jest.fn().mockResolvedValue({ id: 1, nombre: 'Corte Premium' }),
            subirFotoServicio: jest.fn().mockResolvedValue({ id: 1, fotoUrl: 'foto.jpg' }),
            eliminarFotoServicio: jest.fn().mockResolvedValue({ id: 1, fotoUrl: null }),
        };

        const module: TestingModule = await Test.createTestingModule({
            controllers: [ServiciosController],
            providers: [
                { provide: ServiciosService, useValue: serviciosServiceMock },
            ],
        })
        .overrideGuard(KeycloakAuthGuard).useValue({ canActivate: () => true })
        .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
        .compile();

        controller = module.get<ServiciosController>(ServiciosController);
    });

    it('debe estar definido', () => {
        expect(controller).toBeDefined();
    });

    it('debe crearServicio', async () => {
        const dto = { nombre: 'Corte', precio: 20, duracionMinutos: 30 };
        const res = await controller.crearServicio(dto);
        expect(serviciosServiceMock.crearServicio).toHaveBeenCalledWith(dto);
        expect(res).toEqual({ id: 1, nombre: 'Corte' });
    });

    it('debe obtenerServiciosGestion', async () => {
        const res = await controller.obtenerServiciosGestion({});
        expect(serviciosServiceMock.obtenerServiciosGestion).toHaveBeenCalledWith({});
        expect(res).toEqual([]);
    });

    it('debe obtenerServiciosPorBarbero', async () => {
        const res = await controller.obtenerServiciosPorBarbero('1');
        expect(serviciosServiceMock.obtenerServiciosPorBarbero).toHaveBeenCalledWith(1);
        expect(res).toEqual([]);
    });

    it('debe obtenerServiciosCatalogo', async () => {
        const res = await controller.obtenerServiciosCatalogo({});
        expect(serviciosServiceMock.obtenerServiciosCatalogo).toHaveBeenCalledWith({});
        expect(res).toEqual([]);
    });

    it('debe obtenerServicioPorId', async () => {
        const res = await controller.obtenerServicioPorId('1');
        expect(serviciosServiceMock.obtenerServicioPorId).toHaveBeenCalledWith(1);
        expect(res).toEqual({ id: 1 });
    });

    it('debe cambiarEstadoServicio', async () => {
        const dto = { estado: EstadoServicio.INACTIVO };
        const res = await controller.cambiarEstadoServicio('1', dto);
        expect(serviciosServiceMock.cambiarEstadoServicio).toHaveBeenCalledWith(1, dto);
        expect(res).toEqual({ id: 1, estado: EstadoServicio.INACTIVO });
    });

    it('debe actualizarServicio', async () => {
        const dto = { nombre: 'Corte Premium' };
        const res = await controller.actualizarServicio('1', dto);
        expect(serviciosServiceMock.actualizarServicio).toHaveBeenCalledWith(1, dto);
        expect(res).toEqual({ id: 1, nombre: 'Corte Premium' });
    });

    it('debe lanzar BadRequestException al subirFotoServicio sin archivo', async () => {
        await expect(controller.subirFotoServicio('1', undefined as any)).rejects.toThrow(BadRequestException);
    });

    it('debe subirFotoServicio', async () => {
        const mockFile = { fieldname: 'foto' } as any;
        const res = await controller.subirFotoServicio('1', mockFile);
        expect(serviciosServiceMock.subirFotoServicio).toHaveBeenCalledWith(1, mockFile);
        expect(res).toEqual({ id: 1, fotoUrl: 'foto.jpg' });
    });

    it('debe eliminarFotoServicio', async () => {
        const res = await controller.eliminarFotoServicio('1');
        expect(serviciosServiceMock.eliminarFotoServicio).toHaveBeenCalledWith(1);
        expect(res).toEqual({ id: 1, fotoUrl: null });
    });
});
