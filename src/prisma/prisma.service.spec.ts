import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  let service: PrismaService;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const mockConfigService = {
      getOrThrow: jest.fn().mockReturnValue('mysql://root:secret@127.0.0.1:3306/barberia'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrismaService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<PrismaService>(PrismaService);
    configService = module.get(ConfigService);
  });

  it('debe inicializarse correctamente y leer DATABASE_URL', () => {
    expect(service).toBeDefined();
    expect(configService.getOrThrow).toHaveBeenCalledWith('DATABASE_URL');
  });

  it('debe llamar a $connect en onModuleInit', async () => {
    const spyConnect = jest.spyOn(service, '$connect').mockResolvedValue(undefined as any);
    await service.onModuleInit();
    expect(spyConnect).toHaveBeenCalledTimes(1);
  });

  it('debe llamar a $disconnect en onModuleDestroy', async () => {
    const spyDisconnect = jest.spyOn(service, '$disconnect').mockResolvedValue(undefined as any);
    await service.onModuleDestroy();
    expect(spyDisconnect).toHaveBeenCalledTimes(1);
  });
});
