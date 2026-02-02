import { Test, TestingModule } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { InternalJwtStrategy } from './strategies/internal-jwt.strategy';
import { UnauthorizedException } from '@nestjs/common';

describe('InternalJwtStrategy', () => {
    let strategy: InternalJwtStrategy;
    let jwtService: JwtService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            imports: [
                JwtModule.register({
                    secret: 'ILIACHALLENGE_INTERNAL',
                }),
            ],
            providers: [InternalJwtStrategy],
        }).compile();

        strategy = module.get<InternalJwtStrategy>(InternalJwtStrategy);
        jwtService = module.get<JwtService>(JwtService);
    });

    it('should validate an internal token', async () => {
        const payload = { internal: true };
        const result = await strategy.validate(payload);
        expect(result).toEqual({ internal: true });
    });

    it('should throw UnauthorizedException if internal flag is missing', async () => {
        const payload = { internal: false };
        await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
    });
});
