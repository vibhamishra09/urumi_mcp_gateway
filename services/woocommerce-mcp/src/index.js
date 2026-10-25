/**
 * WooCommerce MCP Server
 * Speaks MCP over Streamable HTTP (POST /mcp)
 * Talks to WooCommerce via its REST API v3
 * 
 * Why REST API (not WP-CLI)?
 * - WP-CLI requires exec into the WP pod; the MCP server runs in its own pod
 * - REST API is the official remote integration surface for WooCommerce
 * - Supports full CRUD, authentication via consumer key/secret, and runs over HTTP
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import axios from 'axios';
import { z } from 'zod';

const WC_URL = process.env.WC_URL || 'http://woocommerce';
const WC_KEY = process.env.WC_CONSUMER_KEY || '';
const WC_SECRET = process.env.WC_CONSUMER_SECRET || '';
const PORT = parseInt(process.env.PORT || '3000');

const wc = axios.create({
  baseURL: `${WC_URL}/wp-json/wc/v3`,
  auth: { username: WC_KEY, password: WC_SECRET },
  timeout: 15000,
});

async function wcGet(path, params = {}) {
  try {
    const res = await wc.get(path, { params });
    return res.data;
  } catch (err) {
    if (err.response?.status === 404) {
      const res = await wc.get('', { baseURL: WC_URL, params: { rest_route: `/wc/v3${path}`, ...params } });
      return res.data;
    }
    throw err;
  }
}

async function wcPost(path, data = {}) {
  try {
    const res = await wc.post(path, data);
    return res.data;
  } catch (err) {
    if (err.response?.status === 404) {
      const res = await wc.post('', data, { baseURL: WC_URL, params: { rest_route: `/wc/v3${path}` } });
      return res.data;
    }
    throw err;
  }
}

async function wcPut(path, data = {}) {
  try {
    const res = await wc.put(path, data);
    return res.data;
  } catch (err) {
    if (err.response?.status === 404) {
      const res = await wc.put('', data, { baseURL: WC_URL, params: { rest_route: `/wc/v3${path}` } });
      return res.data;
    }
    throw err;
  }
}

function createServer() {
  const server = new McpServer({
    name: 'woocommerce',
    version: '1.0.0',
  });

  // ── Tool: list_products ──────────────────────────────────────
  server.tool(
    'list_products',
    'List WooCommerce products. Supports filtering by status, search term, category and pagination.',
    {
      per_page: z.number().int().min(1).max(100).default(20).describe('Number of products per page'),
      page: z.number().int().min(1).default(1).describe('Page number'),
      search: z.string().optional().describe('Search term'),
      status: z.enum(['any', 'draft', 'pending', 'private', 'publish']).default('any').describe('Product status filter'),
    },
    async ({ per_page, page, search, status }) => {
      const params = { per_page, page, status };
      if (search) params.search = search;
      const products = await wcGet('/products', params);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(products.map(p => ({
            id: p.id,
            name: p.name,
            status: p.status,
            price: p.price,
            regular_price: p.regular_price,
            stock_status: p.stock_status,
            permalink: p.permalink,
            categories: p.categories?.map(c => c.name),
          })), null, 2),
        }],
      };
    }
  );

  // ── Tool: create_product ─────────────────────────────────────
  server.tool(
    'create_product',
    'Create a new WooCommerce product.',
    {
      name: z.string().describe('Product name'),
      type: z.enum(['simple', 'grouped', 'external', 'variable']).default('simple').describe('Product type'),
      regular_price: z.string().describe('Regular price (as string, e.g. "29.99")'),
      description: z.string().optional().describe('Full product description (HTML allowed)'),
      short_description: z.string().optional().describe('Short product description'),
      status: z.enum(['draft', 'pending', 'private', 'publish']).default('publish').describe('Product status'),
      stock_quantity: z.number().int().optional().describe('Stock quantity'),
      manage_stock: z.boolean().default(false).describe('Whether to manage stock'),
    },
    async (args) => {
      const product = await wcPost('/products', args);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ id: product.id, name: product.name, permalink: product.permalink, status: product.status, price: product.price }),
        }],
      };
    }
  );

  // ── Tool: list_orders ────────────────────────────────────────
  server.tool(
    'list_orders',
    'List WooCommerce orders. Can filter by status and date range.',
    {
      per_page: z.number().int().min(1).max(100).default(20).describe('Orders per page'),
      page: z.number().int().min(1).default(1).describe('Page number'),
      status: z.enum(['any', 'pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed', 'trash']).default('any').describe('Order status filter'),
      after: z.string().optional().describe('Orders created after this ISO 8601 date, e.g. 2024-01-01T00:00:00'),
      before: z.string().optional().describe('Orders created before this ISO 8601 date'),
      customer: z.number().int().optional().describe('Filter by customer ID'),
    },
    async ({ per_page, page, status, after, before, customer }) => {
      const params = { per_page, page, status };
      if (after) params.after = after;
      if (before) params.before = before;
      if (customer) params.customer = customer;
      const orders = await wcGet('/orders', params);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(orders.map(o => ({
            id: o.id,
            status: o.status,
            date_created: o.date_created,
            total: o.total,
            customer_email: o.billing?.email,
            customer_name: `${o.billing?.first_name} ${o.billing?.last_name}`.trim(),
            line_items: o.line_items?.map(li => ({ name: li.name, quantity: li.quantity, total: li.total })),
          })), null, 2),
        }],
      };
    }
  );

  // ── Tool: get_order ──────────────────────────────────────────
  server.tool(
    'get_order',
    'Get a single WooCommerce order by ID.',
    {
      order_id: z.number().int().describe('The WooCommerce order ID'),
    },
    async ({ order_id }) => {
      const o = await wcGet(`/orders/${order_id}`);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(o, null, 2),
        }],
      };
    }
  );

  // ── Tool: update_order_status ────────────────────────────────
  server.tool(
    'update_order_status',
    'Update the status of a WooCommerce order.',
    {
      order_id: z.number().int().describe('The WooCommerce order ID'),
      status: z.enum(['pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed']).describe('New order status'),
      note: z.string().optional().describe('Optional note to add to the order'),
    },
    async ({ order_id, status, note }) => {
      const data = { status };
      if (note) data.customer_note = note;
      const o = await wcPut(`/orders/${order_id}`, data);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ id: o.id, status: o.status, date_modified: o.date_modified }),
        }],
      };
    }
  );

  return server;
}

// Express app — one session per request (stateless Streamable HTTP)
const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'woocommerce-mcp' }));

app.post('/mcp', async (req, res) => {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get('/mcp', async (req, res) => {
  res.status(405).json({ error: 'Method not allowed. Use POST for MCP requests.' });
});

app.listen(PORT, () => {
  console.log(`WooCommerce MCP Server listening on :${PORT}`);
  console.log(`WooCommerce URL: ${WC_URL}`);
});
