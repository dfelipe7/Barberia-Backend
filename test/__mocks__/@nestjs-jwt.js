class JwtService {
  sign(payload) {
    return 'signed-jwt-token';
  }
  verify(token) {
    return {};
  }
}

class JwtModule {
  static registerAsync() {
    return { module: JwtModule, providers: [JwtService], exports: [JwtService] };
  }
}

module.exports = { JwtService, JwtModule };
