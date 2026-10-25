#!/usr/bin/env bash
set -euo pipefail

PATH="$HOME/bin:/usr/local/bin:$PATH"

VALUES_FILE="${1:-helm/urumi/values-local.yaml}"
RELEASE="${RELEASE:-urumi}"
NAMESPACE="${NAMESPACE:-urumi}"

echo "🚀 Building Docker images..."
if [ -d "docker/wordpress" ]; then
  docker build -t urumi/wordpress:v2 docker/wordpress/
fi
docker build -t urumi/woocommerce-mcp:latest services/woocommerce-mcp/
docker build -t urumi/weather-mcp:latest services/weather-mcp/
docker build -t urumi/calculator-mcp:latest services/calculator-mcp/
docker build -t urumi/gateway-backend:latest services/gateway/backend/
docker build -t urumi/gateway-frontend:latest services/gateway/frontend/

echo "📤 Loading images into cluster..."
if command -v k3d &>/dev/null && k3d cluster list 2>/dev/null | grep -q "^urumi"; then
  IMAGES=(
    urumi/woocommerce-mcp:latest
    urumi/weather-mcp:latest
    urumi/calculator-mcp:latest
    urumi/gateway-backend:latest
    urumi/gateway-frontend:latest
  )
  if [ -d "docker/wordpress" ]; then
    IMAGES+=(urumi/wordpress:v2)
  fi
  k3d image import "${IMAGES[@]}" -c urumi
elif command -v kind &>/dev/null; then
  if [ -d "docker/wordpress" ]; then
    kind load docker-image urumi/wordpress:v2 --name urumi || true
  fi
  kind load docker-image urumi/woocommerce-mcp:latest --name urumi || true
  kind load docker-image urumi/weather-mcp:latest --name urumi || true
  kind load docker-image urumi/calculator-mcp:latest --name urumi || true
  kind load docker-image urumi/gateway-backend:latest --name urumi || true
  kind load docker-image urumi/gateway-frontend:latest --name urumi || true
fi

echo "📦 Deploying Helm chart..."
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
helm upgrade --install "$RELEASE" helm/urumi \
  --namespace "$NAMESPACE" \
  --values "$VALUES_FILE" \
  --wait \
  --timeout 10m

echo "✅ Deployment complete!"
echo "   Store:     http://store.127.0.0.1.nip.io"
echo "   Dashboard: http://dashboard.127.0.0.1.nip.io"
