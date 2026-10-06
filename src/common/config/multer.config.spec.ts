import { crearMulterOptions } from './multer.config';
import * as crypto from 'node:crypto';

jest.mock('node:crypto', () => ({
  randomBytes: jest.fn().mockReturnValue({
    toString: jest.fn().mockReturnValue('mocked-hex'),
  }),
}));

describe('MulterConfig', () => {
  it('should generate a correct config', () => {
    const config = crearMulterOptions('test');
    expect(config.limits.fileSize).toBe(5 * 1024 * 1024);
  });

  it('should accept valid images', () => {
    const config = crearMulterOptions('test');
    const mockCallback = jest.fn();
    config.fileFilter(null as any, { mimetype: 'image/jpeg' } as any, mockCallback);
    expect(mockCallback).toHaveBeenCalledWith(null, true);
  });

  it('should reject invalid files', () => {
    const config = crearMulterOptions('test');
    const mockCallback = jest.fn();
    config.fileFilter(null as any, { mimetype: 'application/pdf' } as any, mockCallback);
    expect(mockCallback).toHaveBeenCalledWith(expect.any(Error), false);
  });

  it('should generate a unique filename using crypto', () => {
    const config = crearMulterOptions('test');
    const mockCallback = jest.fn();
    const mockDateNow = jest.spyOn(Date, 'now').mockReturnValue(1234567890);
    
    (config.storage as any).getFilename(null, { originalname: 'test.png' }, mockCallback);
    
    expect(crypto.randomBytes).toHaveBeenCalledWith(8);
    expect(mockCallback).toHaveBeenCalledWith(null, 'test-1234567890-mocked-hex.png');
    
    mockDateNow.mockRestore();
  });
});
