---
title: Capas (DDD)
description: Las 4 capas del proyecto y qué vive en cada una.
---

Cada bounded context se organiza en 4 carpetas:

```
src/modules/<bounded-context>/
├── domain/             ← reglas de negocio puras
├── application/        ← coordinación de use cases
├── infrastructure/     ← implementaciones técnicas
└── interfaces/         ← HTTP, controllers, DTOs
```

## domain/

**Solo TypeScript. Ni NestJS, ni Prisma, ni framework alguno.**

```
domain/
├── aggregates/         ← Cuenta, Credencial, Sesion, Rol, etc.
├── entities/           ← entidades no-root
├── value-objects/      ← Email, Password, CuentaId, Scope
├── events/             ← CuentaCreadaEvent, etc.
├── repositories/       ← interfaces (CuentaRepository)
├── services/           ← domain services puros
└── errors/             ← CuentaInactivaError, etc.
```

**Reglas:**

- Aggregates son inmutables-por-default. Métodos públicos representan invariantes del negocio.
- Value objects son **completamente inmutables**. Cualquier "modificación" devuelve una nueva instancia.
- IDs entre aggregates son por **valor** (`CuentaId`), no por instancia (nunca `Cuenta.rol: Rol`).
- Repositorios son **interfaces** acá; implementaciones viven en `infrastructure/`.

## application/

```
application/
├── use-cases/          ← SuspenderCuentaUseCase, LoginUseCase, etc.
├── commands/           ← DTOs internos para use cases
├── queries/            ← read-only queries
├── event-handlers/     ← reaccionan a domain events
└── ports/              ← interfaces de servicios externos (EmailSender, Cache)
```

**Características:**

- Cada use case tiene `ejecutar(command): Promise<Result>`.
- El use case **no lanza errores de validación** del dominio; eso es del dominio. Solo lanza errores de orquestación (recurso no encontrado, conflicto).
- Inyecta repositorios vía DI usando tokens `Symbol`.
- Puede coordinar **varios** repositorios pero modifica **un solo** aggregate por transacción.

**Patrón típico:**

```typescript
@Injectable()
export class SuspenderCuentaUseCase {
  constructor(
    @Inject(CUENTA_REPOSITORY)
    private readonly cuentaRepository: CuentaRepository,
    private readonly auditoria: RegistrarEventoAuth,
  ) {}

  async ejecutar(command: SuspenderCuentaCommand): Promise<void> {
    const cuenta = await this.cuentaRepository.buscarPorId(command.cuentaId);
    if (!cuenta) throw new CuentaNoEncontradaError(command.cuentaId);

    cuenta.suspender(command.razon, command.suspendidoPor); // dominio
    await this.cuentaRepository.guardar(cuenta);             // persistencia
    await this.auditoria.registrar({                        // efecto colateral
      eventType: 'cuenta_suspendida',
      accountId: cuenta.id,
      metadata: { razon: command.razon },
    });
  }
}
```

## infrastructure/

```
infrastructure/
├── persistence/        ← *.prisma-repository.ts, *.mapper.ts
├── adapters/           ← email, cache, observability
├── crypto/             ← Argon2Hasher, JwtSigner, RsaKeyLoader
└── services/           ← servicios técnicos (no del dominio)
```

**Reglas:**

- **Solo aquí** se importa `@prisma/client`.
- **Solo aquí** se hacen llamadas HTTP/red externas.
- Los mappers traducen entre el aggregate del dominio y el modelo de Prisma.
- Implementan los puertos definidos en `application/ports/` o las interfaces de repositorios del dominio.

## interfaces/

```
interfaces/
├── http/
│   ├── controllers/    ← CuentasAdminController, etc.
│   ├── dto/            ← request/response shapes con class-validator
│   ├── guards/         ← guards específicos del bounded context
│   └── filters/        ← exception filters → respuestas HTTP
└── consumers/          ← consumidores de Pub/Sub (futuro)
```

**Reglas:**

- DTOs son **diferentes** de los commands del dominio. Aquí van las anotaciones de `class-validator`.
- Los controllers no contienen lógica de negocio; solo orquestan: validar input, llamar use case, formatear output.
- Excepciones de dominio se mapean a HTTP via exception filters.

## shared/

Algunas cosas son comunes a varios bounded contexts y viven en `src/shared/`:

```
shared/
├── domain/
│   ├── aggregate-root.base.ts
│   ├── value-objects/   ← CuentaId, Email (compartidos)
│   └── result.ts        ← Result pattern
├── auth/                ← guards globales, decoradores
├── health/              ← /health, /health/ready, /health/info
├── infrastructure/
│   ├── prisma/          ← PrismaService
│   ├── cache/           ← CachePort + adapters
│   └── observability/   ← correlation-id, json logger
└── utils/
```

**Cuándo subir algo a `shared/`:**

- Cuando 2+ bounded contexts lo usan.
- Cuando es estructural y no del dominio (logger, cache, http utilities).

**Cuándo NO subir:**

- Cuando un solo contexto lo necesita.
- Cuando es lógica de negocio específica (eso pertenece al contexto donde tiene sentido).
