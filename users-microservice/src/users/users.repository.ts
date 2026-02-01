import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersRepository {
    constructor(private readonly prisma: PrismaService) { }

    async create(data: CreateUserDto & { password: string }) {
        return this.prisma.user.create({
            data: {
                email: data.email,
                firstName: data.first_name,
                lastName: data.last_name,
                password: data.password,
            },
        });
    }

    async findAll() {
        return this.prisma.user.findMany({
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                createdAt: true,
                updatedAt: true,
            },
        });
    }

    async findById(id: string) {
        return this.prisma.user.findUnique({
            where: { id },
        });
    }

    async findByEmail(email: string) {
        return this.prisma.user.findUnique({
            where: { email },
        });
    }

    async update(id: string, data: Partial<UpdateUserDto & { password: string }>) {
        const updateData: any = {};

        if (data.first_name !== undefined) {
            updateData.firstName = data.first_name;
        }
        if (data.last_name !== undefined) {
            updateData.lastName = data.last_name;
        }
        if (data.password !== undefined) {
            updateData.password = data.password;
        }

        return this.prisma.user.update({
            where: { id },
            data: updateData,
        });
    }

    async delete(id: string) {
        return this.prisma.user.delete({
            where: { id },
        });
    }
}
