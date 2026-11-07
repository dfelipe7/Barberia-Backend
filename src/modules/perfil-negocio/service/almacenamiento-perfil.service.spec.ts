import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import * as fs from 'node:fs';
import { AlmacenamientoPerfilService } from './almacenamiento-perfil.service';
import { RECURSOS } from '../perfil-negocio.constants';

describe('AlmacenamientoPerfilService', () => {
  let service: AlmacenamientoPerfilService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AlmacenamientoPerfilService],
    }).compile();

    service = module.get<AlmacenamientoPerfilService>(
      AlmacenamientoPerfilService,
    );
    jest.clearAllMocks();
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('guardar', () => {
    it('guarda exitosamente el archivo y devuelve la ruta relativa publica', async () => {
      jest.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);
      jest.spyOn(fs.promises, 'access').mockResolvedValue(undefined);
      jest.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);
      jest.spyOn(fs.promises, 'rename').mockResolvedValue(undefined);

      const buffer = Buffer.from('test-content');
      const definicion = RECURSOS[0]; // Favicon
      const ruta = await service.guardar(1, definicion, buffer);

      expect(ruta).toMatch(
        /^\/uploads\/negocios\/1\/perfil\/favicon-\d+-[a-f0-9]+\.svg$/,
      );
      expect(fs.promises.mkdir).toHaveBeenCalled();
      expect(fs.promises.writeFile).toHaveBeenCalled();
      expect(fs.promises.rename).toHaveBeenCalled();
    });

    it('lanza InternalServerErrorException si falla la escritura', async () => {
      jest.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);
      jest.spyOn(fs.promises, 'access').mockResolvedValue(undefined);
      jest
        .spyOn(fs.promises, 'writeFile')
        .mockRejectedValue(new Error('Disk full'));

      const buffer = Buffer.from('test-content');
      await expect(service.guardar(1, RECURSOS[1], buffer)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('asegurarDirectorio', () => {
    it('lanza InternalServerErrorException si mkdir falla', async () => {
      jest
        .spyOn(fs.promises, 'mkdir')
        .mockRejectedValue(new Error('Permiso denegado'));

      await expect(
        service.asegurarDirectorio('/invalid/path', 1),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('eliminar', () => {
    it('ignora referencias nulas, vacias o que no comiencen con /uploads/', async () => {
      const unlinkSpy = jest.spyOn(fs.promises, 'unlink');

      await service.eliminar(1, null);
      await service.eliminar(1, '');
      await service.eliminar(1, 'https://external.com/logo.png');

      expect(unlinkSpy).not.toHaveBeenCalled();
    });

    it('ignora referencias que no pertenezcan al perfil del negocio dado', async () => {
      const unlinkSpy = jest.spyOn(fs.promises, 'unlink');

      // Negocio 1 intentando borrar archivo de negocio 2
      await service.eliminar(1, '/uploads/negocios/2/perfil/favicon-123.svg');
      expect(unlinkSpy).not.toHaveBeenCalled();
    });

    it('elimina archivo si pertenece al negocio y captura ENOENT silenciosamente', async () => {
      const enoent = new Error('File not found') as NodeJS.ErrnoException;
      enoent.code = 'ENOENT';
      jest.spyOn(fs.promises, 'unlink').mockRejectedValue(enoent);

      await expect(
        service.eliminar(1, '/uploads/negocios/1/perfil/favicon-123.svg'),
      ).resolves.not.toThrow();
    });

    it('elimina archivo si pertenece al negocio y captura otros errores sin lanzar excepcion', async () => {
      const eperm = new Error('EPERM') as NodeJS.ErrnoException;
      eperm.code = 'EPERM';
      jest.spyOn(fs.promises, 'unlink').mockRejectedValue(eperm);

      await expect(
        service.eliminar(1, '/uploads/negocios/1/perfil/favicon-123.svg'),
      ).resolves.not.toThrow();
    });

    it('elimina archivo con exito', async () => {
      jest.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined);

      await expect(
        service.eliminar(1, '/uploads/negocios/1/perfil/favicon-123.svg'),
      ).resolves.not.toThrow();
      expect(fs.promises.unlink).toHaveBeenCalled();
    });
  });
});
