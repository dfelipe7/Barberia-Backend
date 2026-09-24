class ConfigService {
  get(key) {
    if (key === 'KEYCLOAK_REALM') return 'barberia';
    if (key === 'KEYCLOAK_CLIENT_ID') return 'barberia-backend';
    return null;
  }
}
module.exports = { ConfigService };
