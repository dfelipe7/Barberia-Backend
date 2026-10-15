import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/roles/roles.guard';
import { ROLES_KEY } from '../../../auth/roles/roles.decorator';
import { HorarioSemanalController } from './horario-semanal.controller';
import { BloqueosHorarioController } from './bloqueos-horario.controller';
import { DisponibilidadController } from './disponibilidad.controller';
import { DisponibilidadBarberoController } from './disponibilidad-barbero.controller';

const ROLES_ESPERADOS = ['SUPERADMIN', 'ADMINISTRADOR', 'BARBERO'];

interface EndpointHe08 {
  nombre: string;
  prototipo: object;
  metodo: string;
}

const leerMetadatos = (endpoint: EndpointHe08) => {
  const handler = (endpoint.prototipo as Record<string, unknown>)[
    endpoint.metodo
  ];
  return {
    roles: Reflect.getMetadata(ROLES_KEY, handler as object) as
      string[] | undefined,
    guardias: (Reflect.getMetadata(GUARDS_METADATA, handler as object) ??
      []) as unknown[],
  };
};

describe('HE-08 RBAC (metadatos de guardias y roles)', () => {
  const endpointsPrivados: EndpointHe08[] = [
    {
      nombre: 'HorarioSemanal.obtenerMiHorarioSemanal',
      prototipo: HorarioSemanalController.prototype,
      metodo: 'obtenerMiHorarioSemanal',
    },
    {
      nombre: 'HorarioSemanal.reemplazarMiHorarioSemanal',
      prototipo: HorarioSemanalController.prototype,
      metodo: 'reemplazarMiHorarioSemanal',
    },
    {
      nombre: 'Bloqueos.crearBloqueo',
      prototipo: BloqueosHorarioController.prototype,
      metodo: 'crearBloqueo',
    },
    {
      nombre: 'Bloqueos.listarBloqueos',
      prototipo: BloqueosHorarioController.prototype,
      metodo: 'listarBloqueos',
    },
    {
      nombre: 'Bloqueos.actualizarBloqueo',
      prototipo: BloqueosHorarioController.prototype,
      metodo: 'actualizarBloqueo',
    },
    {
      nombre: 'Bloqueos.cancelarBloqueo',
      prototipo: BloqueosHorarioController.prototype,
      metodo: 'cancelarBloqueo',
    },
    {
      nombre: 'Bloqueos.reactivarBloqueo',
      prototipo: BloqueosHorarioController.prototype,
      metodo: 'reactivarBloqueo',
    },
    {
      nombre: 'DisponibilidadBarbero.consultarMiDisponibilidad',
      prototipo: DisponibilidadBarberoController.prototype,
      metodo: 'consultarMiDisponibilidad',
    },
  ];

  it.each(endpointsPrivados.map((e) => [e.nombre, e] as const))(
    '%s exige autenticación, RolesGuard y los roles permitidos',
    (_nombre, endpoint) => {
      const { roles, guardias } = leerMetadatos(endpoint);

      expect(guardias).toContain(JwtAuthGuard);
      expect(guardias).toContain(RolesGuard);
      expect(roles).toEqual(ROLES_ESPERADOS);
    },
  );

  it('Disponibilidad.consultarDisponibilidadPublica es público (sin guardias ni roles)', () => {
    const { roles, guardias } = leerMetadatos({
      nombre: 'Disponibilidad.consultarDisponibilidadPublica',
      prototipo: DisponibilidadController.prototype,
      metodo: 'consultarDisponibilidadPublica',
    });

    expect(guardias).toHaveLength(0);
    expect(roles).toBeUndefined();
  });
});
