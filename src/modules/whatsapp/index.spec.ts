import * as WhatsAppModuleExports from './index';

describe('whatsapp/index barrel export', () => {
  it('exporta todos los componentes, controladores, servicios y utilitarios principales', () => {
    expect(WhatsAppModuleExports.WhatsAppController).toBeDefined();
    expect(WhatsAppModuleExports.WhatsAppService).toBeDefined();
    expect(WhatsAppModuleExports.WhatsAppPlantillasRepository).toBeDefined();
    expect(WhatsAppModuleExports.WhatsAppQueueManager).toBeDefined();
    expect(WhatsAppModuleExports.WhatsAppSessionManager).toBeDefined();
    expect(WhatsAppModuleExports.WhatsAppTemplateEngine).toBeDefined();
    expect(WhatsAppModuleExports.enmascararTelefono).toBeDefined();
    expect(WhatsAppModuleExports.formatearNumeroAJid).toBeDefined();
  });
});
