import { Injectable } from '@nestjs/common';
import { PrismaService } from './infra/prisma.service';
import { Prisma } from './generated/prisma/client';

interface DatabaseStatus {
    database: {
        version: string;
        max_connections: number;
        open_connections: number;
    };
}

@Injectable()
export class AppRepository {
    constructor(private readonly prisma: PrismaService) { }
    async getDatabaseStatus(): Promise<DatabaseStatus> {

        const dbVersionResult = await this.prisma.$queryRaw<{
            server_version: string;
        }>`SHOW server_version;`;
        const dbVersion = dbVersionResult[0].server_version;

        const dbMaxConnectionsResult = await this.prisma.$queryRaw<{
            max_connections: string;
        }>`SHOW max_connections;`;
        const dbMaxConnections = dbMaxConnectionsResult[0].max_connections;

        const databaseName = process.env.POSTGRES_DB;

        const dbOpenConnectionsResult = await this.prisma.$queryRaw<{
            count: string;
        }>(
            Prisma.sql`SELECT COUNT(*) as count FROM pg_stat_activity WHERE datname = ${databaseName};`,
        );
        const dbOpenConnections = Number(dbOpenConnectionsResult[0].count);

        return {
            database: {
                version: dbVersion,
                max_connections: parseInt(dbMaxConnections),
                open_connections: dbOpenConnections,
            },
        };
    }
}
