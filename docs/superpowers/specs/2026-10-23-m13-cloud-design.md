# M13 — Cloud, dominios y producción: diseño

Rama: `milestone-13-cloud` (desde `master`, tras el PR de M12). Base común: [roadmap](2026-10-23-m8-m13-roadmap-design.md).

## Objetivo

Ver desde Steward cómo están las aplicaciones que ya corren en producción: qué dominios tiene cada proyecto, a dónde resuelven, qué proxy o CDN los atiende, qué balanceadores e instancias hay detrás, si los certificados están al día y si responden. Primero **lectura y comprobaciones**; la edición de DNS llega en una fase propia, con las máximas confirmaciones.

## Decisiones

| Tema | Decisión |
| --- | --- |
| Proveedores | AWS (EC2, ELBv2, Route 53, CloudFront, ACM, CloudWatch, STS) y Cloudflare (DNS, proxy, SSL). GCP, Azure, DigitalOcean y Hetzner quedan fuera. |
| Orden | Los **checks no necesitan credenciales** (DNS, TLS, HTTP resueltos desde tu máquina), así que van primero y ya aportan valor; luego inventario de AWS/Cloudflare; luego topología; al final, edición. |
| Credenciales AWS | Perfiles y SSO de `~/.aws` por defecto (Steward no guarda nada; el SDK los lee en main). Alternativa: access key guardada en `secret-store`. Se documenta una política IAM de solo lectura mínima. |
| Credenciales Cloudflare | Token de API con scopes mínimos (`Zone:Read`, `DNS:Read`, `SSL and Certificates:Read`; `DNS:Edit` solo para 13.4), en `secret-store`. |
| Escrituras | Solo DNS (Route 53 y Cloudflare), en 13.4, con vista previa del cambio, `confirmed: true`, tecleo del dominio en entornos protegidos y registro del "antes" en `executions`. |
| Monitoreo continuo | Los checks corren **mientras Steward está abierto**. No es un monitor 24/7 y la UI lo dice. |
| Fuera de alcance | Crear o destruir infraestructura, ECS/EKS/RDS/S3/Lambda (posible 13.5), costos, IAM, security groups en escritura. |

## 1. Datos (m021–m023)

```
cloud_accounts(id PK, project_id FK→projects ON DELETE CASCADE,
               environment_id FK NULL ON DELETE SET NULL,
               provider CHECK IN ('aws','cloudflare'), name,
               config_json,          -- aws: { authKind:'profile'|'access_key', profile, regions[] }; cloudflare: { accountId }
               created_at, updated_at)
               UNIQUE(project_id, name)

domains(id PK, project_id FK, environment_id FK NULL ON DELETE SET NULL,
        repository_id FK NULL ON DELETE SET NULL,
        cloud_account_id FK NULL ON DELETE SET NULL,
        hostname,                    -- validado como nombre DNS, minúsculas, sin esquema ni ruta
        notes, created_at, updated_at)
        UNIQUE(project_id, hostname)

endpoint_checks(id PK, project_id FK, domain_id FK NULL ON DELETE CASCADE,
                kind CHECK IN ('dns','tls','http','tcp','ping'),
                target,              -- hostname, URL https/http o IP[:puerto]; validado por kind
                config_json,         -- esperado (IPs, estado HTTP, texto), método, resolver, puerto
                interval_seconds, enabled INTEGER, created_at, updated_at)

check_results(id PK, check_id FK→endpoint_checks ON DELETE CASCADE,
              ts, ok INTEGER, latency_ms NULL, summary, detail_json)
              -- retención: 7 días y 2000 filas por check, podado al escribir
```

- Secretos de cuentas (access key de AWS, token de Cloudflare) en `secret-store` por id de cuenta, como en M10–M12. Un perfil de AWS no guarda secreto: solo el nombre.
- `ssh_hosts` ya tiene `ip_address`, `domain`, `provider`, `region`, `vpc_*` (m008–m009): sirven para enlazar infraestructura con servidores sin duplicar datos.
- m021: `domains`, `endpoint_checks`, `check_results`, pestaña `cloud`. m022: `cloud_accounts`. m023: reservada para ajustes de 13.3–13.5.

## 2. Servicios en main

`domain.service`, `check.service` (planificador y ejecución), `check-dns.ts` / `check-tls.ts` / `check-http.ts` / `check-tcp.ts` / `check-ping.ts`, `cloud-account.service`, `aws-inventory.service` (+ un módulo por servicio AWS), `cloudflare.service`, `topology.service`, `dns-change.service` (13.4).

### Checks

- **DNS:** `node:dns/promises` con `Resolver` y servidor configurable (`1.1.1.1`, `8.8.8.8` o el del sistema); registros A/AAAA/CNAME/MX/TXT/NS. Con "esperado" (lista de IPs o CNAME) detecta **deriva** respecto a lo declarado en Route 53/Cloudflare.
- **TLS:** `tls.connect` con SNI; lee sujeto, emisor, SAN, cadena, `valid_to`. Estado `warn` a < 21 días y `fail` a < 7 o caducado o no coincide el nombre.
- **HTTP(S):** `GET`/`HEAD`, redirecciones manuales (máx. 5, se muestran), estado, latencia por fase aproximada, y cabeceras para **identificar el proxy/CDN** (`cf-ray` → Cloudflare, `x-amz-cf-id`/`via: CloudFront` → CloudFront, `server: awselb/2.0` → ALB). Condición esperada: estado, y opcionalmente texto en el cuerpo (primeros 64 KB).
- **TCP / ping (13.5):** alcance de `IP:puerto` y `ping` mediante `run.ts` (`ping -n 1` / `ping -c 1`, host validado como IP o nombre, sin shell). Solo objetivos definidos explícitamente por el usuario: **no hay escaneo de rangos ni de puertos**.
- Validación de objetivos: solo `http:`/`https:`, sin credenciales en la URL, host válido; un dominio ya registrado en el proyecto o una IP puesta por el usuario. Intervalo mínimo 30 s, máximo 20 checks activos por proyecto y 4 en paralelo.
- Resultado: `ok` + latencia + resumen legible; la UI agrega dos señales por dominio: **conexión** (¿resuelve y responde?) y **operativo** (`healthy`/`degraded`/`failing`, por los últimos N resultados).

### AWS (solo lectura, 13.2)

SDK v3 modular con `@aws-sdk/credential-providers` (`fromIni`, `fromSSO`). Un cliente por servicio y región, cacheados y cerrados con la cuenta.

- **STS** `GetCallerIdentity` (prueba de conexión: cuenta y ARN).
- **EC2:** `DescribeInstances` (estado, IP pública/privada, tipo, VPC, tags), `DescribeAddresses` (Elastic IP), `DescribeVpcs`/`DescribeSubnets`, `DescribeSecurityGroups` (solo lectura, para ver puertos abiertos).
- **ELBv2:** balanceadores, listeners, target groups y `DescribeTargetHealth`.
- **Route 53:** zonas y `ListResourceRecordSets`. **CloudFront:** distribuciones con alias y orígenes. **ACM:** certificados, dominios, expiración y "en uso por".
- **CloudWatch** `GetMetricData`: CPU y `StatusCheckFailed` de EC2; `HTTPCode_Target_5XX_Count`, `TargetResponseTime` y `HealthyHostCount` de ALB; `5xxErrorRate` de CloudFront (región `us-east-1`). Gráficas con `uplot`.
- **SSO caducado:** el error se traduce a "sesión SSO caducada" con un botón que lanza `aws sso login --profile <perfil>` mediante `run.ts` (perfil validado contra `^[A-Za-z0-9_.-]+$`), si el CLI está instalado.
- Llamadas solo al abrir la vista o al pulsar *Refresh*; caché en memoria de 60 s; paginación completa con tope por servicio y región (`CLOUD_TOO_MANY_RESULTS` si se supera).
- La UI ofrece copiar la política IAM de solo lectura mínima (`ec2:Describe*`, `elasticloadbalancing:Describe*`, `route53:List*`/`Get*`, `cloudfront:List*`/`Get*`, `acm:List*`/`Describe*`, `cloudwatch:GetMetricData`/`ListMetrics`, `sts:GetCallerIdentity`).

### Cloudflare (13.2)

`/user/tokens/verify`, `/zones`, `/zones/:id/dns_records` (tipo, contenido, `proxied`, TTL), `/zones/:id/settings/ssl` (modo SSL), `/zones/:id/ssl/certificate_packs`. Paginado, con tope. Los datos de proxy permiten decir si un dominio está "detrás de Cloudflare" (nube naranja) o es solo DNS.

### Topología (13.3)

`topology.service` cruza lo ya leído para armar capas **dominio → registros DNS → proxy/CDN → balanceador → instancia → servidor SSH del proyecto**:

- registro `CNAME`/`ALIAS` que apunta a un `DNSName` de ELB o a un dominio de CloudFront → ese recurso;
- registro `A` o IP resuelta que coincide con una IP pública/Elastic de EC2 → esa instancia;
- IP o dominio de una instancia o registro que coincide con `ssh_hosts.ip_address`/`domain` → ese servidor, con enlace a su pestaña **Docker** (M8);
- IPs de Cloudflare conocidas (resueltas, no listas codificadas) → "proxy Cloudflare".

La UI lo muestra en columnas (listas conectadas, sin grafo de fuerzas) y marca lo que **no se pudo clasificar** en vez de inventarlo.

### Edición de DNS (13.4)

- Route 53: `ChangeResourceRecordSets` (`UPSERT`/`DELETE`). Cloudflare: crear/actualizar/borrar registro, `proxied`, TTL.
- Flujo: formulario → **vista previa** (antes → después) → confirmación (`confirmed: true`; en entorno protegido, tecleo del hostname exacto y mostrar cuenta/zona) → ejecución → relectura para verificar que quedó como se pidió.
- `executions` (`kind: 'dns_change'`) guarda el registro **anterior** y el nuevo (los registros DNS no son secretos), de modo que el usuario pueda revertir a mano con los datos exactos.
- Sin cambios masivos, sin borrar zonas, sin tocar `NS`/`SOA` en la raíz.

### Errores

`CLOUD_AUTH_FAILED`, `CLOUD_SESSION_EXPIRED` (SSO), `CLOUD_ACCESS_DENIED` (falta permiso; indica cuál), `CLOUD_RATE_LIMITED`, `CLOUD_UNREACHABLE`, `CLOUD_TOO_MANY_RESULTS`, `CLOUD_CHANGE_FAILED`, `CHECK_INVALID_TARGET`, `CHECK_LIMIT`, y los comunes.

### Canales (agrupados)

`domains:list/create/update/delete`, `checks:list/create/update/delete/runNow/results`, `cloud:accounts:list/create/update/delete/test`, `cloud:aws:inventory` `{ accountId, region, resource }`, `cloud:aws:metrics`, `cloud:cloudflare:zones/records`, `cloud:topology`, `cloud:dns:preview` / `cloud:dns:apply` (13.4), `cloud:aws:ssoLogin`.

## 3. UI (`features/cloud/`, `stores/cloud.store.ts`)

- **Domains:** lista del proyecto con hostname, entorno, repositorio y **dos `Pill`** (conexión / operativo), días hasta caducidad del certificado, última latencia y proxy detectado. Detalle con resultados recientes de cada check (mini-gráfica de latencia) y registros DNS actuales.
- **Checks:** crear con plantillas (*HTTPS + certificado + DNS* con un clic al registrar un dominio), ejecutar ahora, historial.
- **Accounts:** alta de AWS (perfil/region o access key) y Cloudflare (token), *Test connection*, política mínima copiable.
- **Inventory:** pestañas AWS (Instances, Load balancers, CloudFront, Certificates, Route 53) y Cloudflare (Zones, DNS), con filtros y enlaces "abrir en la consola".
- **Map:** topología por columnas con elementos no clasificados marcados.
- **Metrics:** CloudWatch con selector de recurso y rango.
- **DNS editor** (13.4) con vista previa.
- En el Overview del proyecto, una tarjeta "Producción" con el peor estado entre sus dominios (13.5).

## 4. Fases

1. **13.1** Dominios y checks DNS/TLS/HTTP (sin credenciales), planificador mientras la app está abierta, historial y pills.
2. **13.2** Cuentas AWS y Cloudflare, inventario de solo lectura y CloudWatch.
3. **13.3** Topología y enlaces a Docker/SSH.
4. **13.4** Edición de DNS (Route 53 y Cloudflare) con vista previa y confirmación.
5. **13.5** Checks TCP/ping, tarjeta en el Overview, y servicios extra de AWS (ECS, RDS) si se piden.

## 5. Qué debe probar el usuario (manual)

1. Registrar un dominio real de tus apps: se crean los checks; DNS muestra IPs, TLS muestra emisor y días restantes, HTTP muestra estado, latencia y el proxy detectado (Cloudflare/CloudFront/ALB si aplica).
2. Dominio inexistente: DNS falla con mensaje claro. Certificado a punto de caducar (usar `expired.badssl.com`): estado `fail`. Cambiar el "esperado" a una IP distinta marca deriva.
3. Cerrar Steward y reabrir: el historial persiste; los checks se reanudan; la UI avisa de que solo corren con la app abierta.
4. Cuenta AWS con perfil (y con SSO): *Test* muestra la cuenta; con SSO caducado aparece el botón de login; con permisos faltantes el error dice qué permiso. Ver instancias, balanceadores, zonas y certificados reales; comprobar que la política mínima basta.
5. Cuenta Cloudflare con token mínimo: zonas y registros; token sin `Zone:Read` da `CLOUD_ACCESS_DENIED` claro.
6. Topología: un dominio con ALB + EC2 aparece encadenado; una IP que no se reconoce queda como "no clasificada"; el enlace a un servidor SSH propio abre su pestaña Docker.
7. Métricas de CloudWatch coherentes con la consola de AWS para la misma ventana.
8. Edición de DNS (13.4, en un registro de prueba): la vista previa muestra antes/después; en un entorno protegido pide el hostname exacto; tras aplicar, la relectura coincide; `executions` conserva el registro anterior; cancelar no cambia nada.
9. Comprobar en devtools y en el `.db` que no hay access keys ni tokens, y que un perfil de AWS no guarda secretos.
10. Intentar un check contra `http://usuario:clave@host` o un rango de IPs: se rechaza (`CHECK_INVALID_TARGET`).

## 6. Límites conocidos

- Sin monitoreo 24/7: si Steward está cerrado no hay checks.
- Sin GCP, Azure ni proveedores de VPS; sin costos ni IAM.
- La topología es heurística (coincidencias de nombre e IP): puede dejar elementos sin clasificar, nunca inventa enlaces.
- La edición de DNS no cubre zonas delegadas ni cambios masivos.
