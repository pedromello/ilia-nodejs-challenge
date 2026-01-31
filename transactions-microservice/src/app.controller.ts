import { Controller, Get } from '@nestjs/common';
import { AppService, AppStatusInfo } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) { }

  @Get('status')
  async getStatus(): Promise<AppStatusInfo> {
    return await this.appService.getAppStatusInfo();
  }
}
