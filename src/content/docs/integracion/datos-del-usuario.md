---
title: Datos del usuario y del socio de negocio
description: Cómo leer el payload del usuario autenticado con @CurrentUser() y qué significa cada campo del socio de negocio (BC01).
---

Esta guía es para los backends que necesitan saber **quién es el usuario** y **a qué cuentas y contratos tiene acceso** (por ejemplo, CS Operaciones). Todo sale del JWT que emite el Auth Service, ya verificado por `@hagemsa/auth-guard`.

## Cómo obtener los datos

### Con el decorador `@CurrentUser()` (la forma correcta)

`@hagemsa/auth-guard` ya decodifica **y verifica** el token: firma, `iss`, `aud`, expiración y revocación (blacklist). El resultado queda en el request y se lee con `@CurrentUser()`, que devuelve un `AuthContext`:

```typescript
import { Controller, Get } from '@nestjs/common';
import { CurrentUser, type AuthContext } from '@hagemsa/auth-guard';

@Controller('operaciones')
export class OperacionesController {
  @Get('mis-cuentas')
  misCuentas(@CurrentUser() user: AuthContext) {
    return { datos: user.socioCuentas ?? [] };
  }
}
```

Requisitos (ver [Instalación](/integracion/instalacion/) y [Configuración](/integracion/configuracion/)):

- `AuthGuardModule.forRoot({ jwksUrl, issuer, audience, ... })` en el `AppModule`.
- `JwtAuthGuard` registrado como guard global (`APP_GUARD` con `useExisting`).
- Sin el guard, `@CurrentUser()` devuelve `undefined`.

### Lo que NO hay que hacer

- **No decodificar el JWT a mano** (`jwt-decode`, `Buffer.from(...)`, etc.). Decodificar no es verificar: un token alterado, vencido o revocado pasaría igual.
- **No usar `GET /api/auth/sesion`** para obtener los datos del socio. Ese endpoint existe para que el frontend valide su sesión y solo devuelve `id`, `email`, `nombre`, `tipo` y `roles`. No incluye ningún campo del socio.

### Versión de la librería

| Versión | `socioCuentas` |
|---|---|
| `0.6.0` | Lista plana `{ codigo, nombre, tipo }[]`. **Obsoleta.** |
| `0.7.0` | Cuentas con sus contratos anidados (la forma descrita en esta guía). |

Los consumidores nuevos deben usar `"@hagemsa/auth-guard": "^0.7.0"`. Con `^0.6.0` npm/pnpm no sube a `0.7.0` (en versiones `0.x` el caret no cruza de minor), así que hay que cambiarlo a mano.

## Ejemplo de `AuthContext`

Usuario interno vinculado a un empleado de BC01:

```json
{
  "accountId": "8c1d4b2e-7f3a-4d9b-a6e2-1b5c9f0d3a71",
  "email": "juan.perez@hagemsa.com",
  "username": "jperez",
  "type": "interno",
  "name": "JUAN PEREZ QUISPE",
  "jti": "3f6c2a1e-8b4d-4e7a-9c11-5d2f0a7b9e34",
  "roles": [
    { "role": "OPERACIONES_SUPERVISOR", "scope": {}, "permisos": ["ops:despachos:ver"] }
  ],
  "expiresAt": "2026-10-19T15:15:00.000Z",
  "tokenUse": "user",
  "codigoSocio": "EMP001",
  "codigoCuenta": "CTA001",
  "socioExternoId": 1291,
  "socioTipo": "empleado",
  "socioNombre": "JUAN PEREZ QUISPE",
  "socioDocumento": "76680742",
  "socioCuentas": [
    {
      "codigo": "CTA-0001",
      "nombre": "CERRO VERDE",
      "asignada": true,
      "contratos": [
        { "codigo": "CON-0010", "nombre": "CONTRATO SUR" },
        { "codigo": "CON-0042", "nombre": "SUBCONTRATO MANTENIMIENTO" }
      ]
    },
    {
      "codigo": "CTA-0002",
      "nombre": "ANTAPACCAY",
      "asignada": false,
      "contratos": [
        { "codigo": "CON-0020", "nombre": "CONTRATO TRANSPORTE" }
      ]
    }
  ]
}
```

## Campos de la cuenta (Auth Service)

| Campo | Tipo | Significado |
|---|---|---|
| `accountId` | `string` | Id de la cuenta en el Auth Service (UUID). En el JWT es `sub`. |
| `email` | `string` | Email de la cuenta. Vacío en tokens de servicio. |
| `username` | `string?` | Nombre de usuario: la llave con la que inicia sesión. Ausente en tokens de servicio. |
| `type` | `string` | Tipo de cuenta: `interno`, `cliente` o `proveedor`. |
| `name` | `string` | Nombre completo de la cuenta. |
| `roles` | `RolAutenticado[]` | Roles con su `scope` y sus `permisos` ya resueltos por el guard. |
| `tokenUse` | `'user' \| 'service'` | `service` en tokens M2M; ahí no hay usuario ni socio. |
| `codigoSocio`, `codigoCuenta` | `string?` | Códigos internos de la cuenta para PDFs. **No tienen relación con el socio de BC01** ni con `socioCuentas`. Vienen los dos o ninguno. |

## Campos del socio de negocio (BC01)

Todos son opcionales: **solo vienen si la cuenta está vinculada a un socio de BC01**. Si `socioExternoId` no viene, la cuenta no tiene socio y ningún otro campo `socio*` viene.

| Campo | Tipo | De dónde sale | Significado |
|---|---|---|---|
| `socioExternoId` | `number` | Vínculo | Id del socio en BC01. **No es único por sí solo**: el mismo número se repite entre las tablas de personal, cliente y proveedor. Usarlo siempre junto con `socioTipo`. |
| `socioTipo` | `'empleado' \| 'cliente' \| 'proveedor'` | Vínculo | Tipo del socio en BC01. `empleado` corresponde a `PERSONAL` en BC01. |
| `socioDocumento` | `string` | Vínculo | DNI (empleado) o RUC (cliente/proveedor), normalizado: sin espacios y en mayúsculas. Es la **clave estable** del socio y sirve para autorizar. |
| `socioNombre` | `string?` | Snapshot | Nombre del socio para mostrar (razón social o nombre completo). Solo display. |
| `socioCuentas` | `SocioCuentaJwt[]?` | Snapshot | Cuentas y contratos de BC01 vigentes del socio. Ver abajo. |

"Vínculo" es el registro que une la cuenta con el socio; se valida al vincular. "Snapshot" es la copia de los datos de BC01 tomada al momento de vincular.

## `socioCuentas` en detalle

```typescript
interface SocioCuentaJwt {
  codigo: string | null;   // 'CTA-0001'
  nombre: string | null;   // 'CERRO VERDE'
  asignada: boolean;
  contratos: { codigo: string; nombre: string }[]; // 'CON-0010'
}
```

### Qué representa

- **Una entrada por cuenta**, con **todos sus contratos** adentro, de cualquier nivel. Un subcontrato (contrato que cuelga de otro contrato) aparece bajo su cuenta raíz, igual que los demás.
- **El `codigo` es el identificador.** Lo genera Configuración General con una secuencia (`CTA-####` para cuentas, `CON-####` para contratos) y nunca se reutiliza. No hay un id numérico en el claim.
- Comparar códigos en mayúsculas y sin espacios, que es como los guarda Configuración General.

### `asignada`

En BC01 a una persona se le puede asignar una cuenta completa **o solo uno o más contratos** de esa cuenta.

| `asignada` | Significa | Acceso que corresponde |
|---|---|---|
| `true` | La persona tiene asignada **la cuenta**. | Toda la cuenta, incluidos sus contratos. |
| `false` | La persona **solo** tiene los contratos listados. La cuenta aparece para agruparlos. | **Solo** esos contratos, no toda la cuenta. |

### Grupo sin cuenta (`codigo: null`)

Si BC01 guardó un contrato sin poder resolver su cuenta raíz (pasa cuando su copia de Configuración General todavía no tenía ese contrato), ese contrato va en un grupo con `codigo: null` y `nombre: null`, siempre **al final**. Sus contratos son válidos; solo se desconoce su cuenta.

### Cuándo viene y cuándo no

- **Solo vienen asignaciones vigentes**: BC01 entrega las `VIGENTE` y `APROBADO`, y el Auth Service descarta además las que vencieron por fecha (`vigenteDesde`/`vigenteHasta`).
- La vigencia se evalúa **cada vez que se emite el token** (login y cada refresh). Un cambio en BC01 (asignación nueva o retirada) no se ve hasta que el vínculo del socio se actualiza en el Auth Service.
- **Solo los empleados tienen cuentas y contratos.** Para `socioTipo` `cliente` o `proveedor`, `socioCuentas` no viene.
- **Nunca llega como lista vacía.** Si no hay ninguna cuenta ni contrato vigente, el campo no viene: `socioCuentas === undefined` es el único caso de "sin cuentas".

## Ejemplo: autorizar por cuenta o contrato

```typescript
import { ForbiddenException } from '@nestjs/common';
import type { AuthContext } from '@hagemsa/auth-guard';

const normalizar = (codigo: string) => codigo.trim().toUpperCase();

/** ¿El usuario puede ver TODA la cuenta? Solo si la tiene asignada. */
export function puedeVerCuenta(user: AuthContext, codigoCuenta: string): boolean {
  const codigo = normalizar(codigoCuenta);
  return (user.socioCuentas ?? []).some(
    (c) => c.asignada && c.codigo === codigo,
  );
}

/** ¿El usuario tiene el contrato asignado (directo o como parte de su cuenta)? */
export function puedeVerContrato(user: AuthContext, codigoContrato: string): boolean {
  const codigo = normalizar(codigoContrato);
  return (user.socioCuentas ?? []).some((c) =>
    c.contratos.some((k) => k.codigo === codigo),
  );
}

/** Códigos de contrato que el usuario puede consultar, para filtrar listados. */
export function contratosPermitidos(user: AuthContext): string[] {
  return (user.socioCuentas ?? []).flatMap((c) => c.contratos.map((k) => k.codigo));
}

// En un handler:
// if (!puedeVerCuenta(user, codigo)) throw new ForbiddenException('No tienes acceso a esta cuenta.');
```

Nota sobre `puedeVerContrato`: el claim lista solo los contratos **vigentes asignados** a la persona en BC01. Si la regla de negocio es "quien tiene la cuenta (`asignada: true`) ve también los contratos que no están en la lista", esa regla la decide el consumidor; el claim no trae los demás contratos de la cuenta.

### Usar los códigos contra Configuración General

Los códigos del claim se envían tal cual a Configuración General (ver su `docs/api/api-cs-operaciones.md`):

```
GET /api/configuracion-general/cuentas-contratos/codigo/CON-0010/proyectos
GET /api/configuracion-general/costos-operativos/opciones?rutaId=2&cuentaContratoCodigo=CON-0010&fecha=2026-10-15
```

Aceptan tanto códigos de cuenta (`CTA-`) como de contrato (`CON-`), sin distinguir mayúsculas. Los proyectos pertenecen a la cuenta raíz: para un contrato se listan los de su cuenta.

## Tokens de servicio (M2M)

Con `tokenUse === 'service'` no hay usuario: `email`, `name` y `type` son `''`, no viene ningún campo `socio*` y `clientId` identifica al backend que llama. Para endpoints que dependen del socio, usar `@UserOnly()` y así rechazar tokens de servicio.
