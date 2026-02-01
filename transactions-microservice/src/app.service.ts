import { Injectable } from '@nestjs/common';
import { AppRepository } from './app.repository';

export interface AppStatusInfo {
  updated_at: string;
  dependencies: {
    database: {
      version: string;
      max_connections: number;
      open_connections: number;
    };
  };
}

@Injectable()
export class AppService {
  constructor(private readonly appRepository: AppRepository) { }
  async getAppStatusInfo(): Promise<AppStatusInfo> {
    const updatedAt = new Date().toISOString();

    const databaseStatus = await this.appRepository.getDatabaseStatus();

    return {
      updated_at: updatedAt,
      dependencies: {
        database: databaseStatus.database,
      },
    };
  }
}
