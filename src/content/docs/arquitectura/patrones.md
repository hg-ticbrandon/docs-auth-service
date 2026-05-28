---
title: Patrones de diseño
description: CQRS, Result, Port/Adapter, Aggregates — qué se usa y por qué.
---

## Aggregate Root

Patrón DDD: un cluster de objetos del dominio que se trata como una unidad para cambios de datos. Cada aggregate tiene una raíz (root entity) que es el único punto de entrada para modificaciones.

**En el código:**

```typescript
export class Cuenta extends AggregateRoot {
  private constructor(/* ... */) { super(); }

  // Factory para crear nueva (emite eventos)
  static crear(props: CrearCuentaProps): Result<Cuenta, CrearCuentaError> {
    // valida invariantes
    const emailResult = Email.crear(props.email);
    if (emailResult.esFallo()) return Result.fail(/* ... */);
    // construye
    const cuenta = new Cuenta(/* ... */);
    cuenta.apply(new CuentaCreadaEvent(cuenta.id));
    return Result.ok(cuenta);
  }

  // Factory para reconstruir desde DB (sin eventos)
  static reconstruir(props: ReconstruirCuentaProps): Cuenta {
    return new Cuenta(/* ... */);
  }

  // Métodos del dominio validan invariantes y emiten eventos
  suspender(razon: string, suspendidoPor: CuentaId): void {
    if (this.estado.esInactiva()) {
      throw new CuentaInactivaError(this.id);
    }
    this.estado = EstadoCuenta.suspendida();
    this.apply(new CuentaSuspendidaEvent(this.id, razon, suspendidoPor));
  }
}
```

**Reglas inquebrantables:**

- Constructor **privado**. Solo factories estáticos lo invocan.
- `crear()` para nuevos (emite eventos).
- `reconstruir()` para hidratar desde persistencia (sin eventos).
- Una transacción de DB toca **un solo** aggregate.
- Referencias cross-aggregate son por **ID**, nunca por instancia.

## Result pattern

En el dominio, las validaciones devuelven `Result<T, E>` en vez de lanzar excepciones. Esto fuerza al caller a manejar el error y hace explícitas las rutas felices vs. fallidas.

```typescript
class Email {
  static crear(valor: string): Result<Email, EmailInvalidoError> {
    if (!this.esValido(valor)) {
      return Result.fail(new EmailInvalidoError(valor));
    }
    return Result.ok(new Email(valor));
  }
}

// Uso:
const resultado = Email.crear('juan@hagemsa.com');
if (resultado.esFallo()) return resultado;
const email = resultado.valor;
```

**Cuándo usar Result vs. throw:**

- **Result:** validaciones del dominio que el caller puede prevenir (formato de email, longitud de password).
- **Throw:** invariantes rotas que "no deberían pasar" (aggregate en estado imposible, bug del programador). También en `application/` cuando un Result no se puede recuperar (`CuentaNoEncontradaError`).

## Port + Adapter (Hexagonal)

Para todo servicio externo (cache, email, observability), el dominio/aplicación define una **interface (port)** y la infraestructura provee una **implementación (adapter)**.

```typescript
// application/ports/cache.port.ts
export interface CachePort {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

export const CACHE_PORT = Symbol('CACHE_PORT');

// infrastructure/cache/in-memory-cache.adapter.ts
@Injectable()
export class InMemoryCacheAdapter implements CachePort { /* ... */ }

// module:
{ provide: CACHE_PORT, useClass: InMemoryCacheAdapter }

// use case:
constructor(@Inject(CACHE_PORT) private readonly cache: CachePort) {}
```

**Ventaja:** podés cambiar la implementación (Redis, Memorystore) sin tocar el dominio.

## CQRS ligero (use cases explícitos)

En vez de usar `@nestjs/cqrs` con `@CommandHandler`, cada operación es un `UseCase` explícito.

```typescript
@Injectable()
export class CrearCuentaUseCase {
  constructor(/* repos, services */) {}

  async ejecutar(command: CrearCuentaCommand): Promise<CuentaId> {
    // ...
  }
}
```

**Por qué este patrón en lugar de `@CommandHandler`:**

- Más explícito: el método se llama `ejecutar`, no `execute`. Está en el idioma del dominio.
- Sin dependencia extra (`@nestjs/cqrs`).
- Más testeable: cada use case es una clase standalone.
- DDD-puro: no introduce concept "command bus" que no existe en el negocio.

## Repository

Interface en `domain/repositories/`, implementación en `infrastructure/persistence/`.

```typescript
// domain/repositories/cuenta.repository.ts
export interface CuentaRepository {
  buscarPorId(id: CuentaId): Promise<Cuenta | null>;
  buscarPorEmail(email: Email): Promise<Cuenta | null>;
  existePorEmail(email: Email): Promise<boolean>;
  listar(filtros: FiltrosCuenta): Promise<readonly Cuenta[]>;
  guardar(cuenta: Cuenta): Promise<void>;
}

export const CUENTA_REPOSITORY = Symbol('CUENTA_REPOSITORY');

// infrastructure/persistence/cuenta.prisma-repository.ts
@Injectable()
export class CuentaPrismaRepository implements CuentaRepository {
  constructor(private readonly prisma: PrismaService) {}
  // ...
}
```

**Reglas:**

- El dominio define la interface en su idioma (`buscarPorId`, no `findById`).
- La implementación Prisma traduce entre `Cuenta` (aggregate) y `Account` (model Prisma) usando un **mapper**.

## Domain Events

Los aggregates emiten eventos para describir cambios significativos.

```typescript
cuenta.apply(new CuentaSuspendidaEvent(cuenta.id, razon, suspendidoPor));
```

Los eventos se **acumulan en el aggregate** hasta que se persiste. Después de `guardar()`, el repositorio extrae los eventos y los publica (en este proyecto se llama directamente al servicio de auditoría; no hay event bus framework).

## Factory methods estáticos

Aggregates nunca se instancian con `new` desde fuera. Siempre via factory:

- `Cuenta.crear(props)` — para nuevos.
- `Cuenta.reconstruir(props)` — desde persistencia.

Esto previene estados inválidos por constructor mal usado.
