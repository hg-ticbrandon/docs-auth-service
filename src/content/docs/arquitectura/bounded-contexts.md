---
title: Bounded contexts
description: Los 5 contextos del dominio y sus responsabilidades.
---

El Auth Service divide el dominio en **5 bounded contexts**, cada uno con su propio schema PG, sus aggregates y su módulo NestJS.

## identity

**Responsabilidad:** quién es cada cuenta (sin sus credenciales).

**Aggregates:** `Cuenta` (root).

**Value objects:** `Email`, `EstadoCuenta`, `TipoCuenta`, `DocumentoIdentidad`.

**Use cases:** `CrearCuenta`, `SuspenderCuenta`, `ReactivarCuenta`, `DesactivarCuenta`, `EditarCuenta`, `ListarCuentas`, `BuscarCuenta`.

**Tablas PG:** `identity.accounts`.

## credentials

**Responsabilidad:** verificar y gestionar passwords. Política de bloqueo. Reset por email.

**Aggregates:** `Credencial` (root, tiene la misma `CuentaId` que la cuenta), `PasswordResetToken`.

**Value objects:** `Password`, `PasswordHash`.

**Use cases:** `SetPassword`, `VerificarPassword`, `IniciarReset`, `CompletarReset`, `IncrementarIntentosFallidos`, `BloquearTemporalmente`.

**Tablas PG:** `credentials.passwords`, `credentials.password_reset_tokens`.

## sessions

**Responsabilidad:** emitir JWTs, gestionar refresh tokens con rotación, revocación.

**Aggregates:** `Sesion` (root), `RefreshToken` (root), `RevokedJti` (entity).

**Value objects:** `SesionId`, `Jti`, `FamiliaToken`.

**Use cases:** `Login`, `Refresh`, `Logout`, `RevocarSesion`.

**Tablas PG:** `sessions.active_sessions`, `sessions.refresh_tokens`, `sessions.revoked_jtis`.

## authorization

**Responsabilidad:** roles, permisos, scopes, asignaciones a cuentas.

**Aggregates:** `Rol` (root), `AsignacionRol` (root), `Permiso` (entity).

**Value objects:** `RoleId`, `RoleName`, `CodigoPermiso`, `Scope`.

**Use cases:** `CrearRol`, `AgregarPermisoARol`, `QuitarPermisoARol`, `AsignarRolACuenta`, `RevocarAsignacion`, `ListarPermisos`, `PermisosDeRol`.

**Tablas PG:** `authorization.roles`, `authorization.permissions`, `authorization.role_permissions`, `authorization.user_role_assignments`.

## audit

**Responsabilidad:** registrar eventos sensibles del sistema en log append-only.

**Aggregates:** `EventoAuth` (root, immutable).

**Use cases:** `RegistrarEvento`, `ListarEventos`.

**Tablas PG:** `audit.auth_events`.

> **Regla:** la tabla solo recibe INSERTs. Nunca UPDATE ni DELETE.

## Interacciones entre contextos

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                      │
│  identity ◄────── sessions (login lee cuenta para ver si está activa)│
│     │                │                                                │
│     │                │                                                │
│     │           credentials (login verifica password)                 │
│     │                                                                  │
│     │                                                                  │
│     ▼           authorization (login enriquece JWT con roles[])       │
│  audit  ◄──── todos (emiten eventos al log)                          │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Reglas de interacción:**

1. Nunca import directo entre contextos a nivel de aggregate.
2. Compartido va a `shared/domain/` (ej. `CuentaId`, `Email`).
3. Si un use case necesita data de otro contexto, llama al **repositorio** del otro contexto vía DI (no construye el aggregate directamente).
4. Si dos contextos están demasiado acoplados, considerar fusionarlos.

## Por qué 5 contextos y no menos

Una alternativa era tener un solo módulo `auth` con todo adentro. Se eligió separarlos porque:

- **Evolucionan a distintas velocidades.** Authorization recibió 3x más cambios que identity en los primeros sprints.
- **Permite migrar a microservicios reales** si en el futuro alguno (auditoría, autorización) necesita escalar independientemente.
- **Hace más fácil el reasoning.** Si tocás `sessions/`, sabés que no afectás reglas de `identity/`.
