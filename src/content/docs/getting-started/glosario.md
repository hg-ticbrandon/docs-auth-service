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

Formato: `<modulo>:<recurso>:<accion>`.

| Permiso | Significado |
|---|---|
| `auth:cuenta:crear` | Crear cuentas nuevas |
| `auth:cuenta:suspender` | Suspender cuentas existentes |
| `auth:cuenta:reactivar` | Reactivar cuentas suspendidas |
| `auth:rol:asignar` | Asignar roles a cuentas |
| `auth:sesion:revocar` | Revocar sesiones de cualquier cuenta |
| `wms:inventario:read` | Leer inventario en WMS |
| `wms:inventario:write` | Modificar inventario en WMS |
| `despachos:guia:firmar` | Firmar guías de despacho |
| `facturacion:factura:emitir` | Emitir facturas |

El catálogo completo se siembra al deploy inicial (ver `prisma/seed.ts`).

## Tipos de evento de auditoría

Valores válidos en `audit.auth_events.event_type`:

- `login_exitoso`
- `login_fallido`
- `logout`
- `refresh_exitoso`
- `refresh_reuso_detectado`
- `password_cambiado`
- `password_reset_solicitado`
- `password_reset_completado`
- `cuenta_creada`
- `cuenta_suspendida`
- `cuenta_reactivada`
- `cuenta_desactivada`
- `rol_asignado`
- `rol_revocado`
- `sesion_revocada`
