import { Test, TestingModule } from '@nestjs/testing';
import { PerfilNegocioController } from './perfil-negocio.controller';
import { PerfilNegocioService } from '../service/perfil-negocio.service';
import { RedesSocialesService } from '../service/redes-sociales.service';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/roles/roles.guard';
import { RECURSOS_PERFIL } from '../perfil-negocio.constants';

describe('PerfilNegocioController', () => {
  let controller: PerfilNegocioController;
  let service: jest.Mocked<PerfilNegocioService>;
  let redesSocialesService: jest.Mocked<RedesSocialesService>;

  beforeEach(async () => {
    const mockService = {
      obtenerPerfilPublico: jest.fn().mockResolvedValue({ configurado: true }),
      obtenerPerfilGestion: jest.fn().mockResolvedValue({ id: 1, frasePrincipal: 'Frase' }),
      actualizarPerfil: jest.fn().mockResolvedValue({ id: 1, frasePrincipal: 'Nueva Frase' }),
      actualizarReferencias: jest.fn().mockResolvedValue({ id: 1, faviconUrl: '/fav.svg' }),
      subirRecurso: jest.fn().mockResolvedValue({ id: 1 }),
      eliminarRecurso: jest.fn().mockResolvedValue({ id: 1 }),
    };

    const mockRedesSocialesService = {
      listar: jest.fn().mockResolvedValue([]),
      reemplazar: jest.fn().mockResolvedValue([]),
      actualizar: jest.fn().mockResolvedValue({ id: 1 }),
      desactivar: jest.fn().mockResolvedValue({ id: 1, activa: false }),
      eliminarFisico: jest.fn().mockResolvedValue({ id: 1 }),
      activar: jest.fn().mockResolvedValue({ id: 1, activa: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PerfilNegocioController],
      providers: [
        { provide: PerfilNegocioService, useValue: mockService },
        { provide: RedesSocialesService, useValue: mockRedesSocialesService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<PerfilNegocioController>(PerfilNegocioController);
    service = module.get(PerfilNegocioService);
    redesSocialesService = module.get(RedesSocialesService);
  });

  it('debe estar definido', () => {
    expect(controller).toBeDefined();
  });

  describe('obtenerPerfilPublico', () => {
    it('debe llamar a service.obtenerPerfilPublico', async () => {
      const res = await controller.obtenerPerfilPublico();
      expect(service.obtenerPerfilPublico).toHaveBeenCalledTimes(1);
      expect(res).toEqual({ configurado: true });
    });
  });

  describe('obtenerPerfilGestion', () => {
    it('debe llamar a service.obtenerPerfilGestion', async () => {
      const res = await controller.obtenerPerfilGestion();
      expect(service.obtenerPerfilGestion).toHaveBeenCalledTimes(1);
      expect(res).toEqual({ id: 1, frasePrincipal: 'Frase' });
    });
  });

  describe('actualizarPerfil', () => {
    it('debe llamar a service.actualizarPerfil con el DTO', async () => {
      const dto = { frasePrincipal: 'Nueva' };
      const res = await controller.actualizarPerfil(dto as any);
      expect(service.actualizarPerfil).toHaveBeenCalledWith(dto);
      expect(res).toEqual({ id: 1, frasePrincipal: 'Nueva Frase' });
    });
  });

  describe('actualizarReferencias', () => {
    it('debe llamar a service.actualizarReferencias con el DTO', async () => {
      const dto = { faviconUrl: '/fav.svg' };
      const res = await controller.actualizarReferencias(dto as any);
      expect(service.actualizarReferencias).toHaveBeenCalledWith(dto);
      expect(res).toEqual({ id: 1, faviconUrl: '/fav.svg' });
    });
  });

  describe('subida de archivos', () => {
    const dummyFile = {
      buffer: Buffer.from('<svg></svg>'),
      originalname: 'logo.svg',
      mimetype: 'image/svg+xml',
    } as Express.Multer.File;

    it('subirFavicon debe llamar a subirRecurso con FAVICON', async () => {
      await controller.subirFavicon(dummyFile);
      expect(service.subirRecurso).toHaveBeenCalledWith(RECURSOS_PERFIL.FAVICON, dummyFile);
    });

    it('subirBanner debe llamar a subirRecurso con BANNER', async () => {
      await controller.subirBanner(dummyFile);
      expect(service.subirRecurso).toHaveBeenCalledWith(RECURSOS_PERFIL.BANNER, dummyFile);
    });

    it('subirLogoBlanco debe llamar a subirRecurso con LOGO_BLANCO', async () => {
      await controller.subirLogoBlanco(dummyFile);
      expect(service.subirRecurso).toHaveBeenCalledWith(RECURSOS_PERFIL.LOGO_BLANCO, dummyFile);
    });

    it('subirLogoNegro debe llamar a subirRecurso con LOGO_NEGRO', async () => {
      await controller.subirLogoNegro(dummyFile);
      expect(service.subirRecurso).toHaveBeenCalledWith(RECURSOS_PERFIL.LOGO_NEGRO, dummyFile);
    });
  });

  describe('eliminación de archivos', () => {
    it('eliminarFavicon debe llamar a eliminarRecurso con FAVICON', async () => {
      await controller.eliminarFavicon();
      expect(service.eliminarRecurso).toHaveBeenCalledWith(RECURSOS_PERFIL.FAVICON);
    });

    it('eliminarBanner debe llamar a eliminarRecurso con BANNER', async () => {
      await controller.eliminarBanner();
      expect(service.eliminarRecurso).toHaveBeenCalledWith(RECURSOS_PERFIL.BANNER);
    });

    it('eliminarLogoBlanco debe llamar a eliminarRecurso con LOGO_BLANCO', async () => {
      await controller.eliminarLogoBlanco();
      expect(service.eliminarRecurso).toHaveBeenCalledWith(RECURSOS_PERFIL.LOGO_BLANCO);
    });

    it('eliminarLogoNegro debe llamar a eliminarRecurso con LOGO_NEGRO', async () => {
      await controller.eliminarLogoNegro();
      expect(service.eliminarRecurso).toHaveBeenCalledWith(RECURSOS_PERFIL.LOGO_NEGRO);
    });
  });

  describe('redes sociales', () => {
    it('listarRedesSociales por defecto no incluye inactivas', async () => {
      await controller.listarRedesSociales();
      expect(redesSocialesService.listar).toHaveBeenCalledWith(false);
    });

    it('listarRedesSociales con todas=true o incluirInactivas=1 incluye inactivas', async () => {
      await controller.listarRedesSociales('true', undefined);
      expect(redesSocialesService.listar).toHaveBeenCalledWith(true);

      await controller.listarRedesSociales(undefined, '1');
      expect(redesSocialesService.listar).toHaveBeenCalledWith(true);
    });

    it('reemplazarRedesSociales maneja array plano o wrapper object', async () => {
      const red1 = { tipo: 'INSTAGRAM' as const, url: 'https://instagram.com/demo' };
      await controller.reemplazarRedesSociales([red1]);
      expect(redesSocialesService.reemplazar).toHaveBeenCalledWith([red1]);

      await controller.reemplazarRedesSociales({ redes: [red1] });
      expect(redesSocialesService.reemplazar).toHaveBeenCalledWith([red1]);

      await controller.reemplazarRedesSociales({} as any);
      expect(redesSocialesService.reemplazar).toHaveBeenCalledWith([]);
    });

    it('actualizarRedSocial delega al servicio', async () => {
      const dto = { url: 'https://instagram.com/nuevo' };
      await controller.actualizarRedSocial(5, dto as any);
      expect(redesSocialesService.actualizar).toHaveBeenCalledWith(5, dto);
    });

    it('desactivarRedSocial realiza soft-delete si no es definitivo', async () => {
      await controller.desactivarRedSocial(5);
      expect(redesSocialesService.desactivar).toHaveBeenCalledWith(5);
      expect(redesSocialesService.eliminarFisico).not.toHaveBeenCalled();
    });

    it('desactivarRedSocial realiza borrado fisico si definitivo=true o fisico=1', async () => {
      await controller.desactivarRedSocial(5, 'true');
      expect(redesSocialesService.eliminarFisico).toHaveBeenCalledWith(5);

      await controller.desactivarRedSocial(6, undefined, '1');
      expect(redesSocialesService.eliminarFisico).toHaveBeenCalledWith(6);
    });

    it('activarRedSocial delega al servicio', async () => {
      await controller.activarRedSocial(5);
      expect(redesSocialesService.activar).toHaveBeenCalledWith(5);
    });
  });
});
