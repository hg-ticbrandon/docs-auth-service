---
title: Modelo de datos
description: Schemas, tablas, índices y convenciones de PostgreSQL.
---

PostgreSQL 18 con **multi-schema**: 6 schemas, 13 tablas.

## Schemas

| Schema | Bounded context | Tablas |
|---|---|---|
| `identity` | identity | `accounts`, `account_codes` |
| `credentials` | credentials | `passwords`, `password_reset_tokens` |
| `authorization` | authorization | `roles`, `permissions`, `role_permissions`, `user_role_assignments` |
| `sessions` | sessions | `active_sessions`, `refresh_tokens`, `revoked_jtis` |
| `audit` | audit | `auth_events` |
| `socio_negocio` | socio-negocio | `socio_links` |

> `authorization` es una palabra reservada en PG; siempre se escribe entre comillas: `"authorization"`.

## Convenciones de naming

| Elemento | Convención | Idioma | Ejemplo |
|---|---|---|---|
| Schemas | snake_case | inglés | `identity` |
| Tablas | snake_case, plural | inglés | `accounts` |
| Columnas | snake_case | inglés | `account_id`, `created_at` |
| Índices | `idx_<tabla>_<col>` | inglés | `idx_accounts_email` |
| Foreign keys | `fk_<tabla>_<col>` | inglés | `fk_credentials_account_id` |
| Constraints | `chk_<tabla>_<regla>` | inglés | `chk_accounts_email_lowercase` |
| **Valores enum** | `snake_case` | **español** | `'activo'`, `'suspendido'`, `'login_exitoso'` |

> **Por qué columnas en inglés con valores en español:** las columnas son estructura técnica; los valores reflejan el dominio del negocio.

## Tablas principales

> **Nota sobre los `CHECK`:** el SQL de abajo muestra el modelo lógico. Los valores enum (`account_type`, `status`, `event_type`) **se validan en la capa de aplicación** mediante value objects (`TipoCuenta`, `EstadoCuenta`, `TipoEventoAuth`), no con constraints `CHECK` en la base — el schema Prisma actual no los genera. Los `CHECK ... IN (...)` reflejan los valores permitidos, no un constraint físico existente.

### identity.accounts

```sql
id                   UUID PRIMARY KEY,
email                VARCHAR(255) UNIQUE NOT NULL,
username             VARCHAR(30) UNIQUE NOT NULL,
account_type         VARCHAR(20) NOT NULL CHECK (account_type IN ('interno', 'cliente', 'proveedor')),
status               VARCHAR(20) DEFAULT 'activo' CHECK (status IN ('activo', 'suspendido', 'inactivo')),
full_name            VARCHAR(255) NOT NULL,
documento_identidad  VARCHAR(50),
created_at           TIMESTAMPTZ DEFAULT now(),
updated_at           TIMESTAMPTZ NOT NULL,
created_by           UUID
```

**Índices:** `email`, `username` (único), `status`, `account_type`.

> `username` es el nombre de usuario para login (alternativa al email). Único, inmutable, validado en el dominio por el value object `NombreUsuario` (3-30 chars, empieza con letra, `[a-z0-9._-]`, sin `@`).

### identity.account_codes

Los dos códigos internos de la cuenta (`codigoSocio` y `codigoCuenta`), usados
para generación de códigos en PDFs. **Son atributos de la cuenta, independientes
del vínculo con el socio de BC01** (una cuenta puede tener códigos sin socio). El
usuario los edita desde su perfil.

```sql
code        VARCHAR(20) PRIMARY KEY,             -- el valor del código
account_id  UUID NOT NULL REFERENCES identity.accounts ON DELETE CASCADE,
tipo        VARCHAR(10) NOT NULL,                -- 'socio' | 'cuenta'
UNIQUE (account_id, tipo)                        -- un código de cada tipo por cuenta
```

**Índices:** `(account_id)`, `(account_id, tipo)` (único).

> **Pool único global:** `code` es la PK de la tabla, así que un mismo valor **no
> puede repetirse en ningún código de ninguna cuenta** (ni de socio ni de cuenta).
> Los códigos son alfanuméricos de 1 a 20 caracteres (VO `Codigo`), "todo o nada"
> (ambos o ninguno) y distintos entre sí dentro de una cuenta.

### socio_negocio.socio_links

Vínculo entre una cuenta (identity) y un socio de negocio del BC externo
**BC01-socio-negocio**. No duplica el maestro del socio: guarda la referencia
(`socio_externo_id` = personalId de BC01), el tipo y un snapshot de display. Lo
gestiona un admin (no el usuario).

```sql
id              UUID PRIMARY KEY,
account_id      UUID UNIQUE NOT NULL,            -- una cuenta ↔ un socio
socio_externo_id INTEGER UNIQUE NOT NULL,        -- personalId en BC01
tipo            VARCHAR(20) DEFAULT 'empleado',
socio_snapshot  JSONB,                           -- foto de display de BC01 (nullable)
created_at      TIMESTAMPTZ DEFAULT now(),
updated_at      TIMESTAMPTZ NOT NULL
```

> Antes los códigos vivían en `socio_negocio.socio_codes`; la migración
> `mover-codigos-a-cuenta` (2026-07-09) los movió a `identity.account_codes` y
> desacopló los códigos del vínculo con el socio.

### credentials.passwords

PK compuesta por `account_id`: cada cuenta tiene **una sola** credencial (1:1).

```sql
account_id           UUID PRIMARY KEY REFERENCES identity.accounts ON DELETE CASCADE,
password_hash        TEXT NOT NULL,           -- Argon2id, nunca plaintext
password_changed_at  TIMESTAMPTZ NOT NULL,
failed_attempts      INT DEFAULT 0,
locked_until         TIMESTAMPTZ
```

### sessions.active_sessions

```sql
id                  UUID PRIMARY KEY,
account_id          UUID NOT NULL,
jti                 VARCHAR(100) UNIQUE NOT NULL,   -- JWT ID
device_info         JSONB,
ip_address          INET,
issued_at           TIMESTAMPTZ DEFAULT now(),
expires_at          TIMESTAMPTZ NOT NULL,
revoked_at          TIMESTAMPTZ,
revocation_reason   TEXT
```

### sessions.refresh_tokens

```sql
id                  UUID PRIMARY KEY,
session_id          UUID NOT NULL REFERENCES sessions.active_sessions ON DELETE CASCADE,
account_id          UUID NOT NULL,
token_hash          VARCHAR(128) UNIQUE NOT NULL,   -- SHA-256 del refresh token plaintext
family_id           UUID NOT NULL,                   -- para detección de reuso
parent_token_id     UUID,                            -- enlace al token padre
expires_at          TIMESTAMPTZ NOT NULL,
used_at             TIMESTAMPTZ,
revoked_at          TIMESTAMPTZ,
created_at          TIMESTAMPTZ DEFAULT now()
```

**Familia de tokens:** todos los tokens derivados de un mismo login comparten `family_id`. Si se detecta reuso de cualquier token de la familia, se revoca toda.

### sessions.revoked_jtis

```sql
jti                 VARCHAR(100) PRIMARY KEY,
account_id          UUID NOT NULL,
revoked_at          TIMESTAMPTZ DEFAULT now(),
expires_at          TIMESTAMPTZ NOT NULL,            -- = exp del JWT original
revocation_reason   TEXT
```

Tabla pequeña en estado estable: solo entradas hasta el `exp` del JWT (max 1h). El cron de cleanup borra los expirados cada hora.

### authorization.user_role_assignments

```sql
id                 UUID PRIMARY KEY,
account_id         UUID NOT NULL,
role_id            UUID NOT NULL REFERENCES authorization.roles,
scope              JSONB DEFAULT '{}',               -- flexible: {} | {almacenId} | {almacenIds[]}
assigned_by        UUID,
assigned_at        TIMESTAMPTZ DEFAULT now(),
expires_at         TIMESTAMPTZ,                       -- expiración opcional
revoked_at         TIMESTAMPTZ,                       -- revocación lógica, no DELETE
revoked_by         UUID,
revocation_reason  TEXT
```

**No se borran filas.** Una asignación revocada queda con `revoked_at != null` para preservar audit trail.

### audit.auth_events

```sql
id                 UUID PRIMARY KEY,
account_id         UUID,                              -- null en algunos eventos del sistema
event_type         VARCHAR(50) NOT NULL,              -- valores validados en app (TipoEventoAuth)
metadata           JSONB DEFAULT '{}',
ip_address         INET,
user_agent         TEXT,
occurred_at        TIMESTAMPTZ DEFAULT now()
```

**Append-only.** Solo INSERTs. Sin UPDATE ni DELETE en ningún flujo.

**Índices:** `(account_id)`, `(event_type)`, `(occurred_at DESC)`.

## Migrations

Gestionadas por **Prisma**. Vivir en `prisma/migrations/<timestamp>_<descripcion>/migration.sql`.

**Workflow:**

```bash
# 1. Editar prisma/schema.prisma
# 2. Generar migration en dev
pnpm prisma migrate dev --name <descripcion>

# 3. Verificar el SQL generado
cat prisma/migrations/<timestamp>_*/migration.sql

# 4. Commit del schema.prisma + migration

# 5. En prod, aplicar
pnpm prisma migrate deploy
```

**Nunca editar manualmente** los archivos en `prisma/migrations/` después de aplicarlos.
