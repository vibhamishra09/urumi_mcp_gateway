#!/usr/bin/env bash
set -euo pipefail

CLUSTER_NAME="${CLUSTER_NAME:-urumi}"
PATH="$HOME/bin:/usr/local/bin:$PATH"

echo "🚀 Creating Kubernetes cluster: $CLUSTER_NAME"

# Check if k3d cluster already exists
if command -v k3d &>/dev/null; then
  if k3d cluster list 2>/dev/null | grep -q "^${CLUSTER_NAME}"; then
    echo "✅ k3d cluster '$CLUSTER_NAME' already exists"
    kubectl cluster-info --context "k3d-${CLUSTER_NAME}" || true
    exit 0
  fi

  echo "📦 Creating k3d cluster with port 80/443 mappings..."
  k3d cluster create "$CLUSTER_NAME" \
    --port "80:80@loadbalancer" \
    --port "443:443@loadbalancer" \
    --k3s-arg "--disable=traefik@server:0" \
    --wait
  
  echo "✅ k3d cluster created successfully"
  kubectl cluster-info --context "k3d-${CLUSTER_NAME}" || true
  exit 0
fi

# Fallback to kind if k3d is not available
if kind get clusters 2>/dev/null | grep -q "^${CLUSTER_NAME}$"; then
  echo "✅ Cluster '$CLUSTER_NAME' already exists"
  kubectl cluster-info --context "kind-${CLUSTER_NAME}"
  exit 0
fi

cat > /tmp/kind-config.yaml << EOF
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
name: ${CLUSTER_NAME}
nodes:
- role: control-plane
  kubeadmConfigPatches:
  - |
    kind: InitConfiguration
    nodeRegistration:
      kubeletExtraArgs:
        node-labels: "ingress-ready=true"
  extraPortMappings:
  - containerPort: 80
    hostPort: 80
    protocol: TCP
  - containerPort: 443
    hostPort: 443
    protocol: TCP
EOF

kind create cluster --config /tmp/kind-config.yaml --wait 5m
echo "✅ Kind cluster created successfully"
kubectl cluster-info --context "kind-${CLUSTER_NAME}"

