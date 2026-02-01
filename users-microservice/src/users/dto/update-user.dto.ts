import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateUserDto {
    @IsOptional()
    @IsString()
    @MinLength(2)
    first_name?: string;

    @IsOptional()
    @IsString()
    @MinLength(2)
    last_name?: string;

    @IsOptional()
    @IsString()
    @MinLength(6)
    password?: string;
}
