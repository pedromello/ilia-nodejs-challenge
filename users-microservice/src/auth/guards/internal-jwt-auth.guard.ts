import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class InternalJwtAuthGuard extends AuthGuard('jwt-internal') { }
