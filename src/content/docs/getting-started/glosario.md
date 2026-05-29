---
title: Glosario del dominio
description: Ubiquitous Language usado en el código y la documentación.
---

El proyecto sigue una regla estricta: **el dominio se escribe en español, lo técnico en inglés**. Este glosario mapea los términos del negocio a sus clases/métodos en código.

## Términos del dominio

| Término del negocio | En código |
|---|---|
| Cuenta | `Cuenta` (aggregate root) |
| Tipo de cuenta | `TipoCuenta` (`'interno'`, `'cliente'`, `'proveedor'`) |
| Estado de cuenta | `EstadoCuenta` (`'activo'`, `'suspendido'`, `'inactivo'`) |
| Credencial | `Credencial` (aggregate root) |
| Password | `Password` (value object) |
| Hash de password | `PasswordHash` (value object) |
| Rol | `Rol` (aggregate root) |
| Permiso | `Permiso`, `CodigoPermiso` (value object) |
| Scope | `Scope` (value object) |
| Asignación de rol | `AsignacionRol` (aggregate root) |
| Sesión | `Sesion` (aggregate root) |
| Evento de auditoría | `EventoAuth` (aggregate) |
| Almacén | `Almacen` |
| Vehículo | `Vehiculo` |
| Despacho | `Despacho` |
| Documento de identidad | `DocumentoIdentidad` (value object) |

## Términos técnicos (siempre en inglés)

Estos NO se traducen porque son convenciones universales de la industria:

- **JWT** — JSON Web Token
- **JWKS** — JSON Web Key Set
- **Bearer** — esquema de auth HTTP (`Authorization: Bearer <token>`)
- **Aggregate** — patrón DDD: cluster transaccional
- **Repository** — patrón DDD: persistencia de aggregates
- **UseCase** — caso de uso (capa application)
- **Command / Query** — patrón CQRS
- **Event** — domain event
- **Port / Adapter** — arquitectura hexagonal
- **Module / Controller / DTO** — primitivas de NestJS
- **Mapper** — traduce entre aggregate y modelo de persistencia
- **Guard** — middleware de autorización en NestJS

## Códigos de permiso (convención)

Formato: `modulo:accion` o `modulo:recurso:accion` (2 o 3 segmentos, minúsculas).

Los **permisos del propio Auth Service** (los únicos `auth:*` que existen en el catálogo):

| Permiso | Significado |
|---|---|
| `auth:account:read` | Ver cuentas y sus sesiones |
| `auth:account:write` | Crear, actualizar, suspender, reactivar y desactivar cuentas; set/reset password; revocar sesiones |
| `auth:role:assign` | Asignar y revocar roles a cuentas |
| `auth:role:manage` | Gestionar roles y permisos (crear, editar, borrar, agregar/quitar permisos) |

Ejemplos de permisos de **otros módulos** del ecosistema (también en el catálogo):

| Permiso | Significado |
|---|---|
| `wms:inventario:read` | Leer inventario en WMS |
| `wms:inventario:write` | Modificar inventario en WMS |
| `wms:despacho:write` | Registrar despacho |
| `facturacion:emitir` | Emitir facturas |

El `prisma/seed.ts` siembra un catálogo base por default (40 permisos) en el deploy
inicial, pero **no es la fuente de verdad**: roles y permisos se administran en
runtime desde la base del Auth Service vía `/api/admin/roles` y `/api/admin/permisos`
(hay UI de administración en el frontend).

## Tipos de evento de auditoría

Valores válidos en `audit.auth_events.event_type`:

- `login_exitoso`
- `login_fallido`
- `logout`
- `credencial_bloqueada`
- `password_cambiado`
- `password_reset_solicitado`
- `password_reset_completado`
- `cuenta_creada`
- `cuenta_suspendida`
- `cuenta_reactivada`
- `cuenta_desactivada`
- `rol_asignado`
- `asignacion_revocada`
- `sesion_revocada_admin`
- `token_reusado`
