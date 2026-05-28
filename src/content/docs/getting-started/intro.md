---
title: Qué es el Auth Service
description: Visión general del servicio de autenticación centralizado de HAGEMSA.
---

El Auth Service de HAGEMSA es un microservicio que **centraliza** la autenticación y autorización para todo el ecosistema de aplicaciones de Transportes HAGEMSA SAC.

## Problema que resuelve

Antes de tener un Auth Service, cada backend (WMS, despachos, facturación, vision AI, etc.) implementaba su propia autenticación. Esto generaba:

- **Inconsistencia** — distintas políticas de password, distintos formatos de JWT, distintas reglas de roles.
- **Imposibilidad de logout global** — cerrar sesión en un backend no afectaba a los demás.
- **Duplicación de catálogo de usuarios** — los mismos empleados existían en 4 bases de datos distintas.
- **Auditoría fragmentada** — saber "quién accedió a qué" requería juntar logs de 5 sistemas.

## Solución

Un solo servicio dueño de la identidad. Los demás backends solo **verifican** los JWT que este servicio emite.

```
┌────────────┐  POST /api/auth/login    ┌──────────────────┐
│  Cliente   │ ───────────────────► │   Auth Service   │
│ (browser,  │ ◄─────────────────── │  (este servicio) │
│  mobile)   │   accessToken + refresh   └──────────────────┘
└────────────┘                                  ▲
       │                                        │ valida firma
       │  GET /api/...                          │ (JWKS público)
       │  Authorization: Bearer <accessToken>   │
       ▼                                        │
┌────────────────────────────────────────────────┴───┐
│  Backends del ecosistema (WMS, Despachos, ...)     │
│  Validan el JWT con la lib @hagemsa/auth-guard     │
└────────────────────────────────────────────────────┘
```

## Qué hace y qué no hace

### Sí hace

- Autentica con email + password (Argon2id).
- Emite JWT firmados con RSA 2048 (RS256).
- Rota refresh tokens y detecta reuso (revoca toda la familia).
- Gestiona roles, permisos y scopes (RBAC + ABAC ligero).
- Audita eventos sensibles (login, logout, cambios de password, asignación de roles).
- Expone JWKS público para que cualquier backend valide firmas sin compartir secretos.

### No hace

- **No autoriza por sí mismo.** Solo emite el JWT con los roles del usuario. Cada backend decide qué hacer con eso (usando `@hagemsa/auth-guard`).
- **No es un IdP federado.** No soporta SSO con Google/Microsoft (aún). Solo email + password local.
- **No gestiona perfiles ricos.** Solo guarda lo mínimo (email, nombre, documento, tipo de cuenta). Datos de RRHH viven en otro lugar.
- **No es event-bus.** Los backends descubren cambios vía blacklist + cache, no por pub/sub.

## Qué viene siguiente en estas docs

- [Conceptos clave](/getting-started/conceptos/) — JWT, RBAC, scopes, refresh rotation, fail-closed.
- [Glosario del dominio](/getting-started/glosario/) — Ubiquitous Language usado en el código.
- [Integrar un backend](/integracion/vision-general/) — para devs que conectan otro servicio.
- [Arquitectura](/arquitectura/vision-general/) — para devs que mantienen el Auth Service.
