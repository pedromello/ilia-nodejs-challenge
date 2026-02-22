import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class InternalJwtStrategy extends PassportStrategy(Strategy, 'jwt-internal') {
    constructor() {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: process.env.INTERNAL_JWT_SECRET,
        });
    }

    async validate(payload: any) {
        if (!payload.internal) {
            throw new UnauthorizedException('Not an internal token');
        }
        return { internal: true };
    }
}
