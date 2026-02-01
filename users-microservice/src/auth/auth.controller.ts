import { Controller, Post, Body, ValidationPipe, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { InternalJwtAuthGuard } from './guards/internal-jwt-auth.guard';

@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    @Post()
    login(@Body(ValidationPipe) loginDto: LoginDto) {
        return this.authService.login(loginDto);
    }

    @UseGuards(InternalJwtAuthGuard)
    @Post('validate-user-jwt')
    async validateUserJwt(@Body('user_token') userToken: string) {
        const result = await this.authService.validateUserJwt(userToken);
        return {
            valid: result.valid,
            user_id: result.userId,
        };
    }
}
