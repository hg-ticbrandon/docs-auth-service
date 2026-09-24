---
title: Estándar de implementación en los backends del ERP
description: Cómo debe quedar implementado el auth en cada backend del ERP, con las reglas verificables y los comandos para auditarlas.
---

Todos los backends del ERP son NestJS con la misma arquitectura DDD, así que el
auth se implementa igual en todos. Esta página es el **estándar**: qué tiene que
estar, cómo se verifica que está, y qué hacer cuando no está.

Las otras páginas de esta sección enseñan cada pieza por separado —cómo se
instala, cómo se configura, cómo se protege un endpoint—. Esta dice cómo tiene
que **quedar** el backend cuando terminaste, y cómo demostrarlo.

La referencia es **`bc03-comercial`**. Los ejemplos y las mediciones de esta
página salen de auditarlo el 2026-09-24.

## Las ocho reglas

| # | Regla | Cómo se verifica |
| --- | --- | --- |
| 1 | El guard es global | `grep -rn "APP_GUARD\|useGlobalGuards" src/` |
| 2 | Cada `@Public()` tiene justificación escrita | Revisión manual de los 3 casos legítimos |
| 3 | Cero endpoints autenticados sin `@RequirePermission` | Script de la regla 3 |
| 4 | Todos los permisos existen en el catálogo del Auth Service | Script de la regla 4 |
| 5 | Los códigos de permiso siguen la convención `bcNN:recurso:accion` | Script de la regla 5 |
| 6 | La versión de `auth-guard` es la última publicada | `grep auth-guard package.json` |
| 7 | La configuración está completa y alineada con el Auth Service | Script de la regla 7 |
| 8 | El pipeline de build puede traer el paquete privado | `grep GOOGLE_NPM_TOKEN Dockerfile cloudbuild.yaml` |

---

## Regla 1 — El guard es global

**Todo endpoint exige un JWT válido por defecto.** La excepción es explícita y se
marca con `@Public()`. Nunca al revés: proteger endpoint por endpoint deja huecos
por olvido, y el olvido no se ve en code review.

Hay dos formas de registrarlo y **las dos son válidas** —dan inyección de
dependencias y cubren toda la app—, pero elegí una y no las mezclés dentro del
mismo backend.

**Forma A — en `main.ts`** (la que usa `bc03-comercial`):

```ts
import { JwtAuthGuard } from '@hagemsa/auth-guard';

const app = await NestFactory.create(AppModule);
app.useGlobalGuards(app.get(JwtAuthGuard));
```

**Forma B — como `APP_GUARD` en el módulo raíz** (la que usa
`bc14-cs-configuracion-general`):

```ts
import { APP_GUARD } from '@nestjs/core';

@Module({
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule {}
```

La forma A es la recomendada para backends nuevos: el registro queda a la vista
en el arranque, junto al `ValidationPipe` y los filtros, en vez de perdido entre
los `providers` de un módulo.

:::caution[Lo que NO cuenta como guard global]
`@UseGuards(JwtAuthGuard)` en cada controlador. Funciona, pero es opt-in: el
controlador nuevo que alguien agregue el mes que viene queda desprotegido y nada
lo señala.
:::

---

## Regla 2 — Cada `@Public()` tiene justificación escrita

`@Public()` saltea el guard por completo. Cada uso tiene que tener un comentario
arriba explicando por qué, y caer en una de estas tres categorías:

**Health check.** `/health` para Cloud Run. Sin datos de negocio en la respuesta.

**Endpoint push de Pub/Sub.** Pub/Sub no manda un JWT de usuario, manda su propio
token OIDC. Entonces `@Public()` saltea el guard de usuario **y en su lugar va
otro guard**:

```ts
@Public()
@Controller('pubsub')
@UseGuards(PubSubOidcGuard)
export class UbicacionesConfirmadasPushController {}
```

`@Public()` sin un guard alternativo en un endpoint que recibe datos es un agujero
abierto: cualquiera en internet puede inyectar.

**Acceso por token de un solo uso.** El portal donde un cliente responde una
cotización sin estar logueado. La autenticación es el token de la URL, que tiene
que ser aleatorio criptográficamente, tener vencimiento y no ser adivinable.

Cualquier otro caso: no va `@Public()`.

---

## Regla 3 — Cero endpoints autenticados sin `@RequirePermission`

Un endpoint que exige JWT pero no exige permiso deja entrar a **cualquier usuario
autenticado del ERP**, sin importar su rol. Es el hueco más fácil de dejar, porque
el endpoint "funciona" en las pruebas: quien prueba está logueado.

La regla: **todo endpoint tiene `@RequirePermission`, salvo los `@Public()`**.

```bash
# Lista los controladores donde hay menos permisos que endpoints.
# Los unicos que deben aparecer son los que tienen @Public().
for f in $(find src -name "*.controller.ts" -not -name "*.spec.ts" | sort); do
  eps=$(grep -cE "^\s*@(Get|Post|Put|Patch|Delete)\(" "$f")
  perms=$(grep -c "@RequirePermission" "$f")
  pub=$(grep -c "@Public()" "$f")
  if [ "$eps" -gt 0 ] && [ "$perms" -lt "$eps" ]; then
    echo "$f  endpoints=$eps permisos=$perms publicos=$pub"
  fi
done
```

En `bc03-comercial` esto devuelve exactamente tres controladores, y los tres son
los públicos de la regla 2. Ese es el resultado esperado.

---

## Regla 4 — Todos los permisos existen en el catálogo

Si un endpoint exige `bc06:viaje:leer` y ese permiso no está en el catálogo del
Auth Service, **nadie puede acceder nunca**: no hay forma de asignárselo a un rol.
El endpoint devuelve 403 para todo el mundo, incluido el administrador, y el
síntoma no dice cuál es la causa.

Esto se verifica cruzando el código contra la base del Auth Service:

```bash
# 1) En el repo del backend: extraer los permisos que exige.
#    OJO con excluir los .spec.ts POR RUTA y no con `grep -v spec`:
#    la palabra "prospecto" contiene "spec" y te come esos permisos.
find src -name "*.ts" -not -name "*.spec.ts" -print0 \
  | xargs -0 grep -ho "@RequirePermission([\"'][^\"']*[\"']" \
  | sed "s/.*@RequirePermission([\"']//;s/[\"'].*//" | sort -u
```

```sql
-- 2) En la base del Auth Service: el catalogo de ese backend.
SELECT code FROM "authorization".permissions
 WHERE code LIKE 'bc03:%' ORDER BY code;
```

Los del código tienen que estar **todos** en el catálogo. Al revés no: puede
haber permisos en el catálogo que el código todavía no use (funcionalidad
planificada, o un job que no expone HTTP). Eso no es un error, pero conviene
saber cuáles son antes de repartirlos en un rol.

En `bc03-comercial`: 35 permisos exigidos, 35 existen, 0 faltantes. Sobran dos en
el catálogo (`bc03:cotizacion:vencer` y `bc03:crm:asignar`).

---

## Regla 5 — Convención de los códigos de permiso

```
bcNN:recurso:accion
```

Todo en minúsculas. El prefijo identifica al backend, el recurso es singular, y
la acción es un verbo del dominio.

| Parte | Regla | Ejemplos |
| --- | --- | --- |
| Prefijo | `bc` + número del bounded context | `bc03`, `bc06`, `bc14` |
| Recurso | singular, kebab-case si son varias palabras | `cotizacion`, `tipo-unidad` |
| Acción | verbo, en español | `leer`, `escribir`, `eliminar`, `restaurar`, `cerrar`, `resolver` |

```
bc03:cotizacion:leer        ✓
bc03:tipo-unidad:escribir   ✓
bc03:aprobacion:resolver    ✓

bc03:cotizaciones:leer      ✗  recurso en plural
BC03:cotizacion:leer        ✗  mayusculas
bc03:cotizacion:read        ✗  accion en ingles
bc03_cotizacion_leer        ✗  el separador es ':'
```

El validador del Auth Service acepta
`/^[a-z][a-z0-9-]*(:[a-z][a-z0-9-]*){1,2}$/`, así que un guion bajo o una
mayúscula se rechazan al crear el permiso, no al usarlo.

`leer` y `escribir` cubren la mayoría. Un verbo propio se justifica cuando la
acción es de negocio y alguien podría tenerla sin tener `escribir` —`resolver`
una aprobación, `cerrar` una cotización— no para cada endpoint.

---

## Regla 6 — Versión de la librería

Siempre la última publicada. Hoy es la **0.6.0**.

```json
"@hagemsa/auth-guard": "0.6.0"
```

:::danger[El caret no sirve en `0.x`]
`^0.4.0` **nunca** va a traer la 0.5.0 ni la 0.6.0: en versiones `0.x` el caret
no cruza minors. Hay que fijar la versión exacta o escribir el minor nuevo a
mano. Por esto hubo backends parados en 0.4.0 durante dos meses sin que nadie lo
notara.
:::

Ver [Versiones de auth-guard](/versiones/auth-guard/) para qué trae cada una. En
particular, la **0.5.0 es endurecimiento de seguridad**: un backend que se la
saltee arrastra tres problemas conocidos.

Actualizar es cambiar la línea, `pnpm install`, correr el gate y desplegar. No
hay orden obligatorio entre backends: conviven versiones distintas.

---

## Regla 7 — Configuración completa y alineada

```ts
AuthGuardModule.forRoot({
  jwksUrl: process.env.AUTH_JWKS_URL ?? AUTH_DEFAULTS.jwksUrl,
  issuer: process.env.AUTH_JWT_ISSUER ?? AUTH_DEFAULTS.issuer,
  audience: process.env.AUTH_JWT_AUDIENCE ?? AUTH_DEFAULTS.audience,
  authServiceUrl: process.env.AUTH_SERVICE_URL ?? AUTH_DEFAULTS.authServiceUrl,
  internalSecret: process.env.AUTH_INTERNAL_SECRET,
}),
```

El patrón `env ?? DEFAULT` es deliberado: el backend arranca en cualquier entorno
sin declarar cada variable, y el entorno puede pisar lo que necesite. Los
defaults viven en una constante del propio backend:

```ts
export const AUTH_DEFAULTS = {
  jwksUrl: 'https://auth.hagemsa.com/.well-known/jwks.json',
  issuer: 'https://auth.hagemsa.com',
  audience: 'hagemsa-backends',
  authServiceUrl: 'https://auth.hagemsa.com',
} as const;
```

**`issuer` y `audience` tienen que coincidir exactamente con lo que el Auth
Service emite.** Si no coinciden, se rechazan TODOS los tokens y el síntoma es un
401 universal que parece un problema de credenciales:

```bash
gcloud run services describe auth-service --region=us-central1 \
  --format="value(spec.template.spec.containers[0].env)" \
  | tr ';' '\n' | grep -E "JWT_ISSUER|JWT_AUDIENCE"
```

**`AUTH_INTERNAL_SECRET` tiene que ser idéntico al `INTERNAL_SHARED_SECRET` del
Auth Service.** Si el Auth lo tiene definido y el backend no manda el header, las
llamadas internas devuelven 401. Se compara sin exponer ninguno de los dos:

```bash
BACKEND=$(gcloud run services describe <servicio> --region=us-central1 --format=json \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);
    process.stdout.write((j.spec.template.spec.containers[0].env||[])
      .find(x=>x.name==='AUTH_INTERNAL_SECRET')?.value ?? '')})")
AUTH=$(gcloud secrets versions access latest --secret=internal-shared-secret)
node -e "const c=require('crypto');const h=x=>c.createHash('sha256').update(x).digest('hex').slice(0,12);
  console.log('backend:',h(process.argv[1]),'| auth:',h(process.argv[2]));
  console.log(process.argv[1]===process.argv[2]?'COINCIDEN':'NO COINCIDEN')" "$BACKEND" "$AUTH"
```

### M2M, solo si el backend llama a otros

```ts
...(process.env.SVC_CLIENT_ID && process.env.SVC_CLIENT_SECRET
  ? [AuthGuardModule.forServiceClient({
      authServiceUrl: process.env.AUTH_SERVICE_URL ?? AUTH_DEFAULTS.authServiceUrl,
      clientId: process.env.SVC_CLIENT_ID,
      clientSecret: process.env.SVC_CLIENT_SECRET,
    })]
  : []),
```

El condicional importa: sin credenciales el módulo no se registra y el backend
arranca igual, en vez de reventar en un entorno donde no hace falta M2M.

### Variables de entorno

| Variable | Obligatoria | Para qué |
| --- | --- | --- |
| `AUTH_SERVICE_URL` | Sí en producción | Base del Auth Service. Cae al default si falta. |
| `AUTH_INTERNAL_SECRET` | Sí si el Auth lo exige | Header `X-Internal-Secret` de las llamadas internas. |
| `AUTH_JWKS_URL` | No | Pisa el default. |
| `AUTH_JWT_ISSUER` | No | Pisa el default. |
| `AUTH_JWT_AUDIENCE` | No | Pisa el default. |
| `SVC_CLIENT_ID` | Solo con M2M | Identidad del backend como cliente de servicio. |
| `SVC_CLIENT_SECRET` | Solo con M2M | Debe ir desde Secret Manager, nunca como variable plana. |

---

## Regla 8 — El build puede traer el paquete privado

`@hagemsa/auth-guard` vive en un Artifact Registry privado, así que el build
necesita un token de vida corta. Tres piezas, y si falta una el build falla con
un 401 que parece un problema de red.

**`.npmrc` en la raíz del repo**, y **fuera** del `.dockerignore`:

```ini
@hagemsa:registry=https://us-central1-npm.pkg.dev/hagemsa-cloud/hagemsa-npm/
//us-central1-npm.pkg.dev/hagemsa-cloud/hagemsa-npm/:_authToken=${GOOGLE_NPM_TOKEN}
//us-central1-npm.pkg.dev/hagemsa-cloud/hagemsa-npm/:always-auth=true
```

**`Dockerfile`** que reciba el token como build-arg y copie el `.npmrc`:

```dockerfile
ARG GOOGLE_NPM_TOKEN
ENV GOOGLE_NPM_TOKEN=${GOOGLE_NPM_TOKEN}
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
```

**`cloudbuild.yaml`** que lo genere fresco en cada build:

```yaml
steps:
  - id: token
    name: gcr.io/google.com/cloudsdktool/cloud-sdk
    entrypoint: bash
    args: ["-c", "gcloud auth print-access-token > /workspace/npm_token"]

  - id: build
    name: gcr.io/cloud-builders/docker
    entrypoint: bash
    args:
      - -c
      - |
        docker build \
          --build-arg GOOGLE_NPM_TOKEN="$$(cat /workspace/npm_token)" \
          -t "${_IMAGE}:${_TAG}" .
```

El token dura aproximadamente una hora, así que se genera en cada build y nunca
se commitea. Va en una etapa intermedia del multi-stage: no llega a la imagen
final.

El detalle completo, con los errores comunes, está en
[Desplegar a Cloud Run](/integracion/deploy-consumidor/).

---

## Auditar un backend de punta a punta

El orden en que conviene hacerlo, porque cada paso descarta causas del siguiente.

```bash
# 1. Version de la libreria
grep -o '"@hagemsa/auth-guard": *"[^"]*"' package.json

# 2. El guard es global
grep -rn "APP_GUARD\|useGlobalGuards" src/ | grep -v "\.spec\."

# 3. Los @Public(), uno por uno
grep -rn -B 3 "@Public()" src/ --include=*.ts | grep -v "\.spec\."

# 4. Endpoints sin permiso (solo deben salir los publicos)
for f in $(find src -name "*.controller.ts" -not -name "*.spec.ts"); do
  eps=$(grep -cE "^\s*@(Get|Post|Put|Patch|Delete)\(" "$f")
  perms=$(grep -c "@RequirePermission" "$f")
  [ "$eps" -gt 0 ] && [ "$perms" -lt "$eps" ] && echo "$f  endpoints=$eps permisos=$perms"
done

# 5. Permisos exigidos (cruzar contra el catalogo del Auth Service)
find src -name "*.ts" -not -name "*.spec.ts" -print0 \
  | xargs -0 grep -ho "@RequirePermission([\"'][^\"']*[\"']" \
  | sed "s/.*@RequirePermission([\"']//;s/[\"'].*//" | sort -u

# 6. El pipeline
grep -n "GOOGLE_NPM_TOKEN" Dockerfile cloudbuild.yaml .npmrc

# 7. El gate, con la version nueva instalada
pnpm build && pnpm test
```

### Qué mirar en el gate

`pnpm build` es lo que decide si el deploy funciona: `tsconfig.build.json`
excluye `**/*spec.ts` y `test/`, así que un error de tipo en un spec **no**
bloquea el despliegue. Por eso `tsc --noEmit` sobre todo el proyecto puede tirar
cientos de errores con el build en verde.

Eso no es excusa para dejarlos: `ts-jest` tampoco falla por errores de tipo, así
que un mock mal tipado pasa los tests y nadie se entera hasta que el tipo cambia
de verdad.

---

## Estado de los backends

Medido el **2026-09-24** leyendo el `package.json` y el `src/` de cada repo.

| Backend | auth-guard | Guard | `@Public` | Permisos |
| --- | --- | --- | --- | --- |
| `bc03-comercial` | 0.6.0 | global (`main.ts`) | 3 controladores | 35, todos en el catálogo |
| `bc-06` operaciones | 0.4.0 | global (`main.ts`) | 11 usos | 48 usos |
| `bc14-cs-configuracion-general` | 0.4.0 | global (`APP_GUARD`) | 3 usos | 60 usos |
| `bc04-flota` | no usa | — | — | — |
| `hg-evaluaciones-bk` | no usa | — | — | — |

`bc03-comercial` es el único que cumple las ocho reglas y está auditado de punta
a punta. Los demás están pendientes de revisar contra este estándar.

Que `bc04-flota` y `hg-evaluaciones-bk` no dependan de `auth-guard` puede ser
correcto —un servicio interno sin HTTP expuesto al usuario no lo necesita— pero
hay que confirmarlo, no asumirlo.

---

## Errores que se repiten

**Un endpoint devuelve 403 para todo el mundo, incluido el administrador.** El
permiso que exige no existe en el catálogo. Regla 4.

**Todos los tokens se rechazan con 401 después de un cambio de configuración.**
`issuer` o `audience` no coinciden con lo que el Auth Service emite. Regla 7.

**Las llamadas internas devuelven 401 pero los endpoints normales funcionan.**
`AUTH_INTERNAL_SECRET` no coincide con el del Auth Service. Regla 7.

**El build falla con 401 al instalar dependencias.** Falta el `.npmrc`, o está en
el `.dockerignore`, o el token no se pasó como build-arg. Regla 8.

**`pnpm install` no trae la versión nueva de la librería.** El caret en `0.x` no
cruza minors. Regla 6.

**Un endpoint nuevo quedó accesible para cualquier usuario logueado.** Se olvidó
el `@RequirePermission`. Regla 3 — y por eso la verificación es un script y no
una revisión a ojo.

## Próximo paso

- [Proteger endpoints](/integracion/proteger-endpoints/) — el detalle de cada decorador.
- [Permisos y scopes](/integracion/permisos-scopes/) — cómo se evalúan y cómo se asignan a roles.
- [Versiones de auth-guard](/versiones/auth-guard/) — qué trae cada versión.
