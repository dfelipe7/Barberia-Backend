import { tieneMembresiasActivasEnOtrasSedes } from './usuario-membresias.helper';

describe('tieneMembresiasActivasEnOtrasSedes', () => {
  it('retorna false si el usuario no tiene membresías en administradores ni barberos', () => {
    expect(tieneMembresiasActivasEnOtrasSedes({}, 1)).toBe(false);
    expect(
      tieneMembresiasActivasEnOtrasSedes(
        { administradores: [], barberos: [] },
        1,
      ),
    ).toBe(false);
  });

  it('retorna false si todas las membresías pertenecen al negocio actual', () => {
    const usuario = {
      administradores: [{ negocioId: 1, estado: 'ACTIVO' }],
      barberos: [{ negocioId: 1, estado: 'ACTIVO' }],
    };
    expect(tieneMembresiasActivasEnOtrasSedes(usuario, 1)).toBe(false);
  });

  it('retorna true si tiene un rol de administrador activo en otra sede', () => {
    const usuario = {
      administradores: [
        { negocioId: 1, estado: 'INACTIVO' },
        { negocioId: 2, estado: 'ACTIVO' },
      ],
      barberos: [{ negocioId: 1, estado: 'INACTIVO' }],
    };
    expect(tieneMembresiasActivasEnOtrasSedes(usuario, 1)).toBe(true);
  });

  it('retorna false si el rol de administrador en otra sede está inactivo', () => {
    const usuario = {
      administradores: [{ negocioId: 2, estado: 'INACTIVO' }],
      barberos: [],
    };
    expect(tieneMembresiasActivasEnOtrasSedes(usuario, 1)).toBe(false);
  });

  it('retorna true si tiene un rol de barbero activo en otra sede', () => {
    const usuario = {
      administradores: [{ negocioId: 1, estado: 'INACTIVO' }],
      barberos: [
        { negocioId: 1, estado: 'INACTIVO' },
        { negocioId: 3, estado: 'ACTIVO' },
      ],
    };
    expect(tieneMembresiasActivasEnOtrasSedes(usuario, 1)).toBe(true);
  });

  it('retorna false si el rol de barbero en otra sede está inactivo', () => {
    const usuario = {
      administradores: [],
      barberos: [{ negocioId: 3, estado: 'INACTIVO' }],
    };
    expect(tieneMembresiasActivasEnOtrasSedes(usuario, 1)).toBe(false);
  });
});

