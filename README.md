# Urumi — WooCommerce Hosting with Team MCP Gateway

A production-ready platform running WooCommerce on Kubernetes and exposing its data—along with other upstream MCP servers—through a single authenticated team MCP gateway endpoint (`POST /mcp`), complete with a React dashboard, role-based tool permissions, and a built-in AI chat agent.

---

## 📑 Table of Contents
1. [Architecture Overview](#-architecture-overview)
2. [Stand-Out Differentiators Implemented](#-stand-out-differentiators-implemented)
3. [Repository Structure & Codebase Map](#-repository-structure--codebase-map)
4. [Local Setup Instructions](#-local-setup-instructions)
5. [VPS / Production Setup Instructions (k3s)](#-vps--production-setup-instructions-k3s)
6. [Step-by-Step Test Walkthrough](#-step-by-step-test-walkthrough)
   - [1. Placing an Order on the Store](#1-placing-an-order-on-the-storefront)
   - [2. Using the Chat Agent](#2-using-the-chat-agent)
   - [3. Connecting External MCP Clients (Claude Code, Cursor, curl)](#3-connecting-external-mcp-clients)
   - [4. Role-Based Access Control (Admin vs Member)](#4-role-based-tool-permissions-test)
   - [5. Upstream Pod Failure Resilience & Observability](#5-upstream-failure-resilience--observability)
7. [System Design & Tradeoffs (Summary)](#-system-design-and-tradeoffs)
8. [Threat Model (Summary)](#-threat-model)

---

## 🏛️ Architecture Overview

```
                         ┌──────────────────────────────────────────────┐
                         │               Ingress (Nginx)                │
                         │   http://*.127.0.0.1.nip.io (Local DNS)      │
                         └──────┬───────────────────────────────┬───────┘
                                │                               │
               store.127.0.0.1.nip.io           dashboard.127.0.0.1.nip.io
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
                └─────────────────────────┘                      │          │
                                                                 ▼          ▼
                                                  ┌────────────────┐ ┌────────────────┐
                                                  │  Weather MCP   │ │ Calculator MCP │
                                                  │  (Port 3001)   │ │  (Port 3002)   │
                                                  └────────────────┘ └────────────────┘
```

The system has four core layers running natively in Kubernetes:
1. **Store**: WordPress 6.7 + WooCommerce backed by MariaDB, utilizing PersistentVolumeClaims (`woocommerce-pvc`, `mariadb-pvc`). Cash on Delivery (COD) is pre-configured for instant test checkout.
2. **WooCommerce MCP Server**: Dedicated Node.js microservice speaking **MCP over Streamable HTTP** (`POST /mcp`), interacting with WooCommerce via the official REST API v3. Enforced by Kubernetes NetworkPolicy so only the Gateway can communicate with it.
3. **Gateway Backend & Dashboard**: 
   - **Backend**: Express + PostgreSQL. Acts as an MCP client to all registered upstream servers and as a single aggregated MCP server to team members and external clients (`POST /mcp`).
   - **Dashboard**: React SPA with dark mode, tool inspection, server enable/disable/health monitoring, member invitation, API key management, audit logs, and an integrated chat agent.
4. **Chat Agent**: Conversational agent integrated into the dashboard (Gemini 1.5 Flash with fallback local orchestrator) that executes tools dynamically through the gateway and attributes each tool call to the active user.

---

## 🌟 Stand-Out Differentiators Implemented

We have implemented deep stand-out differentiators across the platform:

| # | Feature / Differentiator | Implementation Details | Location in Codebase |
| :--- | :--- | :--- | :--- |
| **1** | **Production-like VPS Deployment** | Full k3s guide, real domain routing, `cert-manager` automated Let's Encrypt TLS, `local-path` persistent storage, and HA configuration. | [`helm/urumi/values-prod.yaml`](file:///Users/vibhamishra/Documents/work/urumi/helm/urumi/values-prod.yaml), [`README.md`](file:///Users/vibhamishra/Documents/work/urumi/README.md#vps--production-setup-instructions-k3s) |
| **2** | **Tool Permissions (RBAC)** | Per-role tool authorization. Members can query catalog & orders; only Admins can create products or update order status. Restricted tools are hidden from `tools/list` and rejected on execution. | [`services/gateway/backend/src/mcp/client.js`](file:///Users/vibhamishra/Documents/work/urumi/services/gateway/backend/src/mcp/client.js), [`gateway-server.js`](file:///Users/vibhamishra/Documents/work/urumi/services/gateway/backend/src/mcp/gateway-server.js), [`chat.js`](file:///Users/vibhamishra/Documents/work/urumi/services/gateway/backend/src/routes/chat.js) |
| **6** | **Security Hardening** | NetworkPolicy denying non-gateway traffic to WooCommerce MCP; SHA-256 key hashing; zero credentials sent to clients; SSRF protection blocking cloud metadata (`169.254.169.254`). | [`helm/urumi/templates/mcp-servers/woocommerce-mcp.yaml`](file:///Users/vibhamishra/Documents/work/urumi/helm/urumi/templates/mcp-servers/woocommerce-mcp.yaml), [`servers.js`](file:///Users/vibhamishra/Documents/work/urumi/services/gateway/backend/src/routes/servers.js) |
| **7** | **Horizontal Scaling** | Gateway backend is completely stateless and ready for multi-replica scaling (`replicaCount: 2+`) with shared PostgreSQL backend and stateless HTTP JSON-RPC. | [`helm/urumi/templates/gateway/backend.yaml`](file:///Users/vibhamishra/Documents/work/urumi/helm/urumi/templates/gateway/backend.yaml), [`values-prod.yaml`](file:///Users/vibhamishra/Documents/work/urumi/helm/urumi/values-prod.yaml) |
| **8** | **Observability & Health Tracking** | Real-time audit log with duration in milliseconds, status tracking (`connected`, `unreachable`, `disabled`), caller attribution, and resilient non-blocking failure isolation. | [`services/gateway/backend/src/mcp/gateway-server.js`](file:///Users/vibhamishra/Documents/work/urumi/services/gateway/backend/src/mcp/gateway-server.js), [`services/gateway/frontend/src/pages/AuditLog.jsx`](file:///Users/vibhamishra/Documents/work/urumi/services/gateway/frontend/src/pages/AuditLog.jsx) |

---

## 📁 Repository Structure & Codebase Map

- **`services/gateway/frontend/`**: React SPA dashboard (Dark mode, Servers list, Tool explorer, User management, API keys, Audit log, Chat agent).
- **`services/gateway/backend/`**: Express + PostgreSQL backend. Aggregates upstream MCP tools, executes RBAC tool authorization, logs audit trails, and hosts `/mcp` and `/api`.
- **`services/woocommerce-mcp/`**: Node.js MCP microservice running over Streamable HTTP (`POST /mcp`) using WooCommerce REST API v3.
- **`services/weather-mcp/`** & **`services/calculator-mcp/`**: Upstream MCP microservices for multi-server aggregation testing.
- **`helm/urumi/`**: Production Helm chart containing deployments, services, ingress, secrets, persistent volume claims, and network policies.
  - `values.yaml`: Base chart settings.
  - `values-local.yaml`: Overrides for local Kind/k3d development.
  - `values-prod.yaml`: Overrides for production VPS (custom domains, cert-manager TLS, HA replicas).
- **`scripts/`**: Automation scripts for cluster creation, ingress installation, Helm deployment, and WooCommerce bootstrapping.
- **`SYSTEM_DESIGN.md`**: Detailed system architecture, tool collision handling, failure resilience, and tradeoffs.
- **`THREAT_MODEL.md`**: Comprehensive security threat model covering credentials, token passthrough, prompt injection, and cross-member security.

---

## 💻 Local Setup Instructions

### Prerequisites
- Docker Desktop or OrbStack
- `kubectl` and `helm` v3
- `curl` and `jq`

### 1. Create Local Cluster (Kind or k3d)
```bash
./scripts/create-cluster.sh
```

### 2. Install Ingress Controller
```bash
./scripts/install-ingress.sh
```

### 3. Deploy Helm Chart
```bash
./scripts/deploy.sh
```

### 4. Bootstrap WooCommerce & Seed Catalog
```bash
./scripts/seed-woocommerce.sh
```
*This installs WordPress, activates WooCommerce, creates an admin user, enables Cash on Delivery (COD), generates API keys, injects them into Kubernetes Secrets, and registers the server in PostgreSQL.*

### 5. Access Endpoints
- **Storefront**: [http://store.127.0.0.1.nip.io](http://store.127.0.0.1.nip.io)
- **WP Admin**: [http://store.127.0.0.1.nip.io/wp-admin](http://store.127.0.0.1.nip.io/wp-admin) (`admin` / `changeme123`)
- **Gateway Dashboard**: [http://dashboard.127.0.0.1.nip.io](http://dashboard.127.0.0.1.nip.io) (`admin` / `changeme123`)
- **Gateway MCP Endpoint**: `http://dashboard.127.0.0.1.nip.io/mcp`

---

## ☁️ VPS / Production Setup Instructions (k3s)

Deploying to a single-node or multi-node Linux VPS (Ubuntu 22.04 / Debian 12 on Hetzner, DigitalOcean, Linode, or AWS):

### 1. Install k3s on the VPS
```bash
# Install k3s with default Traefik disabled (using Nginx Ingress)
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--disable traefik" sh -

# Configure kubeconfig
mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown $(id -u):$(id -g) ~/.kube/config
export KUBECONFIG=~/.kube/config
```

### 2. Install Nginx Ingress & Cert-Manager
```bash
# Install Nginx Ingress Controller
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
  -n ingress-nginx --create-namespace \
  --set controller.service.type=LoadBalancer

# Install cert-manager for automated Let's Encrypt TLS
helm repo add jetstack https://charts.jetstack.io
helm repo update
helm upgrade --install cert-manager jetstack/cert-manager \
  -n cert-manager --create-namespace \
  --set installCRDs=true
```

### 3. Create Let's Encrypt ClusterIssuer
Create `cluster-issuer.yaml`:
```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: admin@yourdomain.com
    privateKeySecretRef:
      name: letsencrypt-prod-account-key
    solvers:
    - http01:
        ingress:
          class: nginx
```
Apply it:
```bash
kubectl apply -f cluster-issuer.yaml
```

### 4. Configure DNS Records
Point your public domain DNS records to your VPS IP:
- `shop.yourdomain.com` → `<VPS_PUBLIC_IP>`
- `gateway.yourdomain.com` → `<VPS_PUBLIC_IP>`

*(Alternatively, you can use nip.io with your public IP: `shop.<VPS_PUBLIC_IP>.nip.io`)*

### 5. Deploy Urumi with Production Values
```bash
helm upgrade --install urumi ./helm/urumi \
  -n urumi --create-namespace \
  -f ./helm/urumi/values-prod.yaml \
  --set ingress.storeDomain=shop.yourdomain.com \
  --set ingress.dashboardDomain=gateway.yourdomain.com \
  --set secrets.mariadbRootPassword=$(openssl rand -hex 16) \
  --set secrets.mariadbUserPassword=$(openssl rand -hex 16) \
  --set secrets.postgresPassword=$(openssl rand -hex 16) \
  --set secrets.jwtSecret=$(openssl rand -hex 32) \
  --set secrets.adminPassword="StrongAdminPasswordHere!" \
  --set secrets.geminiApiKey="YOUR_GEMINI_API_KEY"
```

---

## 🧪 Step-by-Step Test Walkthrough

### 1. Placing an Order on the Storefront
1. Navigate to the store: [http://store.127.0.0.1.nip.io](http://store.127.0.0.1.nip.io).
2. Browse products, add **"Wireless Headphones Pro"** to your cart.
3. Proceed to checkout, fill in test billing details.
4. Select **Cash on delivery (COD)** and click **Place Order**.
5. Confirm order receipt page displays Order Number and details.
6. Verify in WP Admin ([http://store.127.0.0.1.nip.io/wp-admin](http://store.127.0.0.1.nip.io/wp-admin)): Under **WooCommerce → Orders**, the order appears with status `processing`.

---

### 2. Using the Chat Agent
1. Log into the Dashboard at [http://dashboard.127.0.0.1.nip.io](http://dashboard.127.0.0.1.nip.io) as `admin` / `changeme123`.
2. Open the **Chat Agent** tab.
3. **Test Admin Product Creation**:
   ```text
   Create a product named "Ergonomic Mechanical Keyboard" with price 129.99
   ```
   - Notice the badge `woocommerce__create_product` executes with the arguments.
   - Refresh the storefront: the new product immediately appears in the catalog!
4. **Test Querying Orders**:
   ```text
   What orders came in today?
   ```
   - Notice the badge `woocommerce__list_orders` executes and lists the active store orders with customer names and totals.
5. **Test Multi-Server Aggregation in Chat**:
   ```text
   What is the weather in Tokyo and calculate 129.99 * 0.85 for a 15% discount?
   ```
   - The agent calls `weather__get_weather` and `calculator__calculate` in parallel.

---

### 3. Connecting External MCP Clients

Connect **Claude Code**, **Cursor**, **MCP Inspector**, or test directly via `curl`.

#### Obtaining an API Key
1. In the Dashboard, go to **API Keys** → click **+ Create Key**.
2. Name it `external-client` and copy the generated raw token: `urumi_...`.

#### Using `curl`
```bash
export API_KEY="<your_raw_api_key>"
export GATEWAY_URL="http://dashboard.127.0.0.1.nip.io/mcp"

# 1. List Available Tools
curl -s -X POST $GATEWAY_URL \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | jq .

# 2. Query WooCommerce Orders
curl -s -X POST $GATEWAY_URL \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"woocommerce__list_orders","arguments":{"per_page":5}}}' | jq .

# 3. Weather Upstream Query
curl -s -X POST $GATEWAY_URL \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"weather__get_weather","arguments":{"city":"London"}}}' | jq .

# 4. Calculator Upstream Query
curl -s -X POST $GATEWAY_URL \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"calculator__calculate","arguments":{"expression":"129.99 * 0.8"}}}' | jq .
```

#### Connecting Claude Code or Cursor
In your client MCP settings (`~/.cursor/mcp.json` or `claude.json`):
```json
{
  "mcpServers": {
    "urumi-gateway": {
      "url": "http://dashboard.127.0.0.1.nip.io/mcp",
      "headers": {
        "x-api-key": "urumi_your_api_key_here"
      }
    }
  }
}
```

---

### 4. Role-Based Tool Permissions Test

1. **Invite a Member**:
   - In Dashboard → **Team Members** → Invite `alice` (`alice@urumi.local`, role: `member`).
2. **Generate Key for Alice**:
   - Log in as Alice (or generate an API key for Alice under API Keys).
3. **Verify Restricted Tools are Hidden**:
   - When Alice calls `tools/list`, write operations (`woocommerce__create_product`, `woocommerce__update_order_status`) are **not present** in the tools array.
4. **Verify Direct Invocation Rejection**:
   - If Alice tries to call `woocommerce__create_product`:
   ```bash
   curl -s -X POST http://dashboard.127.0.0.1.nip.io/mcp \
     -H "Content-Type: application/json" \
     -H "x-api-key: <alice_key>" \
     -d '{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"woocommerce__create_product","arguments":{"name":"Hacked Item","regular_price":"1.00"}}}' | jq .
   ```
   - **Result**:
   ```json
   {
     "content": [
       { "type": "text", "text": "{\"error\":\"Permission denied: role 'member' is not authorized to invoke 'woocommerce__create_product'. Admin privileges required.\",\"server\":\"woocommerce\",\"tool\":\"create_product\"}" }
     ],
     "isError": true
   }
   ```
5. **Key Revocation Verification**:
   - Admin clicks **Revoke** on Alice's key in Dashboard.
   - Calling `/mcp` with that key immediately returns `401 Unauthorized: Invalid or revoked API key`.

---

### 5. Upstream Failure Resilience & Observability

1. **Simulate Upstream Pod Failure**:
   ```bash
   kubectl delete pod -n urumi -l app=weather-mcp
   ```
2. **Test Resilience**:
   - Call `woocommerce__list_orders` and `calculator__calculate`: both continue working instantly without defect.
   - Call `weather__get_weather`: returns a clean JSON-RPC error `{ error: "connect ECONNREFUSED...", isError: true }` without crashing the Gateway.
   - The Dashboard updates the server status to `unreachable`.
3. **Audit Log Attribution**:
   - Open **Audit Log** in the Dashboard.
   - Confirm every call shows: Timestamp, User attribution (`admin` vs `alice`), Tool Name, Execution Latency (ms), and Success/Failure badge.

---

## 🏛️ System Design and Tradeoffs

*(Read the complete document in [SYSTEM_DESIGN.md](file:///Users/vibhamishra/Documents/work/urumi/SYSTEM_DESIGN.md))*

- **Decoupled Architecture**: WooCommerce MCP runs in a separate pod using official REST API v3 over HTTP rather than `kubectl exec` / WP-CLI, enforcing strict Kubernetes NetworkPolicy isolation.
- **Collision Handling**: Deterministic namespacing (`<server_slug>__<tool_name>`) prevents tool collisions across multiple upstreams while maintaining clean routing.
- **Stateless MCP Transport**: Using MCP over Streamable HTTP (`POST /mcp`) allows the Gateway to be horizontally scaled behind Kubernetes Ingress without sticky sessions.
- **Fault Containment**: Non-blocking `Promise.allSettled` cache updates and 15s request timeouts guarantee that a slow or crashing upstream never degrades healthy upstreams.

---

## 🔒 Threat Model

*(Read the complete document in [THREAT_MODEL.md](file:///Users/vibhamishra/Documents/work/urumi/THREAT_MODEL.md))*

- **Shared Upstream Credentials**: Raw store credentials never leave the gateway. Even though members never see the keys, role-based tool filtering prevents unauthorized mutations, and immutable audit logs ensure complete accountability.
- **Token Passthrough Defense**: Client API keys and JWTs are terminated at the Gateway perimeter; they are **never** forwarded to upstream servers, eliminating token theft and replay attacks.
- **Untrusted Upstream Prompt Injection**: Upstream servers can only be registered by Admins. All URLs are validated against SSRF attacks targeting cloud metadata. Strict RBAC execution gates prevent LLM prompt injections in tool descriptions from executing privileged actions.
- **Cross-Member Isolation**: Members can only access and revoke their own API keys and view their own audit logs. API keys are stored solely as one-way SHA-256 hashes.
