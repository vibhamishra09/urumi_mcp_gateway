# System Design and Tradeoffs

This document details the architectural choices, tradeoffs, aggregation mechanics, failure handling strategies, and production readiness considerations for the **Urumi WooCommerce & MCP Gateway Platform**.

---

## 1. Architectural Choices & Tradeoffs

```
                         ┌──────────────────────────────────────────────┐
                         │               Ingress (Nginx)                │
                         │      HTTP/HTTPS Ingress & Routing            │
                         └──────┬───────────────────────────────┬───────┘
                                │                               │
                     store.<domain>                 dashboard.<domain>
                                │                               │
                                ▼                               ▼
                ┌─────────────────────────┐    ┌─────────────────────────────────┐
                │    WooCommerce Store    │    │      Gateway Web Dashboard      │
                │   (WordPress + Woo)     │    │      (React SPA / Nginx)        │
                └───────────┬─────────────┘    └────────────────┬────────────────┘
                            │                                   │ (proxies /api & /mcp)
                            │                                   ▼
                            │                  ┌─────────────────────────────────┐
                            │                  │      Urumi Gateway Backend      │
                            │                  │    (Express + MCP Aggregator)   │
                            │                  └──────┬──────────┬──────────┬────┘
                            │                         │          │          │
                    REST API│ (K8s Service)           │          │          │
                            ▼                         │          │          │
                ┌─────────────────────────┐           │          │          │
                │   WooCommerce MCP Pod   │◄──────────┘          │          │
                │  (Streamable HTTP /mcp) │                      │          │
                │   (ClusterIP + NetPol)  │                      │          │
                │                         │                      ▼          ▼
                └─────────────────────────┘       ┌────────────────┐ ┌────────────────┐
                                                  │  Weather MCP   │ │ Calculator MCP │
                                                  │  (Port 3001)   │ │  (Port 3002)   │
                                                  └────────────────┘ └────────────────┘
```

### 1.1 Gateway Proxy / Aggregator vs. Direct Client Access

| Aspect | Gateway Aggregator (Our Choice) | Direct Upstream Connection |
| :--- | :--- | :--- |
| **Client Configuration** | Single endpoint (`/mcp`) & 1 API key | Client must configure N endpoints & N sets of credentials |
| **Credential Security** | Upstream credentials stored encrypted on gateway; never exposed | Sensitive store API keys distributed to all client laptops/tools |
| **Audit & Governance** | Centralized, attributed audit log with latency and status | Fragmented logs; zero attribution across external AI clients |
| **Access Control (RBAC)**| Granular per-role tool filtering (Admin vs. Member) | All-or-nothing access to upstream endpoints |

**Tradeoff Decision**:
By placing the Gateway as a reverse proxy and aggregator, we accept a tiny latency overhead (typically 1–3ms) in exchange for:
- Zero credential leakage to clients.
- Centralized audit trail for all AI and user tool calls.
- Unified role-based access control (RBAC).

---

### 1.2 Decoupled WooCommerce MCP Microservice (REST API v3 vs. WP-CLI)

| Factor | REST API v3 Microservice (Our Choice) | WP-CLI Pod Exec (`kubectl exec`) |
| :--- | :--- | :--- |
| **Security & RBAC** | Standard HTTP API keys; no K8s API permissions needed | Requires `pods/exec` cluster privileges, a severe security liability |
| **Fault Isolation** | Runs in dedicated pod; memory leaks/crashes don't impact WP | Shared process tree or exec container overhead directly on WP |
| **Network Boundaries** | Strict NetworkPolicy: only Gateway can reach port 3000 | Bypasses network policies via control plane exec channel |
| **Cloud Native** | Scalable, standard HTTP REST endpoints with health checks | Dependent on local filesystem access and container binaries |

**Tradeoff Decision**:
We implemented a dedicated Node.js microservice (`services/woocommerce-mcp`) communicating over WooCommerce's official REST API v3. This decouples AI tool execution from WordPress core operations and strictly confines permissions.

---

### 1.3 Transport Protocol: Streamable HTTP (`POST /mcp`) vs. Stdio / SSE

| Feature | Streamable HTTP (Our Choice) | Standard Stdio | Server-Sent Events (SSE) |
| :--- | :--- | :--- | :--- |
| **Cloud Native** | Standard HTTP over K8s Services | Requires subprocess spawning | Requires persistent HTTP connections |
| **Load Balancing** | Stateless HTTP; works with any K8s Service / Ingress | Single process only | Requires sticky sessions or socket pinning |
| **Reconnection** | Per-request retry with standard backoff | Process restart required | Reconnect event stream renegotiation |

**Tradeoff Decision**:
We chose **MCP over Streamable HTTP** conforming to the Model Context Protocol SDK specification. Each tool invocation is a stateless JSON-RPC request over HTTP POST. This allows the Gateway backend to scale horizontally across multiple Kubernetes pods without sticky sessions.

---

### 1.4 State Persistence: PostgreSQL vs. In-Memory / File-based

- **PostgreSQL**: Selected for ACID transactional safety, relation foreign keys between users, API keys, servers, and audit logs, and instant scalability.
- **In-Memory Caching with DB Sync**: Server tool definitions are cached in memory for microsecond retrieval during tool listing, while being synchronized with PostgreSQL. If a gateway pod restarts, it immediately hydrates its tool cache from PostgreSQL without blocking.

---

## 2. Tool Aggregation, Routing, and Failure Handling

### 2.1 Namespace Collision Handling

When multiple upstream servers define identical tool names (e.g., `list_items`, `search`, or `status`), collision is inevitable without a naming strategy.

**Scheme**:
The Gateway enforces a deterministic double-underscore prefixing scheme:
$$\text{Exposed Tool Name} = \text{server\_slug} + \text{"\_\_"} + \text{tool\_name}$$

**Examples**:
- `woocommerce__list_products`
- `woocommerce__create_product`
- `weather__get_weather`
- `calculator__calculate`

**Routing Mechanics**:
1. When an incoming JSON-RPC `tools/call` request arrives at the Gateway:
   ```json
   {
     "jsonrpc": "2.0",
     "method": "tools/call",
     "params": {
       "name": "woocommerce__list_orders",
       "arguments": { "per_page": 5 }
     }
   }
   ```
2. The Gateway extracts the prefix `woocommerce` and tool `list_orders`.
3. It performs a role check: ensures the user's role has permission to invoke the specific tool.
4. It resolves the upstream server URL and credentials from PostgreSQL/cache.
5. It rewrites the JSON-RPC payload with the native upstream tool name (`list_orders`), injects server-side upstream credentials, and dispatches the HTTP POST to `http://woocommerce-mcp:3000/mcp`.
6. The upstream response is logged into `audit_logs` with latency in milliseconds, user ID, key ID, and return payload before returning to the caller.

---

### 2.2 Failure Isolation & Graceful Degradation

A core distributed systems requirement is that **failure of one upstream service must never cascade or degrade other services**.

```
                           ┌─────────────────────────┐
                           │      Gateway Cache      │
                           │  [woo, weather, calc]   │
                           └────────────┬────────────┘
                                        │
             ┌──────────────────────────┼──────────────────────────┐
             ▼                          ▼                          ▼
   ┌───────────────────┐      ┌───────────────────┐      ┌───────────────────┐
   │  WooCommerce MCP  │      │    Weather MCP    │      │  Calculator MCP   │
   │      (HEALTHY)    │      │    (POD KILLED)   │      │      (HEALTHY)    │
   └─────────┬─────────┘      └─────────┬─────────┘      └─────────┬─────────┘
             │                          │                          │
        HTTP 200 OK               ECONNREFUSED                HTTP 200 OK
             │                          │                          │
             ▼                          ▼                          ▼
      Tools Available          Status: unreachable        Tools Available
      Orders Query OK          Returns Structured Error   Calculations OK
```

1. **Independent Timeouts**: All upstream network calls are bounded by `UPSTREAM_TIMEOUT_MS` (default: 15,000ms). A hanging upstream server is terminated cleanly without exhausting Gateway HTTP worker pools.
2. **`Promise.allSettled` Non-Blocking Discovery**: When refreshing tool caches across all upstream servers, `Promise.allSettled` is used. If `weather-mcp` is dead, `woocommerce-mcp` and `calculator-mcp` refresh with zero interruption.
3. **Automated Health Tracking**: When an upstream call fails with `ECONNREFUSED` or timeout, the gateway marks the server's database status as `unreachable` and records the timestamp.
4. **Resilient Error Responses**: If a client invokes a tool on an unreachable upstream, the gateway does not drop the connection or crash. It returns a structured JSON-RPC error:
   ```json
   {
     "content": [
       { "type": "text", "text": "{\"error\":\"connect ECONNREFUSED 10.96.12.34:3001\",\"server\":\"weather\",\"tool\":\"get_weather\"}" }
     ],
     "isError": true
   }
   ```
   Other tools (like `woocommerce__list_orders`) continue executing concurrently without defect.

---

## 3. Production Readiness: What Changes from Dev to Prod

| Component | Local Development (Kind / k3d) | Production (k3s / Cloud Kubernetes) |
| :--- | :--- | :--- |
| **Domain & DNS** | Wildcard `.nip.io` (`store.127.0.0.1.nip.io`) | Public DNS A/CNAME records (`shop.company.com`, `gateway.company.com`) |
| **TLS & Certificates** | Plaintext HTTP (`tls: false`) | Automated TLS with `cert-manager` & Let's Encrypt (`ClusterIssuer`) |
| **Ingress Controller**| Port-forwarded NodePort / Kind Ingress | Cloud Load Balancer (AWS NLB, GCP Cloud LB) or Hetzner/DigitalOcean LB |
| **Storage Class** | HostPath / `standard` / `local-path` | Redundant distributed block storage (AWS `gp3`, Longhorn, Ceph/Rook) |
| **Secret Management**| Helm `values.yaml` plain values | SealedSecrets, HashiCorp Vault, or External Secrets Operator (AWS SSM/GSM) |
| **High Availability** | Single replica (`replicaCount: 1`) | Multi-replica (`replicaCount: 2+`) with PodDisruptionBudgets and HPA |
| **Database** | Single container MariaDB & PostgreSQL | Managed DB (AWS RDS Aurora / Cloud SQL) or Patroni HA PostgreSQL operator |

---

## 4. Helm Overrides Structure

To cleanly support local vs. production deployments without duplicate YAML manifests, the Helm chart uses value overrides:
- `helm/urumi/values.yaml`: Base chart defaults.
- `helm/urumi/values-local.yaml`: Overrides for local Kind/k3d development (nip.io DNS, HTTP).
- `helm/urumi/values-prod.yaml`: Overrides for production VPS (custom domains, cert-manager TLS annotations, persistent storage sizes, multi-replica gateway).

Deploying to production is as simple as:
```bash
helm upgrade --install urumi ./helm/urumi \
  -n urumi --create-namespace \
  -f ./helm/urumi/values-prod.yaml \
  --set ingress.storeDomain=shop.yourdomain.com \
  --set ingress.dashboardDomain=gateway.yourdomain.com \
  --set secrets.geminiApiKey=$PROD_GEMINI_API_KEY
```
