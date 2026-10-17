const makeWASocket = jest.fn().mockReturnValue({
  ev: {
    on: jest.fn(),
    removeAllListeners: jest.fn(),
  },
  end: jest.fn(),
  logout: jest.fn(),
  sendMessage: jest.fn().mockResolvedValue(true),
});

module.exports = {
  __esModule: true,
  default: makeWASocket,
  makeWASocket,
  DisconnectReason: {
    connectionClosed: 428,
    connectionLost: 408,
    connectionReplaced: 440,
    timedOut: 408,
    loggedOut: 401,
    badSession: 500,
    restartRequired: 515,
    multideviceMismatch: 411,
  },
  useMultiFileAuthState: jest.fn().mockResolvedValue({
    state: {},
    saveCreds: jest.fn(),
  }),
};
