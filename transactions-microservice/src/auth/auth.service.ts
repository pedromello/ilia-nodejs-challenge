import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class AuthService {
    constructor(
        private readonly jwtService: JwtService,
        private readonly httpService: HttpService,
    ) { }

    async validateUser(email: string, password: string): Promise<any> {
        // TODO: Implementar validação de usuário
    }

    async validateUserJwt(token: string): Promise<{ valid: boolean; userId?: string }> {
        try {
            const payload = await this.jwtService.verifyAsync(token);
            return {
                valid: true,
                userId: payload.sub,
            };
        } catch (error) {
            return {
                valid: false,
            };
        }
    }

    async validateRemoteToken(token: string): Promise<{ valid: boolean; userId?: string }> {
        try {
            const internalToken = await this.jwtService.signAsync(
                { internal: true },
                {
                    secret: process.env.INTERNAL_JWT_SECRET || 'ILIACHALLENGE_INTERNAL',
                    expiresIn: '1m',
                },
            );

            const usersUrl = process.env.USERS_SERVICE_URL || 'http://users-microservice:3002';
            const { data } = await firstValueFrom(
                this.httpService.post(
                    `${usersUrl}/api/v1/auth/validate-user-jwt`,
                    { user_token: token },
                    {
                        headers: {
                            Authorization: `Bearer ${internalToken}`,
                        },
                    },
                ),
            );

            if (data.valid) {
                return {
                    valid: true,
                    userId: data.user_id,
                };
            }

            return { valid: false };
        } catch (error) {
            console.error('Error validating remote token:', error.message);
            return { valid: false };
        }
    }
}
