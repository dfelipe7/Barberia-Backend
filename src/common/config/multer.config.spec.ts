import { crearMulterOptions } from './multer.config';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';

jest.mock('node:crypto', () => ({
  randomBytes: jest.fn().mockReturnValue({
    toString: jest.fn().mockReturnValue('mocked-hex'),
  }),
}));

jest.mock('node:fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

describe('MulterConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should generate a correct config with default limits', () => {
    const config = crearMulterOptions('test');
    expect(config.limits.fileSize).toBe(5 * 1024 * 1024);
  });

  it('should accept valid images (jpeg)', () => {
    const config = crearMulterOptions('test');
    const mockCallback = jest.fn();
    config.fileFilter(
      null as any,
      { mimetype: 'image/jpeg' } as any,
      mockCallback,
    );
    expect(mockCallback).toHaveBeenCalledWith(null, true);
  });

  it('should accept valid images (png)', () => {
    const config = crearMulterOptions('test');
    const mockCallback = jest.fn();
    config.fileFilter(
      null as any,
      { mimetype: 'image/png' } as any,
      mockCallback,
    );
    expect(mockCallback).toHaveBeenCalledWith(null, true);
  });

  it('should reject invalid files (pdf)', () => {
    const config = crearMulterOptions('test');
    const mockCallback = jest.fn();
    config.fileFilter(
      null as any,
      { mimetype: 'application/pdf' } as any,
      mockCallback,
    );
    expect(mockCallback).toHaveBeenCalledWith(expect.any(Error), false);
  });

  it('should generate a unique filename using crypto', () => {
    const config = crearMulterOptions('test');
    const mockCallback = jest.fn();
    const mockDateNow = jest.spyOn(Date, 'now').mockReturnValue(1234567890);

    (config.storage as any).getFilename(
      null,
      { originalname: 'test.png' },
      mockCallback,
    );

    expect(crypto.randomBytes).toHaveBeenCalledWith(8);
    expect(mockCallback).toHaveBeenCalledWith(
      null,
      'test-1234567890-mocked-hex.png',
    );

    mockDateNow.mockRestore();
  });

  it('should use prefijoArchivo when provided', () => {
    const config = crearMulterOptions('barberos', 'barbero');
    const mockCallback = jest.fn();
    const mockDateNow = jest.spyOn(Date, 'now').mockReturnValue(9999);

    (config.storage as any).getFilename(
      null,
      { originalname: 'foto.jpg' },
      mockCallback,
    );
    expect(mockCallback).toHaveBeenCalledWith(
      null,
      'barbero-9999-mocked-hex.jpg',
    );

    mockDateNow.mockRestore();
  });

  it('should call callback with uploadPath when directory already exists', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    const config = crearMulterOptions('barberos');
    const mockCallback = jest.fn();

    (config.storage as any).getDestination(null, null, mockCallback);

    expect(fs.existsSync).toHaveBeenCalled();
    expect(fs.mkdirSync).not.toHaveBeenCalled();
    expect(mockCallback).toHaveBeenCalledWith(
      null,
      expect.stringContaining('barberos'),
    );
  });

  it('should create directory and call callback when directory does not exist', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    const config = crearMulterOptions('servicios');
    const mockCallback = jest.fn();

    (config.storage as any).getDestination(null, null, mockCallback);

    expect(fs.existsSync).toHaveBeenCalled();
    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('servicios'),
      { recursive: true },
    );
    expect(mockCallback).toHaveBeenCalledWith(
      null,
      expect.stringContaining('servicios'),
    );
  });
});
