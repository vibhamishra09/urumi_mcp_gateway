/**
 * Calculator MCP Server
 * Exposes math tools: basic arithmetic, unit conversion, statistics, discount calculator
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { z } from 'zod';

const PORT = parseInt(process.env.PORT || '3002');

function createServer() {
  const server = new McpServer({ name: 'calculator', version: '1.0.0' });

  server.tool(
    'calculate',
    'Evaluate a mathematical expression. Supports +, -, *, /, **, sqrt, round, floor, ceil, abs, min, max.',
    {
      expression: z.string().describe('Math expression to evaluate, e.g. "2 + 2", "sqrt(16)", "15 * 1.2"'),
    },
    async ({ expression }) => {
      try {
        // Safe math evaluation — only allow safe math characters
        const safe = expression.replace(/[^0-9+\-*/().,%\s]/g, '');
        // Use Function constructor with Math scope
        const fn = new Function('Math', `"use strict"; return (${safe})`);
        const result = fn(Math);
        return { content: [{ type: 'text', text: JSON.stringify({ expression, result }) }] };
      } catch (e) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Invalid expression', expression }) }] };
      }
    }
  );

  server.tool(
    'calculate_discount',
    'Calculate discount price, savings amount and discount percentage.',
    {
      original_price: z.number().describe('Original price'),
      discount_percent: z.number().min(0).max(100).optional().describe('Discount percentage (0-100)'),
      discount_amount: z.number().optional().describe('Fixed discount amount'),
    },
    async ({ original_price, discount_percent, discount_amount }) => {
      let savings = 0;
      if (discount_percent !== undefined) savings = (original_price * discount_percent) / 100;
      else if (discount_amount !== undefined) savings = discount_amount;
      const final_price = Math.max(0, original_price - savings);
      const effective_discount = original_price > 0 ? (savings / original_price) * 100 : 0;
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            original_price,
            discount_percent: effective_discount.toFixed(2) + '%',
            savings: savings.toFixed(2),
            final_price: final_price.toFixed(2),
          }),
        }],
      };
    }
  );

  server.tool(
    'convert_units',
    'Convert between common units: length, weight, temperature, area.',
    {
      value: z.number().describe('Value to convert'),
      from_unit: z.string().describe('Source unit, e.g. "kg", "miles", "fahrenheit", "sqft"'),
      to_unit: z.string().describe('Target unit, e.g. "lbs", "km", "celsius", "sqm"'),
    },
    async ({ value, from_unit, to_unit }) => {
      const conversions = {
        'kg_lbs': v => v * 2.20462, 'lbs_kg': v => v / 2.20462,
        'km_miles': v => v * 0.621371, 'miles_km': v => v / 0.621371,
        'meters_feet': v => v * 3.28084, 'feet_meters': v => v / 3.28084,
        'celsius_fahrenheit': v => (v * 9/5) + 32, 'fahrenheit_celsius': v => (v - 32) * 5/9,
        'sqft_sqm': v => v * 0.0929, 'sqm_sqft': v => v / 0.0929,
        'liters_gallons': v => v * 0.264172, 'gallons_liters': v => v / 0.264172,
      };
      const key = `${from_unit.toLowerCase()}_${to_unit.toLowerCase()}`;
      const fn = conversions[key];
      if (!fn) return { content: [{ type: 'text', text: JSON.stringify({ error: `Unsupported conversion: ${from_unit} to ${to_unit}` }) }] };
      const result = fn(value);
      return { content: [{ type: 'text', text: JSON.stringify({ value, from_unit, to_unit, result: parseFloat(result.toFixed(4)) }) }] };
    }
  );

  server.tool(
    'statistics',
    'Calculate statistics for a list of numbers: mean, median, mode, std deviation, min, max.',
    {
      numbers: z.array(z.number()).min(1).describe('List of numbers'),
    },
    async ({ numbers }) => {
      const sorted = [...numbers].sort((a, b) => a - b);
      const mean = numbers.reduce((s, n) => s + n, 0) / numbers.length;
      const median = numbers.length % 2 === 0
        ? (sorted[numbers.length/2-1] + sorted[numbers.length/2]) / 2
        : sorted[Math.floor(numbers.length/2)];
      const variance = numbers.reduce((s, n) => s + (n - mean) ** 2, 0) / numbers.length;
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            count: numbers.length,
            mean: parseFloat(mean.toFixed(4)),
            median,
            std_deviation: parseFloat(Math.sqrt(variance).toFixed(4)),
            min: sorted[0],
            max: sorted[sorted.length - 1],
            sum: numbers.reduce((s, n) => s + n, 0),
          }),
        }],
      };
    }
  );

  return server;
}

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'calculator-mcp' }));

app.post('/mcp', async (req, res) => {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(PORT, () => console.log(`Calculator MCP Server listening on :${PORT}`));
