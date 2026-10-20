class ConfigService {
  get(key) {
    if (key === 'KEYCLOAK_REALM') return 'barberia';
    if (key === 'KEYCLOAK_CLIENT_ID') return 'barberia-backend';
    return null;
  }
}

/**
 * `ConfigModule.forRoot` se simula para que los tests puedan importar
 * módulos que dependen de `ConfigService` (por ejemplo, el módulo de
 * negocios, que lo usa para resolver el dominio base y el permiso de la
 * cabecera de slug). Los valores se resuelven con el `ConfigService` simulado.
 */
const ConfigModule = {
  forRoot: () => ({
    module: class ConfigModuleMock {},
    providers: [ConfigService],
    exports: [ConfigService],
    global: true,
  }),
};

module.exports = { ConfigService, ConfigModule };
