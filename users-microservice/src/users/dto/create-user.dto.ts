import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
    @IsEmail()
    @IsNotEmpty()
    email: string;

    @IsString()
    @IsNotEmpty()
    @MinLength(2)
    first_name: string;

    @IsString()
    @IsNotEmpty()
    @MinLength(2)
    last_name: string;

    @IsString()
    @IsNotEmpty()
    @MinLength(6)
    password: string;
}
