#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="${NAMESPACE:-urumi}"
STORE_URL="${STORE_URL:-http://store.127.0.0.1.nip.io}"

echo "🌱 Seeding WooCommerce..."

# Wait for WordPress to be ready
echo "⏳ Waiting for WordPress pod..."
kubectl wait --namespace "$NAMESPACE" \
  --for=condition=ready pod \
  --selector=app=woocommerce \
  --timeout=300s

WP_POD=$(kubectl get pod -n "$NAMESPACE" -l app=woocommerce -o jsonpath='{.items[0].metadata.name}')

echo "⬇️ Ensuring WP-CLI is available..."
kubectl exec -n "$NAMESPACE" "$WP_POD" -- bash -c '
if ! command -v wp &> /dev/null; then
  curl -sSL https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar -o /usr/local/bin/wp
  chmod +x /usr/local/bin/wp
fi
'

echo "🔧 Installing WordPress via WP-CLI..."
kubectl exec -n "$NAMESPACE" "$WP_POD" -- wp core install \
  --url="$STORE_URL" \
  --title="Urumi Demo Store" \
  --admin_user="admin" \
  --admin_email="admin@urumi.local" \
  --admin_password="changeme123" \
  --skip-email \
  --allow-root 2>/dev/null || echo "WordPress may already be installed"

echo "🔌 Installing & Activating WooCommerce (v9.4.0)..."
kubectl exec -n "$NAMESPACE" -c wordpress "$WP_POD" -- wp plugin install woocommerce --version=9.4.0 --activate --allow-root 2>/dev/null || \
kubectl exec -n "$NAMESPACE" -c wordpress "$WP_POD" -- wp plugin activate woocommerce --allow-root 2>/dev/null || true

echo "⚙️ Running WooCommerce setup & enabling Cash on Delivery (COD)..."
kubectl exec -n "$NAMESPACE" -c wordpress "$WP_POD" -- wp wc tool run install_pages --user=admin --allow-root 2>/dev/null || true
kubectl exec -n "$NAMESPACE" -c wordpress "$WP_POD" -- wp option update woocommerce_cod_settings '{"enabled":"yes","title":"Cash on delivery","description":"Pay with cash upon delivery.","instructions":"Pay with cash upon delivery.","enable_for_methods":[],"enable_for_virtual":"yes"}' --format=json --allow-root 2>/dev/null || true
kubectl exec -n "$NAMESPACE" -c wordpress "$WP_POD" -- wp option update woocommerce_cart_redirect_after_add yes --allow-root 2>/dev/null || true
kubectl exec -n "$NAMESPACE" -c wordpress "$WP_POD" -- wp option update woocommerce_enable_ajax_add_to_cart no --allow-root 2>/dev/null || true
kubectl exec -n "$NAMESPACE" -c wordpress "$WP_POD" -- wp rewrite structure '/%postname%/' --allow-root 2>/dev/null || true

echo "🔒 Ensuring Apache configuration and .htaccess..."
kubectl exec -n "$NAMESPACE" -c wordpress "$WP_POD" -- sed -i 's/AllowOverride None/AllowOverride All/g' /etc/apache2/apache2.conf
kubectl exec -n "$NAMESPACE" -c wordpress "$WP_POD" -- bash -c 'cat > /var/www/html/.htaccess << "HTACCESS"
# BEGIN WordPress
<IfModule mod_rewrite.c>
RewriteEngine On
RewriteRule .* - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]
RewriteBase /
RewriteRule ^$ /shop/ [R=302,L]
RewriteRule ^index\.php$ - [L]
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . /index.php [L]
</IfModule>
# END WordPress
HTACCESS
chown www-data:www-data /var/www/html/.htaccess
'
kubectl exec -n "$NAMESPACE" -c wordpress "$WP_POD" -- php -r '
$f = "/var/www/html/wp-config.php";
if (file_exists($f)) {
  $c = file_get_contents($f);
  if (strpos($c, "REQUEST_URI") === false) {
    $ins = "<?php\nif ( (isset(\$_SERVER[\"HTTP_X_FORWARDED_PROTO\"]) && \$_SERVER[\"HTTP_X_FORWARDED_PROTO\"] === \"https\") || (isset(\$_SERVER[\"REQUEST_URI\"]) && strpos(\$_SERVER[\"REQUEST_URI\"], \"wp-json\") !== false) ) {\n    \$_SERVER[\"HTTPS\"] = \"on\";\n}\n";
    file_put_contents($f, preg_replace("/^<\?php\s*/", $ins, $c));
  }
}
' || true
kubectl exec -n "$NAMESPACE" -c wordpress "$WP_POD" -- apache2ctl graceful || true

echo "🔑 Creating WooCommerce REST API credentials..."
# Create API keys via WP-CLI and extract clean JSON
kubectl exec -n "$NAMESPACE" -c wordpress "$WP_POD" -- wp eval '
global $wpdb;
$consumer_key = "ck_" . wc_rand_hash();
$consumer_secret = "cs_" . wc_rand_hash();
$data = array(
  "user_id" => 1,
  "description" => "Urumi MCP Server",
  "permissions" => "read_write",
  "consumer_key" => wc_api_hash( $consumer_key ),
  "consumer_secret" => $consumer_secret,
  "truncated_key" => substr( $consumer_key, -7 ),
);
$wpdb->insert($wpdb->prefix . "woocommerce_api_keys", $data);
file_put_contents("/tmp/wc-keys-internal.json", json_encode(["consumer_key" => $consumer_key, "consumer_secret" => $consumer_secret]));
' --allow-root

echo "📦 Creating sample products..."
kubectl exec -n "$NAMESPACE" -c wordpress "$WP_POD" -- wp post create \
  --post_type=product \
  --post_title="Wireless Headphones Pro" \
  --post_status=publish \
  --meta_input='{"_price":"89.99","_regular_price":"89.99","_stock_status":"instock"}' \
  --allow-root 2>/dev/null || true

echo "✅ WooCommerce seeding complete!"
echo "   Admin: $STORE_URL/wp-admin (admin / changeme123)"

# Extract keys and update secret automatically
KEYS_JSON=$(kubectl exec -n "$NAMESPACE" -c wordpress "$WP_POD" -- cat /tmp/wc-keys-internal.json 2>/dev/null || echo "")
if [ -n "$KEYS_JSON" ]; then
  CK=$(node -e "const d=JSON.parse(process.argv[1]); console.log(d.consumer_key||'');" "$KEYS_JSON" 2>/dev/null || echo "")
  CS=$(node -e "const d=JSON.parse(process.argv[1]); console.log(d.consumer_secret||'');" "$KEYS_JSON" 2>/dev/null || echo "")
  if [ -n "$CK" ] && [ -n "$CS" ]; then
    echo "🔑 Applying WooCommerce keys to secret 'urumi-woocommerce-secret'..."
    kubectl create secret generic urumi-woocommerce-secret -n "$NAMESPACE" \
      --from-literal=consumer-key="$CK" \
      --from-literal=consumer-secret="$CS" \
      --dry-run=client -o yaml | kubectl apply -f -
    echo "🔄 Rolling restart woocommerce-mcp..."
    kubectl rollout restart deployment/woocommerce-mcp -n "$NAMESPACE" || true
  fi
fi

