class PrismaClient {
  constructor() {
    this.$connect = jest.fn();
    this.$disconnect = jest.fn();

    /**
     * `$extends` devuelve el propio cliente: en las pruebas no hace falta
     * un cliente distinto, solo que la llamada exista para poder registrar la
     * extensión de aislamiento por negocio.
     */
    this.$extends = jest.fn(() => this);
  }
}
class PrismaMariaDb {}

/**
 * Mock del namespace `Prisma` del cliente generado.
 *
 * `Prisma.defineExtension` se usa para registrar la extensión de aislamiento
 * por negocio. En las pruebas, la extensión se devuelve tal cual, para que
 * el cliente mock conserve la misma forma de uso.
 */
const Prisma = {
  defineExtension: (extension) => extension,
  sql: (strings, ...values) => ({ strings, values }),
};

module.exports = { PrismaClient, PrismaMariaDb, Prisma };
