import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { UsuariosModule } from './modules/usuarios/usuarios.module';
import { PrismaModule } from './prisma/prisma.module';
import { BootstrapService } from './bootstrap/bootstrap.service';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    AuthModule,
    UsuariosModule,
    PrismaModule,
  ],
  providers: [BootstrapService],
})
export class AppModule {}