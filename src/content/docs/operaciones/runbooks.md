---
title: Runbooks
description: Procedimientos paso a paso para incidentes y operaciones rutinarias.
---

## Runbook: cuenta comprometida

**Disparador:** se sospecha que un usuario fue comprometido (password robado, sesión secuestrada, etc.).

**Pasos:**

1. **Suspender la cuenta** para impedir nuevos logins:
   ```http
   POST /api/admin/cuentas/<id>/suspender
   { "razon": "Sospecha de compromiso" }
   ```
2. **Listar sesiones activas:**
   ```http
   GET /api/admin/cuentas/<id>/sesiones
   ```
3. **Revocar cada sesión:**
   ```http
   POST /api/admin/sesiones/<sesionId>/revocar
   { "razon": "Sospecha de compromiso" }
   ```
4. **Forzar reset de password** (cuando el usuario verifique identidad por otro canal):
   ```http
   POST /api/admin/cuentas/<id>/reset-password
   ```
5. **Auditar:** revisar `audit.auth_events` filtrando por `accountId` para ver actividad sospechosa:
   ```http
   GET /api/admin/audit/events?cuentaId=<id>&limit=100
   ```
6. **Reactivar cuenta** una vez resuelto:
   ```http
   POST /api/admin/cuentas/<id>/reactivar
   ```

## Runbook: rotación programada de claves JWT

**Frecuencia recomendada:** cada 90 días o tras incidente.

**Pasos:**

1. **Generar nuevo par RSA** localmente:
   ```bash
   openssl genrsa -out new-private.pem 2048
   openssl rsa -in new-private.pem -pubout -out new-public.pem
   ```
2. **Subir como nueva versión** del secret:
   ```bash
   gcloud secrets versions add jwt-private-key --data-file=new-private.pem
   gcloud secrets versions add jwt-public-key --data-file=new-public.pem
   ```
3. **Deshabilitar versión anterior:**
   ```bash
   gcloud secrets versions disable <version-anterior> --secret=jwt-private-key
   gcloud secrets versions disable <version-anterior> --secret=jwt-public-key
   ```
4. **Redeploy** del Auth Service para que cargue la nueva clave:
   ```bash
   gcloud run services update auth-service --region=us-central1
   ```
5. **Borrar PEMs locales:**
   ```bash
   rm new-private.pem new-public.pem
   ```
6. **Notificar** a los equipos de backends que sus caches de JWKS van a refrescar dentro de las próximas 24h (el TTL default).

**Efecto:** JWTs emitidos antes de la rotación siguen siendo válidos hasta que su `exp` pase O hasta que un backend refresque JWKS y descubra que el `kid` viejo ya no está.

## Runbook: rotación de internal-shared-secret

Más complicado porque requiere coordinación con todos los backends que lo consumen.

**Pasos:**

1. **Generar y subir el nuevo secret SIN newline final** (en un solo paso, sin
   archivo temporal que pueda quedar con `\n`):
   ```bash
   openssl rand -hex 32 | tr -d '\n' | \
     gcloud secrets versions add internal-shared-secret --data-file=- --project=hagemsa-cloud
   ```
   :::danger[Nunca con newline]
   NO uses `openssl ... > archivo` ni `echo` para este secreto: dejan un `\n`
   final (en Windows `\r\n`) que, al viajar en el header `X-Internal-Secret`
   (comparado byte-exacto), hace que **todos** los consumidores reciban 401.
   Verificá: `gcloud secrets versions access latest --secret=internal-shared-secret | xxd | tail -1` no debe terminar en `0d`/`0a`.
   :::
2. **Coordinar ventana de cambio** con todos los equipos de backends.
3. **Cada equipo de backend:**
   - Actualiza su Secret Manager con el nuevo valor (obtenerlo con
     `gcloud secrets versions access latest --secret=internal-shared-secret`).
   - Redeploya su servicio.
4. **Redeploy del Auth Service** para que cargue la nueva versión. Como el binding
   usa `:latest`, una revisión nueva la toma:
   ```bash
   gcloud run services update auth-service --region=us-central1 \
     --update-secrets=INTERNAL_SHARED_SECRET=internal-shared-secret:latest
   ```
5. **Deshabilitar versión anterior** en `internal-shared-secret`:
   ```bash
   gcloud secrets versions disable <version-anterior> --secret=internal-shared-secret
   ```

> **Durante la ventana de transición:** los backends que aún tienen el secret viejo van a recibir 401 al consultar `/api/internal/*`, lo que los hace fail-closed y rechazar JWTs. Idealmente, esta ventana es muy corta (< 1 minuto).

## Runbook: pasar a tokens "flacos" (`JWT_EMBED_PERMISOS=false`)

**Objetivo:** dejar de embeber los permisos en el JWT para que no crezca con la
cantidad de roles/permisos. A partir del flip, cada consumidor resuelve
`rol → permisos` desde el catálogo del Auth Service (`GET /api/internal/roles-permisos`),
cacheado. Requiere `@hagemsa/auth-guard` **≥ 0.4.0** en todos los backends.

:::danger[El orden importa: actualizá TODO antes del flip]
El guard de 0.4.0 acepta ambos formatos (gordo y flaco), pero un backend en una
versión vieja **no sabe** resolver un token flaco: leería `permisos` vacío y
**denegaría todo (403)**. Por eso el flip del Auth Service es el **último** paso.
:::

**Pasos:**

1. **Publicar `@hagemsa/auth-guard@0.4.0`** al Artifact Registry (ver
   [Publicar la librería](/operaciones/publicar-libreria/)).
2. **Actualizar TODOS los consumidores** a `^0.4.0` y, en su `AuthGuardModule.forRoot`,
   asegurar `authServiceUrl` + `internalSecret`. Incluye el frontend
   (`FR_HagemsaERP`), que resuelve permisos del lado servidor con
   `INTERNAL_SHARED_SECRET`. Redeployar cada uno.
3. **Verificar** que cada backend sigue autorizando con los tokens gordos actuales
   (el guard nuevo los soporta) — no debería cambiar nada aún.
4. **Verificar el endpoint del catálogo** desde la red donde corren los consumidores:
   ```bash
   curl -H "X-Internal-Secret: <secret>" \
     https://auth.hagemsa.com/api/internal/roles-permisos
   # 200 con { version, roles: { ... } }
   ```
5. **Flip:** setear `JWT_EMBED_PERMISOS=false` en el Auth Service y redeployar:
   ```bash
   gcloud run services update auth-service --region=us-central1 \
     --update-env-vars=JWT_EMBED_PERMISOS=false
   ```
6. **Validar en caliente:** un login nuevo debe emitir un JWT **notablemente más
   chico** (solo `{ role, scope }` en `roles[]`), y los endpoints protegidos deben
   seguir respondiendo 200/403 igual que antes. Revisar logs de los consumidores por
   errores de resolución del catálogo.

**Rollback:** volver a `JWT_EMBED_PERMISOS=true` (o quitar la env) y redeployar el
Auth Service. Los tokens vuelven a viajar gordos al instante; no hace falta tocar los
consumidores (el guard sigue aceptando ambos formatos). Los JWT flacos ya emitidos
se resuelven por catálogo hasta que expiran.

> **Nota:** los access token flacos ya emitidos y los gordos conviven sin problema
> durante la transición — cada uno se autoriza según su propio formato.

## Runbook: backup y restore de la DB

**Backup manual:**

```bash
gcloud sql backups create --instance=hagemsa-postgresql --description="manual backup pre-deploy"
```

**Restore desde backup:**

```bash
# Listar backups disponibles
gcloud sql backups list --instance=hagemsa-postgresql

# Restaurar (crea una nueva instancia)
gcloud sql backups restore <backup-id> \
  --restore-instance=hagemsa-postgresql-restore \
  --backup-instance=hagemsa-postgresql
```

> Cloud SQL hace backups automáticos diarios. Configurar la retención: `gcloud sql instances patch hagemsa-postgresql --backup-start-time=03:00 --backup-location=us-central1`.

## Runbook: escalar Cloud Run en respuesta a tráfico

Si el tráfico crece y Cloud Run no escala suficientemente:

```bash
gcloud run services update auth-service \
  --region=us-central1 \
  --min-instances=2 \
  --max-instances=50 \
  --concurrency=100
```

> `min-instances` evita cold starts pero cuesta dinero todo el tiempo. Solo subirlo si la latencia p95 de cold start es inaceptable.

## Runbook: investigación de incidente de seguridad

1. **Identificar el alcance:** ¿qué cuentas/sesiones están afectadas?
2. **Snapshot del audit log** del período sospechoso:
   ```sql
   SELECT * FROM audit.auth_events
   WHERE occurred_at BETWEEN '<inicio>' AND '<fin>'
   ORDER BY occurred_at;
   ```
3. **Snapshot de sesiones activas** del período:
   ```sql
   SELECT * FROM sessions.active_sessions
   WHERE issued_at BETWEEN '<inicio>' AND '<fin>';
   ```
4. **Cross-reference con logs de Cloud Run** para correlation IDs específicos.
5. **Si compromiso confirmado:**
   - Suspender cuentas afectadas.
   - Revocar todas sus sesiones.
   - Forzar reset de password.
   - Considerar rotación de `jwt-private-key` (revoca TODAS las sesiones del sistema).
6. **Post-incidente:** RCA + actualizar este runbook con lecciones aprendidas.
