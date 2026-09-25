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

Se registra como `APP_GUARD` en el módulo raíz, con **`useExisting`**:

```ts
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from '@hagemsa/auth-guard';

@Module({
  providers: [{ provide: APP_GUARD, useExisting: JwtAuthGuard }],
})
export class AppModule {}
```

:::danger[`useExisting`, no `useClass`]
Los dos protegen igual en producción. La diferencia aparece en los tests.

Con `useClass`, Nest construye una instancia **propia** del guard bajo el token
`APP_GUARD`, sin resolver el proveedor `JwtAuthGuard`. Entonces esto **no surte
efecto**:

```ts
Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(JwtAuthGuard)
  .useClass(StubJwtAuthGuard)   // el enhancer sigue usando el guard real
  .compile();
```

El stub queda registrado, pero el guard real sigue corriendo: se superponen los
dos y **todo responde 401**. En `bc03-comercial` eso hizo fallar 24 pruebas de
contratos hasta dar con la causa. Se probaron las tres variantes
(`overrideProvider(JwtAuthGuard)`, `overrideProvider(APP_GUARD)` y `useClass`);
la única que permite sustituirlo es `useExisting`.

Con `useExisting`, `APP_GUARD` resuelve el proveedor que `AuthGuardModule.forRoot`
ya expone —es `global: true` y lo exporta—, así que el override lo alcanza.

Incluso si hoy no necesitás sustituirlo, registralo así: cuando aparezca la
primera suite que lo necesite, el diagnóstico es caro y no se parece en nada a
su causa.
:::

:::note[Esta guía recomendaba lo contrario hasta el 2026-09-25]
Decía que la forma preferida era `app.useGlobalGuards(app.get(JwtAuthGuard))` en
`main.ts`, porque el registro queda a la vista junto al `ValidationPipe`. El
argumento era de legibilidad y no resistió la medición de abajo.

`bc01-socio-negocio`, `bc02-activos`, `bc03-comercial` y
`bc14-cs-configuracion-general` ya usan `APP_GUARD` con `useExisting`. Queda
`bc-06`, que registra en `main.ts`: funciona y está protegido en producción, el
cambio es deuda y no una urgencia.
:::

### Por qué `APP_GUARD` y no `main.ts`

**Porque `main.ts` no se ejecuta en los tests.** Un test que levante el módulo
raíz obtiene la app SIN guard, y no hay forma de escribir uno que verifique que
un endpoint quedó protegido.

Medido con dos módulos idénticos salvo en dónde se registra un guard que
siempre rechaza:

```
APP_GUARD en el módulo       -> GET /demo = 403   (guard aplicado)
useGlobalGuards en main.ts   -> GET /demo = 200   (guard NO aplicado)
```

Se puede compensar repitiendo el cableado en cada test, y así lo hacen los dos
backends: 19 de 20 suites e2e en `bc03-comercial`, 16 de 16 en `bc-06`, con el
comentario «Igual que main.ts: aplica el guard global para verificar la
protección real».

El problema es que nada lo obliga, y ya falló. La suite número 20 de
`bc03-comercial` omitía esa línea y afirmaba:

```ts
it('GET /api/prospectos devuelve 200', () => {
  return request(app.getHttpServer()).get('/api/prospectos').expect(200);
});
```

Ese endpoint exige `bc03:prospecto:leer` y en producción responde **401** sin
token. El test pasaba porque corría sobre una app sin guard, y documentaba lo
contrario de la realidad: cualquiera que lo leyera concluiría que `prospectos`
es público. Estuvo así hasta que una auditoría lo encontró.

Con `APP_GUARD` ese test habría recibido el guard solo, habría fallado desde el
primer día y el error se habría visto enseguida.

Lo secundario, pero cierto: el cableado de auth queda en un archivo en vez de
repartido entre el módulo y `main.ts`.

### Lo que NO cambia entre las dos formas

Para descartar que se estuviera perdiendo algo al elegir: `AuthGuardModule.forRoot`
se registra con `global: true` y exporta `JwtAuthGuard`, así que las dos
resuelven el guard desde el contenedor con sus dependencias intactas. El orden
frente a otros guards globales también se controla igual en ambas — con
`APP_GUARD`, por el orden de los `providers`.

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

La regla: **todo endpoint exige un permiso, salvo los `@Public()` de la regla 2.**

### El permiso puede estar en el método o en el controlador

Las dos formas cumplen, porque el guard resuelve así:

```ts
this.reflector.getAllAndOverride(REQUIRE_PERMISSION_KEY, [
  context.getHandler(),  // el método
  context.getClass(),    // el controlador
])
```

Un `@RequirePermission` sobre el `@Controller` aplica a **todos** sus endpoints, y
el del método lo sobreescribe. Lo mismo vale para `@Public()`, como ya se ve en el
ejemplo del push de Pub/Sub de la regla 2.

Los dos backends auditados usan patrones distintos y los dos cumplen:

| Backend | Patrón |
| --- | --- |
| `bc03-comercial` | Permiso explícito en cada método: 170 endpoints, 165 con decorador propio, 5 públicos. |
| `bc14-cs-configuracion-general` | `@RequirePermission(leer)` sobre el `@Controller` como piso; los 60 endpoints que escriben lo sobreescriben y 49 de lectura lo heredan. |

:::caution[Contar decoradores por archivo NO sirve para auditar esto]
Comparar la cantidad de `@RequirePermission` contra la cantidad de endpoints
parece razonable y está mal en las dos direcciones.

**Falsos positivos.** Hay dos formas distintas de caer en uno, y las dos se
dieron auditando de verdad:

*Por herencia.* Contra BC-14, contar reporta 49 endpoints "desprotegidos" que
en realidad heredan el permiso del controlador. Esa cuenta motivó un reporte
equivocado de 50 endpoints abiertos el 2026-09-24.

*Por un comentario entre decoradores.* En BC-01 hay endpoints escritos así:

```ts
@Get(':numeroDocumento')
// `bc01:personal:leer`: consulta M2M de solo lectura. No `bc01:integracion:leer`
// (codigo inexistente en el catalogo del Auth Service -> 403 permanente).
@RequirePermission('bc01:personal:leer')
```

Un lector de decoradores que se detenga en la primera línea que no empieza con
`@` deja el permiso afuera y reporta el endpoint como abierto. Pasó el
2026-09-25. El script de abajo atraviesa los comentarios por eso.

**Falsos negativos:** no ve el único caso que importaba, que es un endpoint de
escritura heredando un permiso de lectura.

Hay que resolver el permiso efectivo de cada endpoint, no contar líneas.
:::

### El script

```bash
cat > /tmp/auditar-permisos.mjs <<'EOF'
// Audita los controladores de un backend del ERP: para cada endpoint dice que
// permiso EFECTIVO exige.
//
// Por que no alcanza con contar @RequirePermission por archivo: el guard
// resuelve con getAllAndOverride(KEY, [handler, class]), asi que @Public() y
// @RequirePermission puestos sobre el @Controller valen para TODOS sus
// endpoints, y el del metodo sobreescribe al de la clase. Contar da falsos
// positivos (reporta como huecos endpoints que heredan) y falsos negativos (no
// ve una escritura protegida con un permiso de lectura).
//
// Y por que hay que atravesar los comentarios al leer los decoradores de un
// metodo: un comentario entre el verbo y @RequirePermission es frecuente, y
// cortar el bloque ahi hace que el endpoint figure como desprotegido.
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const ES_VERBO = /^@(Get|Post|Put|Patch|Delete)\(/
const PERMISO = /@RequirePermission\(\s*([^)]*)\)/

// Excluye los specs por RUTA, no por nombre: `grep -v spec` tambien filtra
// "prospecto" y deja controladores afuera sin avisar.
const archivos = execSync(
  `find src -name "*.controller.ts" -not -name "*.spec.ts" | sort`,
  { encoding: 'utf8' },
).split('\n').filter(Boolean)

const totales = { endpoints: 0, propios: 0, heredados: 0, publicos: 0, sinNinguno: 0 }
const huecos = []
const escrituraConLectura = []

for (const archivo of archivos) {
  const lineas = readFileSync(archivo, 'utf8').split(/\r?\n/)
  const t = (i) => (lineas[i] ?? '').trim()

  // Decoradores de la CLASE: se sube desde `export class` hasta el final de la
  // declaracion anterior (`}` o `;`). Solo cuentan las lineas que son
  // decoradores; las de comentario se atraviesan pero no se leen, para que un
  // @RequirePermission mencionado en un comentario no se tome por real.
  let permisoDeClase = null
  let claseEsPublica = false
  const iClase = lineas.findIndex((l) => /^\s*export class /.test(l))
  for (let j = iClase - 1; j >= 0; j--) {
    const linea = t(j)
    if (linea.endsWith('}') || linea.endsWith(';')) break
    if (!linea.startsWith('@')) continue
    if (linea.startsWith('@Public()')) claseEsPublica = true
    const m = PERMISO.exec(linea)
    if (m) permisoDeClase = m[1].trim()
  }

  for (let i = 0; i < lineas.length; i++) {
    if (!ES_VERBO.test(t(i))) continue
    totales.endpoints++

    // Bloque de decoradores del metodo: arriba y abajo del verbo.
    //
    // Se ATRAVIESAN los comentarios, no solo los decoradores. Entre el verbo y
    // @RequirePermission suele haber una nota explicando la eleccion del
    // permiso, y cortar ahi deja el decorador fuera del bloque: el endpoint
    // figura como desprotegido cuando no lo esta. Es seguro, porque el
    // recorrido termina igual en la firma del metodo, que no es ninguna de las
    // dos cosas.
    const acompana = (linea) => linea.startsWith('@') || linea.startsWith('//')
    let desde = i
    while (desde > 0 && acompana(t(desde - 1))) desde--
    let hasta = i
    // Un decorador de verbo puede ocupar VARIAS lineas cuando la ruta es larga:
    //
    //   @Post(
    //     'codigo/:codigo/documentos-compartidos/:id/coberturas',
    //   )
    //   @RequirePermission('bc02:activo:escribir')
    //
    // La linea de la ruta no es un decorador ni un comentario, asi que el
    // recorrido de abajo cortaba ahi: el bloque quedaba en `@Post(` solo, el
    // @RequirePermission caia fuera y el endpoint se reportaba como una
    // escritura que hereda un permiso de lectura. Fue un falso positivo contra
    // bc02-activos. Primero se avanza hasta cerrar los parentesis del propio
    // decorador.
    let balance = 0
    for (let k = i; k < lineas.length; k++) {
      for (const ch of lineas[k]) {
        if (ch === '(') balance++
        else if (ch === ')') balance--
      }
      hasta = k
      if (balance <= 0) break
    }
    while (hasta < lineas.length - 1 && acompana(t(hasta + 1))) hasta++
    const bloque = lineas.slice(desde, hasta + 1).join('\n')

    if (claseEsPublica || bloque.includes('@Public()')) { totales.publicos++; continue }

    const verbo = ES_VERBO.exec(t(i))[1]
    const donde = `${archivo}:${i + 1}  ${t(i)}`

    if (PERMISO.test(bloque)) { totales.propios++; continue }
    if (!permisoDeClase) { totales.sinNinguno++; huecos.push(donde); continue }

    totales.heredados++
    // Hereda del controlador. No esta desprotegido, pero si el permiso heredado
    // es de lectura y el endpoint escribe, exige menos de lo que deberia.
    if (verbo !== 'Get' && /leer|read|consultar/i.test(permisoDeClase)) {
      escrituraConLectura.push(`${donde}  [${verbo}] -> ${permisoDeClase}`)
    }
  }
}

console.log(`controladores: ${archivos.length} | endpoints: ${totales.endpoints}`)
console.log(`  permiso propio:           ${totales.propios}`)
console.log(`  heredan del controlador:  ${totales.heredados}`)
console.log(`  @Public():                ${totales.publicos}`)
console.log(`  SIN NINGUN PERMISO:       ${totales.sinNinguno}`)

if (huecos.length) {
  console.log('\n--- SIN PERMISO: entra cualquier usuario autenticado ---')
  for (const x of huecos) console.log('  ' + x)
}
if (escrituraConLectura.length) {
  console.log('\n--- ESCRITURAS que heredan un permiso de LECTURA ---')
  for (const x of escrituraConLectura) console.log('  ' + x)
}
if (!huecos.length && !escrituraConLectura.length) console.log('\nSin hallazgos.')
EOF

node /tmp/auditar-permisos.mjs
```

El resultado esperado es `SIN NINGUN PERMISO: 0` y ninguna escritura con permiso
de lectura. Medido el 2026-09-25:

```
=== bc01-socio-negocio ===
controladores: 15 | endpoints: 79
  permiso propio:           75
  heredan del controlador:  0
  @Public():                4
  SIN NINGUN PERMISO:       0

Sin hallazgos.

=== bc02-activos ===
controladores: 7 | endpoints: 93
  permiso propio:           48
  heredan del controlador:  43
  @Public():                2
  SIN NINGUN PERMISO:       0

Sin hallazgos.

=== bc03-comercial ===
controladores: 19 | endpoints: 170
  permiso propio:           165
  heredan del controlador:  0
  @Public():                5
  SIN NINGUN PERMISO:       0

Sin hallazgos.

=== bc14-cs-configuracion-general ===
controladores: 6 | endpoints: 111
  permiso propio:           60
  heredan del controlador:  49
  @Public():                2
  SIN NINGUN PERMISO:       0

Sin hallazgos.
```

### El hallazgo que solo aparece resolviendo el permiso efectivo

En BC-14, `@Patch('sedes/:sedeId/areas/:areaId/plazas')` no declaraba permiso
propio, así que heredaba `bc14:hu001:leer` del controlador: quien pudiera **leer**
la configuración general podía **modificar** las plazas autorizadas de un área. Su
gemelo de cargos, `@Put('sedes/:sedeId/cargos/:cargoId/plazas')`, sí exigía
`modificar`. Corregido el 2026-09-24.

Ese es el riesgo propio del patrón de BC-14: el piso del controlador es una red
contra el olvido, pero convierte el olvido en un permiso silenciosamente
insuficiente, en vez de en un 403 evidente. Con el patrón de BC-03 el olvido deja
el endpoint abierto —más grave, pero también más visible—. Ninguno de los dos se
detecta leyendo el archivo.

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
