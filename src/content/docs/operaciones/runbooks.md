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

1. **Generar nuevo secret:**
   ```bash
   openssl rand -base64 32 > /tmp/new-secret.txt
   ```
2. **Coordinar ventana de cambio** con todos los equipos de backends.
3. **Subir nueva versión** del secret en GCP:
   ```bash
   gcloud secrets versions add internal-shared-secret --data-file=/tmp/new-secret.txt
   ```
4. **Cada equipo de backend:**
   - Actualiza su Secret Manager con el nuevo valor.
   - Redeploya su servicio.
5. **Deshabilitar versión anterior** en `internal-shared-secret`:
   ```bash
   gcloud secrets versions disable <version-anterior> --secret=internal-shared-secret
   ```
6. **Redeploy del Auth Service** para que cargue la nueva versión.
7. **Borrar archivo temporal:**
   ```bash
   rm /tmp/new-secret.txt
   ```

> **Durante la ventana de transición:** los backends que aún tienen el secret viejo van a recibir 401 al consultar `/api/internal/*`, lo que los hace fail-closed y rechazar JWTs. Idealmente, esta ventana es muy corta (< 1 minuto).

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
