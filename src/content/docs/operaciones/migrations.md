---
title: Migrations
description: Aplicar migrations + seed contra Cloud SQL.
---

Las migrations se aplican **desde tu máquina** (no desde Cloud Run), conectándote a Cloud SQL vía Auth Proxy.

## 1. Instalar Cloud SQL Auth Proxy

**Windows:**

```powershell
# Descargar el binario (ajustar la versión a la última disponible)
mkdir -p $env:USERPROFILE\bin
Invoke-WebRequest `
  -Uri https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.14.2/cloud-sql-proxy.x64.exe `
  -OutFile $env:USERPROFILE\bin\cloud-sql-proxy.exe
```

**macOS/Linux:** ver [docs oficiales](https://cloud.google.com/sql/docs/postgres/sql-proxy).

## 2. Levantar el proxy

El proxy soporta dos formas de autenticarse:

**Opción A — Application Default Credentials (recomendado):**

```bash
gcloud auth application-default login   # one-time
./cloud-sql-proxy --port 5433 hagemsa-cloud:us-central1:hagemsa-postgresql
```

**Opción B — Access token corto (si ADC falla por política del Workspace):**

Si el `application-default login` falla porque tu Workspace bloquea la pantalla de consent (error "Missing required parameter: redirect_uri" o "scope not consented"), usá un access token corto del `gcloud auth login` que ya tenés activo:

```bash
./cloud-sql-proxy --port 5433 \
  --token "$(gcloud auth print-access-token)" \
  hagemsa-cloud:us-central1:hagemsa-postgresql
```

:::caution[Token expira en ~1h]
Si la sesión dura más, el proxy empezará a tirar `Server has closed the connection`. Reiniciarlo con un token fresco.
:::

El proxy abre Postgres en `127.0.0.1:5433` (cambialo si tenés otro Postgres en `5432`).

## 3. DATABASE_URL para migrations

En **otra terminal**, en el proyecto del Auth Service, exportá la URL apuntando al proxy con el usuario `auth_migrator`:

```bash
export DATABASE_URL="postgresql://auth_migrator:<password-url-encoded>@127.0.0.1:5433/db_auth_service?schema=public"
```

:::tip[URL-encoding del password]
Los caracteres `+`, `=`, `{`, `}` y similares deben ir URL-encoded en la connection string. Quick way en Python:
```bash
python -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "<password-en-claro>"
```

Para evitar futuros dolores de cabeza, generar passwords solo con caracteres alfanuméricos + un sufijo fijo (ej. `Pw1-`) que satisfaga la política de Cloud SQL sin tener chars problemáticos:
```bash
RAW=$(openssl rand -base64 24 | tr '+/=' 'Aa1')
NEW_PW="Pw1-${RAW}"
```
:::

> Si **no recordás la password** de `auth_migrator` o `auth_service`, regenerá la del que necesitás:
> ```bash
> gcloud sql users set-password auth_service \
>   --instance=hagemsa-postgresql \
>   --password="<NUEVA-PASSWORD>"
> ```
> Y **actualizá el secret** `auth-db-url` con la URL nueva (ver [Secretos](/operaciones/secretos/)).

## 4. Aplicar migrations

```bash
pnpm prisma migrate deploy
```

**Esperado:**

```
Applying migration `20260520181735_init_identity`
Applying migration `20260520182945_add_credentials`
Applying migration `20260520184059_add_sessions`
Applying migration `20260520185639_add_authorization`
Applying migration `20260520192033_add_refresh_tokens`
Applying migration `20260520204914_add_audit_and_reset_tokens`
```

## 4.b Caso especial: la migración crea un schema nuevo

Cuando una migración agrega un **bounded context nuevo** (un schema PG que antes no existía, ej. `socio_negocio`), hay dos cosas que el flujo normal **NO** cubre y hay que hacer a mano:

1. **Crear el schema.** No hace falta paso extra: `auth_migrator` tiene privilegio `CREATE` sobre la base (`has_database_privilege(current_user, current_database(), 'CREATE') = true`), así que el `CREATE SCHEMA IF NOT EXISTS` que Prisma pone al inicio del `migration.sql` se ejecuta solo durante `migrate deploy`. El schema queda **owned by `auth_migrator`**.

2. **Otorgar permisos al runtime `auth_service`.** Los `GRANT` y `ALTER DEFAULT PRIVILEGES` de [Setup GCP §3.3](/operaciones/setup-gcp/) están acotados a los **5 schemas originales** (`identity`, `credentials`, `authorization`, `sessions`, `audit`). Un schema nuevo **no está incluido**, así que `auth_service` no puede ni leerlo. Sin este paso, el servicio arranca pero tira `permission denied for schema <nuevo>` en la primera query.

Como `auth_migrator` es **dueño** del schema nuevo, puede otorgar los permisos él mismo (no hace falta `postgres`). Con el proxy arriba y en **otra terminal**:

```bash
psql "postgresql://auth_migrator:<password-url-encoded>@127.0.0.1:5433/db_auth_service" <<'SQL'
-- Reemplazar <schema> por el nombre del schema nuevo (ej. socio_negocio)
GRANT USAGE ON SCHEMA <schema> TO auth_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA <schema> TO auth_service;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA <schema> TO auth_service;

-- Para las tablas que auth_migrator cree a futuro en este schema (próximas migraciones).
-- Un rol puede setear sus propios default privileges, así que NO hace falta el
-- `GRANT auth_migrator TO postgres` que sí usa el setup inicial.
ALTER DEFAULT PRIVILEGES FOR ROLE auth_migrator IN SCHEMA <schema>
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO auth_service;
ALTER DEFAULT PRIVILEGES FOR ROLE auth_migrator IN SCHEMA <schema>
  GRANT USAGE ON SEQUENCES TO auth_service;
SQL
```

**Verificar** que quedó bien (debe devolver `t` en todo):

```sql
SELECT
  has_schema_privilege('auth_service', '<schema>', 'USAGE')                    AS schema_usage,
  has_table_privilege('auth_service', '<schema>.<alguna_tabla>', 'SELECT')     AS tabla_select,
  has_table_privilege('auth_service', '<schema>.<alguna_tabla>', 'INSERT')     AS tabla_insert;
```

:::note[Ownership del schema nuevo]
El schema queda owned por `auth_migrator` (los 5 originales son de `postgres`). Funciona perfecto — los grants de arriba son suficientes. Si querés uniformar el ownership con el resto, corré como `postgres`:
```sql
ALTER SCHEMA <schema> OWNER TO postgres;
```
Requiere la password de `postgres` (no la de `auth_migrator`), por eso es opcional y no bloquea el deploy.
:::

:::caution[Orden vs. el deploy de Cloud Run]
Hacé `migrate deploy` **y** estos grants **antes** de deployar la imagen que usa el schema nuevo. La migración es aditiva, así que la imagen vieja la ignora sin romperse; pero la imagen nueva sin los grants sí falla.
:::

> **Precedente aplicado:** el schema `socio_negocio` (feature de vínculo con BC01 / códigos de socio) se creó así el 2026-07-02.

## 4.c Caso normal: agregar una columna a una tabla existente

Para contrastar con 4.b: **agregar columnas (o índices) a tablas de un schema que ya existe NO requiere ningún paso extra.** Es el flujo estándar de la sección 4, sin grants adicionales.

Por qué no hacen falta grants: los `GRANT ... ON ALL TABLES` de `auth_service` son a **nivel de tabla**, y una columna nueva **hereda** automáticamente los privilegios de su tabla (salvo que se hubieran usado grants por-columna, cosa que acá nunca hacemos). Es decir, `auth_service` puede leer/escribir la columna nueva apenas se crea.

```bash
# Con el proxy arriba y DATABASE_URL apuntando a auth_migrator:
pnpm prisma migrate deploy
```

**Verificación opcional** (debe devolver `t` en los tres) — útil para confirmar la herencia de permisos:

```sql
SELECT
  has_column_privilege('auth_service', '<schema>.<tabla>', '<columna>', 'SELECT') AS svc_select,
  has_column_privilege('auth_service', '<schema>.<tabla>', '<columna>', 'INSERT') AS svc_insert,
  has_column_privilege('auth_service', '<schema>.<tabla>', '<columna>', 'UPDATE') AS svc_update;
```

> **Precedente aplicado:** la migración `20260702181916_agregar_snapshot_socio` agregó la columna `socio_snapshot JSONB` (nullable) a `socio_negocio.socio_links` — snapshot de display del socio de BC01 para no depender de BC01 al emitir el token. Aplicada a producción el 2026-07-02 con solo `migrate deploy` (sin grants nuevos; `auth_service` heredó SELECT/INSERT/UPDATE de la tabla).

## 5. Generar Prisma Client (si cambió el schema)

```bash
pnpm prisma generate
```

## 6. Seed inicial (catálogo de roles y permisos)

```bash
pnpm prisma db seed
```

Esto pobla:

- `authorization.permissions` con el catálogo de ~32 permisos.
- `authorization.roles` con los ~11 roles del sistema (`SUPER_ADMIN`, `GERENTE`, `JEFE_ALMACEN`, `ALMACENERO`, `OPERADOR_FLOTA`, `CONTADOR`, `FACTURADOR`, `VENDEDOR`, `RRHH`, `CHOFER`, `CLIENTE`, `PROVEEDOR`).
- `authorization.role_permissions` con las asignaciones por default.

**Idempotente:** podés correrlo dos veces sin problema. Usa `upsert`.

## 7. Bajar el proxy

Volvé a la terminal con el proxy corriendo y `Ctrl+C`.

## ¿Cuándo aplicar migrations nuevas?

Cada vez que cambies `prisma/schema.prisma`:

1. **En dev** local: `pnpm prisma migrate dev --name <descripcion>`. Esto genera la migration y la aplica a tu DB local.
2. **Revisar el SQL generado** en `prisma/migrations/<timestamp>_<descripcion>/migration.sql`.
3. **Commit** del schema + migration al repo.
4. **En prod:** reconectar el proxy y correr `pnpm prisma migrate deploy`.

## Reglas inquebrantables

- **NUNCA editar manualmente** las migrations que genera Prisma para cambios de **estructura**. Si está mal, borrar la migration completa y regenerar con `migrate dev`.
- **Una migration por feature.** No mezclar cambios no relacionados.
- **Nombre de migration descriptivo y en español.** Ej: `agregar-tabla-refresh-tokens`.
- **Producción: solo `migrate deploy`**, nunca `migrate dev`.

### Excepción: migraciones de datos

Cuando además de cambiar la estructura hay que **mover o transformar datos**
(ej. mover una columna de una tabla a otra), Prisma **no** genera el SQL de datos.
El flujo sancionado es:

1. `pnpm prisma migrate dev --create-only --name <descripcion>` — genera la
   migration **sin aplicarla**.
2. **Editar el `migration.sql`** para intercalar el `INSERT ... SELECT` (u otro
   SQL de datos) en el orden correcto: crear lo nuevo → mover datos → borrar lo
   viejo. Este es el **único** caso en que se edita una migration a mano.
3. Aplicar con `migrate deploy` (o `migrate dev` en local).

> **Precedente aplicado:** la migración `20260709160357_mover_codigos_a_cuenta`
> (2026-07-09) movió los códigos internos de `socio_negocio.socio_codes` a la
> nueva tabla `identity.account_codes` (desacoplando los códigos del vínculo con
> el socio). El SQL generado dropeaba la tabla vieja **antes** de crear la nueva;
> se reordenó a mano a: crear `account_codes` → `INSERT ... SELECT` desde
> `socio_codes` (join con `socio_links`) → drop `socio_codes`.

## Próximo paso

[Deploy a Cloud Run →](/operaciones/deploy-cloud-run/)
