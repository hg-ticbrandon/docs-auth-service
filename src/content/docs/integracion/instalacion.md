---
title: Instalación
description: Instalar la librería @hagemsa/auth-guard en tu backend.
---

La lib `@hagemsa/auth-guard` se publica al **Artifact Registry interno** de HAGEMSA
(repo npm `hagemsa-npm` en `us-central1`, proyecto `hagemsa-cloud`). No está en
npm público.

### 1.1 Configurar el registry en tu proyecto

Van **dos archivos distintos**: el mapeo del registry se versiona con el repo, y el
token vive **solo en tu máquina**.

**a) `.npmrc` en la raíz de tu backend** (versionado, lo comparte el equipo) — enruta
el scope `@hagemsa`, **sin token**:

```ini
@hagemsa:registry=https://us-central1-npm.pkg.dev/hagemsa-cloud/hagemsa-npm/
//us-central1-npm.pkg.dev/hagemsa-cloud/hagemsa-npm/:always-auth=true
```

**b) El token, en tu `~/.npmrc` de usuario.** No lo edites a mano: `pnpm config set`
escribe ahí:

```bash
pnpm config set "//us-central1-npm.pkg.dev/hagemsa-cloud/hagemsa-npm/:_authToken" "$(gcloud auth print-access-token)"
```

:::danger[El token NO va en el `.npmrc` del proyecto]
Desde **pnpm 11.11**, una credencial con `${VARIABLE}` en el `.npmrc` **del proyecto**
se **ignora a propósito** — ese archivo se commitea y podría filtrar el secreto a un
registry hostil. pnpm avisa y sigue:

```text
[WARN] Ignored project-level auth setting "//us-central1-npm.pkg.dev/.../:_authToken"
in ".../.npmrc": environment variables are not expanded in registry credentials that
come from a project .npmrc... put the line in your user-level ~/.npmrc, or set it with
pnpm config set
```

Y el install muere con `ERR_PNPM_FETCH_403` **aunque el token sea válido y esté
presente**. Si te pasa: no busques un token faltante — movelo al `~/.npmrc`.

(Con pnpm anterior a 11.11 el token en el `.npmrc` del proyecto todavía funciona, pero
rompe en cuanto pnpm suba de versión.)
:::

### 1.2 De dónde sale `GOOGLE_NPM_TOKEN`

`GOOGLE_NPM_TOKEN` **no es un secreto fijo que alguien te pasa**: es un token
OAuth de **corta vida (~1 hora)** que generás vos mismo con el CLI de Google
Cloud (`gcloud`), a partir de tu propia identidad de GCP. Cada vez que vas a
instalar, lo regenerás con `gcloud auth print-access-token`.

**Pasos para poder generarlo (una sola vez):**

1. **Instalá el CLI de gcloud** (Google Cloud SDK):
   <https://cloud.google.com/sdk/docs/install>. Verificá con `gcloud --version`.

2. **Autenticate** con tu cuenta corporativa de Google:

   ```bash
   gcloud auth login
   ```

   Esto abre el navegador. Logueate con la cuenta de HAGEMSA que tenga acceso al
   proyecto. (Usá `gcloud auth login`, **no** `gcloud auth application-default
   login` — este último puede estar bloqueado por política de Workspace.)

3. **Seleccioná el proyecto:**

   ```bash
   gcloud config set project hagemsa-cloud
   ```

4. **Pedí acceso de lectura al registry.** Tu cuenta necesita el rol
   `roles/artifactregistry.reader` sobre el repo `hagemsa-npm` (o el proyecto
   `hagemsa-cloud`). Solicitalo al equipo de plataforma
   (`cloud.infra@transporteshagemsa.com`) indicando tu email de GCP.

Una vez hecho esto, **`gcloud auth print-access-token` imprime el token** que la
lib usa. Para confirmar que funciona:

```bash
gcloud auth print-access-token
# Debe imprimir una cadena larga (ya29....). Si pide login, repetí el paso 2.
```

### 1.3 Autenticarte e instalar

Guardá el token en tu `~/.npmrc` de usuario con `pnpm config set`, y después instalá:

```bash
pnpm config set "//us-central1-npm.pkg.dev/hagemsa-cloud/hagemsa-npm/:_authToken" "$(gcloud auth print-access-token)"
pnpm add @hagemsa/auth-guard
```

En **PowerShell** es igual (la sustitución `$(...)` también funciona):

```powershell
pnpm config set "//us-central1-npm.pkg.dev/hagemsa-cloud/hagemsa-npm/:_authToken" "$(gcloud auth print-access-token)"
pnpm add @hagemsa/auth-guard
```

**Qué hace esa línea:** `gcloud auth print-access-token` genera un token OAuth nuevo, y
`pnpm config set` lo **escribe en tu `~/.npmrc`** (el de usuario, fuera del repo). A
diferencia de una variable de entorno, **persiste entre terminales**: no hay que
repetirlo en cada sesión, solo cuando el token caduca.

> **El token dura ~1 hora.** Cuando un `install` falle con `401`/`403`, volvé a correr
> el `pnpm config set` (regenera y reescribe). No hace falta `gcloud auth login` de
> nuevo salvo que la sesión de gcloud haya expirado.

:::tip[Para no repetirlo cada hora]
`npx google-artifactregistry-auth` refresca la credencial automáticamente leyendo tu
sesión de gcloud. Útil si trabajás todos los días contra el registry.
:::

:::caution[¿Por qué no una variable de entorno `GOOGLE_NPM_TOKEN`?]
Porque **ya no funciona para el `.npmrc` del proyecto**: pnpm 11.11+ no expande
variables en credenciales que vienen de un `.npmrc` commiteado (ver 1.1). La variable
`GOOGLE_NPM_TOKEN` **sigue siendo el mecanismo en el build de Docker**, pero allí se
escribe en el `.npmrc` de **usuario** del contenedor (`/root/.npmrc`), no en el del
repo. Ver [Desplegar a Cloud Run](/integracion/deploy-consumidor/#24-dockerfile).
:::

:::tip[El token es SOLO para instalar/actualizar — no para producción]
Que el token dure 1 hora **no afecta a tu backend en producción**. El
`GOOGLE_NPM_TOKEN` se usa **únicamente** en el momento de **descargar el
paquete** desde Artifact Registry, es decir cuando corrés `pnpm add` /
`pnpm install` (al agregar la lib o al actualizar su versión).

Una vez instalada, `@hagemsa/auth-guard` es **código en `node_modules`** que se
**empaqueta dentro de tu imagen Docker** durante el build. En **runtime** el
contenedor solo ejecuta ese código ya descargado: **no vuelve a contactar al
registry ni necesita ningún token**.

En runtime la lib solo hace una llamada de red: descargar el **JWKS público**
del Auth Service (`/.well-known/jwks.json`) para verificar firmas — y eso **no
lleva autenticación** (es un endpoint público). Por eso un backend puede correr
semanas sin que el token de 1 hora tenga ninguna relevancia: ya cumplió su
función en el `pnpm install` del build.

**En resumen:**
- `pnpm install` (build / actualizar lib) → **sí** necesita el token (vive segundos).
- Backend corriendo en producción → **no** necesita el token nunca.
:::

### 1.4 En CI / Cloud Run

- **Cloud Build / CI:** pasá el token como `--build-arg GOOGLE_NPM_TOKEN` y, dentro del
  Dockerfile, **escribilo en el `.npmrc` de usuario** antes del `pnpm install` (no en
  el del proyecto — pnpm lo ignoraría, ver 1.1):

  ```dockerfile
  ARG GOOGLE_NPM_TOKEN
  RUN printf '//us-central1-npm.pkg.dev/hagemsa-cloud/hagemsa-npm/:_authToken=%s\n' "$GOOGLE_NPM_TOKEN" > /root/.npmrc
  ```

  Ahí no hay `gcloud auth login` interactivo: el build corre con su **service
  account**, que ya está autenticada — solo necesita el rol
  `roles/artifactregistry.reader`. El mismo `gcloud auth print-access-token` toma
  la identidad de esa service account. Guía completa:
  [Desplegar a Cloud Run](/integracion/deploy-consumidor/).
- **Runtime (Cloud Run):** la lib ya viene empaquetada en tu imagen Docker desde
  el build, así que el contenedor en ejecución **no** necesita el token ni acceso
  al registry. El flujo completo en prod es: Cloud Build usa el token (de su
  service account) para `pnpm install` → compila la imagen con la lib adentro →
  Cloud Run corre esa imagen. El token se consumió en el paso de build; el
  contenedor en producción nunca lo ve.

### 1.5 Actualizar a una versión nueva

`pnpm add @hagemsa/auth-guard` (sin versión) instala la **última**. Si ya la
tenés y querés **subir de versión** (o fijar una concreta), pasá la versión y
regenerá el lockfile:

```bash
# generá el token primero (igual que en el install)
export GOOGLE_NPM_TOKEN="$(gcloud auth print-access-token)"   # PowerShell: $env:GOOGLE_NPM_TOKEN = (gcloud auth print-access-token)

pnpm add @hagemsa/auth-guard@0.3.1     # sube package.json + pnpm-lock.yaml
```

Después **redeployá** tu backend (ej. `gcloud builds submit ...`). El build corre
`pnpm install --frozen-lockfile`, así que **sin** actualizar el lockfile seguirías
trayendo la versión vieja. Ver el [historial de versiones](/operaciones/publicar-libreria/#historial-de-versiones)
para saber qué trae cada una.

:::note[Versión 0.2.0 — códigos y socio de negocio]
Desde **0.2.0**, el `AuthContext` expone campos opcionales adicionales. Si tu
backend los necesita, instalá `@hagemsa/auth-guard@^0.2.0`:

- `codigoSocio`, `codigoCuenta` — códigos internos de la **cuenta** (para PDFs),
  1-20 alfanuméricos. **Independientes del socio**: presentes si la cuenta los
  tiene, con o sin socio vinculado.
- `socioExternoId`, `socioNombre`, `socioDocumento` — presentes solo si la cuenta
  tiene un socio de BC01 vinculado.

En cuentas sin códigos / sin socio, llegan como `undefined`.
:::

:::note[Versión 0.3.0 — M2M / tokens de servicio]
Desde **0.3.0** la lib soporta comunicación **backend-a-backend** (grant client
credentials). Cambios **aditivos y retrocompatibles** (los tokens de usuario
existentes siguen igual):

- `tokenUse` (`'user'` \| `'service'`) y `clientId` en `JwtPayload` / `AuthContext`.
- Decoradores opt-in `@ServiceOnly()` / `@UserOnly()` para restringir por tipo de token.
- `ServiceTokenProvider` (+ `AuthGuardModule.forServiceClient(...)`) para que tu
  backend obtenga tokens de servicio y llame a otros backends.

Si tu backend va a **llamar** a otro por su cuenta o a **restringir** endpoints
por tipo de token, subí a `@hagemsa/auth-guard@^0.3.1` y seguí
[Comunicación backend-a-backend (M2M)](/integracion/m2m/).
:::

## 2. Variables de entorno

Agregá a tu `.env`:

```bash
# --- Mínimo: validar JWT + permisos + scopes ---
# URL del JWKS del Auth Service.
AUTH_JWKS_URL=https://auth.hagemsa.com/.well-known/jwks.json
# Issuer y audience que esperás en los JWT (deben coincidir EXACTO con lo que emite el Auth Service).
AUTH_JWT_ISSUER=https://auth.hagemsa.com
AUTH_JWT_AUDIENCE=hagemsa-backends

# --- Solo si activás blacklist (logout instantáneo) ---
# URL base del Auth Service (para consultar /api/internal/*).
AUTH_SERVICE_URL=https://auth.hagemsa.com
# Shared secret para /api/internal/*. Pedilo al equipo de plataforma.
# NUNCA hardcodearlo: va a Secret Manager.
AUTH_INTERNAL_SECRET=<secreto-compartido>
```

> Con las **tres primeras** alcanza para autorizar (los permisos y scopes vienen
> embebidos en el JWT). `AUTH_SERVICE_URL` y `AUTH_INTERNAL_SECRET` solo hacen
> falta si activás `enableBlacklistCheck`. Los nombres de las variables son tuyos
> —vos las mapeás a la config de la lib en `app.module.ts`—; acá usamos estos por
> consistencia con el resto de la doc.

En **producción** los secretos vienen de **Secret Manager** (GCP), no de un `.env` plano.

### Cómo obtener `AUTH_INTERNAL_SECRET`

Es el shared secret del Auth Service (`INTERNAL_SHARED_SECRET`). Dos vías:

- **Pedirlo al equipo de plataforma** (`cloud.infra@transporteshagemsa.com`) — lo
  habitual si solo integrás un backend.
- **Leerlo vos** si tenés rol `roles/secretmanager.secretAccessor` sobre el secreto:
  ```bash
  gcloud secrets versions access latest \
    --secret=internal-shared-secret --project=hagemsa-cloud
  ```

Copialo **tal cual**, sin agregar espacios ni saltos de línea: el Auth Service lo
compara byte-exacto. Detalle de generación/rotación en
[Secretos](/operaciones/secretos/#4-internal-shared-secret).

## 3. Verificar conectividad

Antes de cablear el módulo, validá manualmente que tu backend alcanza al Auth Service:

```bash
# El JWKS debe responder 200 con un objeto { keys: [...] }
curl https://auth.hagemsa.com/.well-known/jwks.json

# El health del Auth Service debe responder 200
curl https://auth.hagemsa.com/health
```

Si esos dos endpoints no responden desde tu entorno, hay un problema de red/firewall que resolver antes.

## Próximo paso

[Configurar el módulo →](/integracion/configuracion/)
