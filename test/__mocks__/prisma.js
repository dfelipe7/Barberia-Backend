class PrismaClient {
  constructor() {
    this.$connect = jest.fn();
    this.$disconnect = jest.fn();
  }
}
class PrismaMariaDb {}
module.exports = { PrismaClient, PrismaMariaDb };
