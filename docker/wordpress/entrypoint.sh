#!/usr/bin/env bash
set -Eeuo pipefail

# Copy WordPress core files if not present in the volume mount
if [ ! -f /var/www/html/wp-includes/version.php ]; then
    echo "📦 Initializing WordPress core files..."
    cp -rn /usr/src/wordpress/. /var/www/html/
    chown -R www-data:www-data /var/www/html
fi

# Ensure wp-content has correct permissions
chown -R www-data:www-data /var/www/html/wp-content 2>/dev/null || true

# Generate wp-config.php if not present
if [ ! -f /var/www/html/wp-config.php ]; then
    echo "⚙️ Creating wp-config.php..."
    DB_HOST="${WORDPRESS_DB_HOST:-mariadb}"
    DB_NAME="${WORDPRESS_DB_NAME:-wordpress}"
    DB_USER="${WORDPRESS_DB_USER:-wordpress}"
    DB_PASSWORD="${WORDPRESS_DB_PASSWORD:-wp-changeme}"
    TABLE_PREFIX="${WORDPRESS_TABLE_PREFIX:-wp_}"

    STORE_URL="${WORDPRESS_STORE_URL:-http://store.127.0.0.1.nip.io}"

    cat > /var/www/html/wp-config.php << EOF
<?php
if ( (isset(\$_SERVER['HTTP_X_FORWARDED_PROTO']) && \$_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https') || (isset(\$_SERVER['REQUEST_URI']) && strpos(\$_SERVER['REQUEST_URI'], 'wp-json') !== false) ) {
    \$_SERVER['HTTPS'] = 'on';
}
define('DB_NAME', '$DB_NAME');
define('DB_USER', '$DB_USER');
define('DB_PASSWORD', '$DB_PASSWORD');
define('DB_HOST', '$DB_HOST');
define('DB_CHARSET', 'utf8mb4');
define('DB_COLLATE', '');

define('AUTH_KEY',         'urumi_secret_key_1');
define('SECURE_AUTH_KEY',  'urumi_secret_key_2');
define('LOGGED_IN_KEY',    'urumi_secret_key_3');
define('NONCE_KEY',        'urumi_secret_key_4');
define('AUTH_SALT',        'urumi_secret_key_5');
define('SECURE_AUTH_SALT', 'urumi_secret_key_6');
define('LOGGED_IN_SALT',   'urumi_secret_key_7');
define('NONCE_SALT',       'urumi_secret_key_8');

\$table_prefix = '$TABLE_PREFIX';
define('WP_DEBUG', false);
define('WP_HOME', '$STORE_URL');
define('WP_SITEURL', '$STORE_URL');
define('FS_METHOD', 'direct');

if ( ! defined( 'ABSPATH' ) ) {
    define( 'ABSPATH', __DIR__ . '/' );
}
require_once ABSPATH . 'wp-settings.php';
EOF
    chown www-data:www-data /var/www/html/wp-config.php
fi

# Enable AllowOverride All in apache configuration
sed -i 's/AllowOverride None/AllowOverride All/g' /etc/apache2/apache2.conf 2>/dev/null || true

# Generate .htaccess if not present
if [ ! -f /var/www/html/.htaccess ]; then
    cat > /var/www/html/.htaccess << 'EOF'
# BEGIN WordPress
<IfModule mod_rewrite.c>
RewriteEngine On
RewriteRule .* - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]
RewriteBase /
RewriteRule ^index\.php$ - [L]
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . /index.php [L]
</IfModule>
# END WordPress
EOF
    chown www-data:www-data /var/www/html/.htaccess 2>/dev/null || true
fi

if [ -f /etc/apache2/envvars ]; then
    . /etc/apache2/envvars
fi
rm -f "${APACHE_PID_FILE:-/var/run/apache2/apache2.pid}" 2>/dev/null || true

echo "🚀 Starting Apache..."
if command -v apache2-foreground &>/dev/null; then
    exec apache2-foreground
else
    exec apache2 -DFOREGROUND
fi
