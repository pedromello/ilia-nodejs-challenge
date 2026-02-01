import {
    Injectable,
    ConflictException,
    NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersRepository } from './users.repository';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';

@Injectable()
export class UsersService {
    constructor(private readonly usersRepository: UsersRepository) { }

    async create(createUserDto: CreateUserDto): Promise<UserResponseDto> {
        // Validar se email já existe
        const existingUser = await this.usersRepository.findByEmail(
            createUserDto.email,
        );
        if (existingUser) {
            throw new ConflictException('Email already exists');
        }

        // Hashear senha
        const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

        // Criar usuário
        const user = await this.usersRepository.create({
            ...createUserDto,
            password: hashedPassword,
        });

        // Retornar sem senha
        return this.toResponseDto(user);
    }

    async findAll(): Promise<UserResponseDto[]> {
        const users = await this.usersRepository.findAll();
        return users.map((user) => this.toResponseDto(user));
    }

    async findOne(id: string): Promise<UserResponseDto> {
        const user = await this.usersRepository.findById(id);
        if (!user) {
            throw new NotFoundException('User not found');
        }
        return this.toResponseDto(user);
    }

    async findByEmail(email: string) {
        return this.usersRepository.findByEmail(email);
    }

    /**
     * Normalmente não se deve atualizar a senha neste tipo de endpoint.
     * Em uma aplicação real seria necessário criar endpoints específicos para isso atrás de um fluxo de 2FA.
     */
    async update(
        id: string,
        updateUserDto: UpdateUserDto,
    ): Promise<UserResponseDto> {
        // Validar se usuário existe
        const user = await this.usersRepository.findById(id);
        if (!user) {
            throw new NotFoundException('User not found');
        }

        // Preparar dados para atualização
        const updateData: any = { ...updateUserDto };

        // Re-hashear senha se foi fornecida
        if (updateUserDto.password) {
            updateData.password = await bcrypt.hash(updateUserDto.password, 10);
        }

        // Atualizar usuário
        const updatedUser = await this.usersRepository.update(id, updateData);

        // Retornar sem senha
        return this.toResponseDto(updatedUser);
    }

    async remove(id: string): Promise<void> {
        // Validar se usuário existe
        const user = await this.usersRepository.findById(id);
        if (!user) {
            throw new NotFoundException('User not found');
        }

        await this.usersRepository.delete(id);
    }

    private toResponseDto(user: any): UserResponseDto {
        return {
            id: user.id,
            email: user.email,
            first_name: user.firstName,
            last_name: user.lastName,
        };
    }
}
