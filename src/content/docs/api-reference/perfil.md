---
title: Perfil del usuario
description: GET /api/auth/perfil — datos de la cuenta autenticada y del socio de negocio (BC01) vinculado.
---

> Para el formato de errores y envoltura de respuestas ver [Convenciones de la API](/api-reference/convenciones/).

## GET /api/auth/perfil

Devuelve la cuenta del usuario autenticado y, si la tiene vinculada, el socio de
negocio de BC01 con su snapshot completo (sede, cargo, área, cuentas y contratos).

| | |
|---|---|
| **Autenticación** | `Authorization: Bearer <accessToken>` de **usuario** |
| **Permiso** | Ninguno: basta un token válido |
| **Tokens de servicio (M2M)** | Rechazados con 403 |
| **Rate limit** | El general: 60 solicitudes por minuto por IP |

### Cómo identifica la cuenta

Por el **`sub` del JWT**, nunca por un parámetro de la URL o del body. Cada
usuario solo puede leer su propio perfil.

1. El guard verifica el token y toma `sub` como id de la cuenta.
2. Busca la cuenta por ese id (`identity.accounts`).
3. Busca el socio vinculado a esa cuenta (`socio_negocio.socio_links.account_id`).

Para leer la cuenta de **otro** usuario existe
[`GET /api/admin/cuentas/:id`](/api-reference/cuentas/), que devuelve la misma
forma pero exige `auth:account:read`.

### Request

```http
GET /api/auth/perfil
Authorization: Bearer <accessToken>
```

Sin parámetros ni body.

### Response 200 — cuenta con socio

```json
{
  "datos": {
    "id": "8c1d2e4f-a1b2-4c3d-9e5f-123456789abc",
    "email": "jperez@hagemsa.com",
    "nombreUsuario": "jperez",
    "nombreCompleto": "Juan Pérez",
    "tipoCuenta": "interno",
    "estado": "activo",
    "documentoIdentidad": "45678912",
    "codigoSocio": "JP",
    "codigoCuenta": "JP01",
    "createdAt": "2026-01-15T13:20:00.000Z",
    "updatedAt": "2026-05-26T16:45:12.123Z",
    "socio": {
      "socioExternoId": 1045,
      "tipo": "empleado",
      "nombre": "Juan Pérez Gómez",
      "documento": "45678912",
      "snapshot": {
        "personalId": 1045,
        "tipo": "PERSONAL",
        "razonSocial": "Juan Pérez Gómez",
        "documento": { "numeroDocumento": "45678912", "tipoDocumento": "DNI" },
        "numeroDocumento": "45678912",
        "primerNombre": "Juan",
        "segundoNombre": "",
        "apellidoPaterno": "Pérez",
        "apellidoMaterno": "Gómez",
        "nombreCompleto": "Juan Pérez Gómez",
        "correo": "juan.perez@gmail.com",
        "numeroCelular": "987654321",
        "contacto": "María Gómez",
        "direccion": "Av. Ejército 123, Arequipa",
        "asignacionVigente": {
          "asignacionId": 312,
          "cargoCodigo": "CAR-010",
          "cargoNombre": "Conductor",
          "sedeCodigo": "SED-001",
          "sedeNombre": "Arequipa",
          "areaCodigo": "ARE-004",
          "areaNombre": "Operaciones",
          "jefeCodigo": "PER-0021",
          "jefeNombre": "Carlos Ríos",
          "tipoRegimen": "GENERAL",
          "vigenteDesde": "2026-01-01T00:00:00.000Z",
          "vigenteHasta": null
        },
        "cuentasContratos": [
          {
            "id": 77,
            "tipo": "CUENTA",
            "configuracionCodigo": "CTA-0001",
            "configuracionNombre": "Minera Sur",
            "cuentaRaizCodigo": null,
            "cuentaRaizNombre": null,
            "nivelCuentaContrato": 1,
            "vigenteDesde": "2026-01-01T00:00:00.000Z",
            "vigenteHasta": null
          },
          {
            "id": 78,
            "tipo": "CONTRATO",
            "configuracionCodigo": "CON-0012",
            "configuracionNombre": "Transporte de concentrado",
            "cuentaRaizCodigo": "CTA-0001",
            "cuentaRaizNombre": "Minera Sur",
            "nivelCuentaContrato": 2,
            "vigenteDesde": "2026-01-01T00:00:00.000Z",
            "vigenteHasta": null
          }
        ]
      }
    }
  }
}
```

### Response 200 — cuenta sin socio

La clave `socio` **no aparece** (no viene como `null`):

```json
{
  "datos": {
    "id": "3e2d1c0b-9a8f-4e7d-8c6b-5a4f3e2d1c0b",
    "email": null,
    "nombreUsuario": "mlopez",
    "nombreCompleto": "María López",
    "tipoCuenta": "cliente",
    "estado": "activo",
    "documentoIdentidad": null,
    "codigoSocio": null,
    "codigoCuenta": null,
    "createdAt": "2026-02-03T09:10:00.000Z",
    "updatedAt": "2026-04-11T18:05:30.000Z"
  }
}
```

## Campos

### Cuenta (`datos`)

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | UUID | Id de la cuenta (el `sub` del JWT). |
| `email` | string \| null | Correo. `null` si la cuenta no tiene. Puede repetirse entre cuentas. |
| `nombreUsuario` | string | Llave de acceso. Única e inmutable. |
| `nombreCompleto` | string | Nombre de la cuenta en el auth (no el del socio). |
| `tipoCuenta` | string | `interno` \| `cliente` \| `proveedor`. |
| `estado` | string | `activo` \| `suspendido` \| `inactivo`. |
| `documentoIdentidad` | string \| null | Si hay socio vinculado, es el documento del socio y no se puede editar mientras dure el vínculo. |
| `codigoSocio`, `codigoCuenta` | string \| null | Códigos internos para PDFs. **No tienen relación con BC01.** Van juntos o ninguno. |
| `createdAt`, `updatedAt` | ISO 8601 | Fechas de la cuenta. |
| `socio` | objeto | Solo si la cuenta tiene socio vinculado. |

### Socio (`datos.socio`)

| Campo | Tipo | Origen | Descripción |
|---|---|---|---|
| `socioExternoId` | number | Vínculo | Id del socio en BC01. No es único entre tipos: personal, cliente y proveedor tienen secuencias separadas. |
| `tipo` | string | Vínculo | `empleado` \| `cliente` \| `proveedor` (formato del auth, no el de BC01). |
| `documento` | string | Vínculo | Documento normalizado (sin espacios, en mayúsculas). Junto con `tipo` identifica al socio. |
| `nombre` | string \| null | Snapshot | `nombreCompleto`, o los nombres y apellidos unidos. |
| `snapshot` | objeto \| null | Snapshot | Objeto de BC01 guardado al vincular. Ver abajo. |

### Snapshot (`datos.socio.snapshot`)

Es el objeto de `GET /socios-activos` de BC01 que el frontend envió al vincular,
tal cual se guardó. Al vincular solo se guardan estas claves; el resto se descarta:

`personalId`, `id`, `tipo`, `estado`, `razonSocial`, `nombreCompleto`,
`primerNombre`, `segundoNombre`, `apellidoPaterno`, `apellidoMaterno`,
`numeroDocumento`, `documento`, `cuentasContratos`, `asignacionVigente`,
`asignaciones`, `correo`, `numeroCelular`, `contacto`, `direccion`.

El contenido de cada clave no se valida: se guarda con la estructura que traiga.

**`asignacionVigente`** (solo personal; `null` para clientes y proveedores):

| Campo | Descripción |
|---|---|
| `sedeCodigo`, `sedeNombre` | Sede del trabajador. |
| `cargoCodigo`, `cargoNombre` | Cargo. |
| `areaCodigo`, `areaNombre` | Área. |
| `jefeCodigo`, `jefeNombre` | Jefe directo. |
| `tipoRegimen` | Régimen laboral. |
| `vigenteDesde`, `vigenteHasta` | Vigencia de la asignación. `vigenteHasta: null` = sin fecha de fin. |

**`cuentasContratos[]`**:

| Campo | Descripción |
|---|---|
| `tipo` | `CUENTA` \| `CONTRATO`. |
| `configuracionCodigo`, `configuracionNombre` | Código y nombre de la cuenta o contrato. |
| `cuentaRaizCodigo`, `cuentaRaizNombre` | Cuenta a la que pertenece un contrato. `null` en las cuentas. |
| `nivelCuentaContrato` | 1 para la cuenta raíz; crece hacia abajo. |
| `vigenteDesde`, `vigenteHasta` | Vigencia de la asignación de esa cuenta o contrato. |

## Errores

| Status | `codigo` | Cuándo |
|---|---|---|
| 401 | `COMUN_NO_AUTENTICADO` | Sin Bearer, firma inválida o token expirado. |
| 401 | `COMUN_NO_AUTENTICADO` | Sesión revocada (el `jti` está en la blacklist). |
| 403 | `COMUN_SIN_PERMISO` | Se envió un token de servicio (M2M). |
| 404 | `AUTH_CUENTA_NO_ENCONTRADA` | La cuenta del token ya no existe. |

## A tener en cuenta

- **El snapshot es una foto del día del vínculo.** Si en BC01 cambian la sede,
  el cargo o las cuentas del trabajador, el perfil sigue mostrando lo anterior
  hasta que un admin llame a `POST /api/admin/cuentas/:id/cambiar-socio` con el
  mismo socio y el objeto actualizado.
- **No se filtra por vigencia.** Una asignación o cuenta vencida sigue
  apareciendo; hay que comparar `vigenteHasta` con la fecha actual. El JWT, en
  cambio, solo lleva en `socioCuentas` lo vigente al emitirse.
- **Vínculos antiguos.** Los creados antes de usar `/socios-activos` pueden
  traer las cuentas dentro de `asignaciones[].cuentasContratos` en vez de en la
  raíz, no traer `asignacionVigente`, o traer claves fuera de la lista de arriba
  (se guardaron sin filtrar).
- **Contacto.** El frontend aplana `correo`, `numeroCelular`, `contacto` y
  `direccion` a la raíz al vincular; en BC01 vienen anidados en `contacto`.
  Leer ambas formas.
- **Fechas de vigencia.** BC01 las envía a medianoche UTC. Formatearlas con
  `timeZone: "UTC"`; en hora de Perú se verían un día antes.

## Diferencias con el JWT

| Dato | Perfil | JWT |
|---|---|---|
| Roles y permisos | No | Sí (`roles`) |
| Sede, cargo, área, jefe | Sí (en el snapshot) | No |
| Contacto del socio | Sí (en el snapshot) | No |
| Cuentas y contratos | Todas las del snapshot, con vigencia | Solo las vigentes, agrupadas (`socioCuentas`) |
| Frescura | Lee la base en cada llamada | Lo del momento del login o refresh |

## Relacionados

- [`PATCH /api/auth/perfil/codigos`, `PATCH /api/auth/perfil/password` y `PATCH /api/auth/perfil/email`](/api-reference/auth/#perfil-self-service)
- [`GET /api/admin/cuentas/:id`](/api-reference/cuentas/) — mismo formato para cualquier cuenta (admin).
- [Datos del usuario en el token](/integracion/datos-del-usuario/)
