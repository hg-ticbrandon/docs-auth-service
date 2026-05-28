---
title: Visión general
description: Arquitectura de alto nivel del Auth Service.
---

El Auth Service sigue **Domain-Driven Design (DDD) táctico** con arquitectura **hexagonal** y **CQRS ligero**.

## Decisiones clave

| Decisión | Razón |
|---|---|
| DDD con bounded contexts explícitos | El dominio tiene 5 áreas naturales (identidad, credenciales, sesiones, autorización, auditoría) que evolucionan a velocidades distintas |
| Hexagonal (Ports + Adapters) | Permite testear el dominio sin DB, sin NestJS, sin nada externo |
| CQRS ligero (use cases explícitos) | Más DDD-puro que `@nestjs/cqrs`, sin event bus framework. Cada acción es un `UseCase` con `ejecutar(command)` |
| Result pattern en el dominio | Errores de validación devuelven `Result.fail()` en vez de lanzar. Las excepciones quedan para casos imposibles (invariantes rotas) |
| Multi-schema PostgreSQL | Un schema PG por bounded context. Aísla cambios, facilita backups selectivos |
| Aggregates son la frontera transaccional | Una transacción de DB toca **un** aggregate. Coordinación entre aggregates via eventos o procesos de aplicación |

## Vista de alto nivel

```
┌──────────────────────────────────────────────────────────────┐
│                     HTTP / NestJS Layer                       │
│           controllers/, dto/, guards/, decorators/            │
└────────────────────────────┬─────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────┐
│                  Application Layer                            │
│         use-cases/, commands/, queries/, ports/               │
│                                                               │
│   Coordina aggregates, repositorios, eventos. Sin lógica de  │
│   negocio — solo orquestación.                                │
└────────────────────────────┬─────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────┐
│                     Domain Layer                              │
│   aggregates/, entities/, value-objects/, events/, errors/    │
│   repositories/ (interfaces), services/                       │
│                                                               │
│   Reglas de negocio puras. No conoce NestJS, Prisma, ni nada │
│   externo. Solo TypeScript + tipos.                           │
└──────────────────────────────────────────────────────────────┘
                             ▲
                             │
┌──────────────────────────────────────────────────────────────┐
│                Infrastructure Layer                           │
│   persistence/ (Prisma repos), adapters/ (email, cache),      │
│   crypto/ (Argon2, JWT, RSA)                                  │
│                                                               │
│   Implementa los puertos definidos en application/. Se        │
│   inyecta vía tokens DI (Symbol).                             │
└──────────────────────────────────────────────────────────────┘
```

## Reglas de dependencia

| Capa | Puede importar de | NUNCA importa |
|---|---|---|
| `domain/` | Solo `shared/domain/` | NestJS, Prisma, framework, otras capas |
| `application/` | `domain/`, `shared/domain/` | Prisma, controllers, otros bounded contexts directamente |
| `infrastructure/` | `domain/`, `application/ports/`, `shared/` | controllers, otros módulos directamente |
| `interfaces/` | `application/`, `shared/` | `domain/` directamente, `infrastructure/` directamente |

**Regla crítica:** el `domain/` nunca importa nada del framework. Si necesitás algo del framework, va en `application/` o `infrastructure/`.

## Stack tecnológico

| Capa | Tech |
|---|---|
| Runtime | Node.js 20 LTS |
| Lenguaje | TypeScript 5.9 estricto (sin `any`, sin `@ts-ignore`) |
| Framework | NestJS 11 |
| ORM | Prisma 7 con `@prisma/adapter-pg` |
| DB | PostgreSQL 16 multi-schema |
| Hash | Argon2id (`argon2` 0.44.x) |
| JWT | `jsonwebtoken` 9.0.x con RS256 |
| Validación HTTP | `class-validator` + `class-transformer` |
| Rate limit | `@nestjs/throttler` |
| Scheduled jobs | `@nestjs/schedule` |
| Docs | `@nestjs/swagger` (OpenAPI 3.x) |
| Email | `@sendgrid/mail` (con `LoggingEmailSender` para dev) |
| Pkg manager | pnpm 11 + workspace (`libs/auth-guard/`) |

Ver también: [Bounded contexts](/arquitectura/bounded-contexts/) · [Capas](/arquitectura/capas/) · [Patrones](/arquitectura/patrones/) · [Modelo de datos](/arquitectura/modelo-datos/) · [Seguridad](/arquitectura/seguridad/).
