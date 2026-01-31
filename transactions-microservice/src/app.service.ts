import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) { }

  getHello(): string {
    return 'Hello World!';
  }

  async testConnection(): Promise<string> {

    const foo = await this.prisma.$queryRaw<string[]>`SELECT 1+1`;
    return foo[0];
  }
}
