/**
 * Weather MCP Server (simulated data — no external API key required)
 * Speaks MCP over Streamable HTTP
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { z } from 'zod';

const PORT = parseInt(process.env.PORT || '3001');

// Simulated weather database
const WEATHER_DATA = {
  'new york': { temp_c: 18, condition: 'Partly cloudy', humidity: 65, wind_kmh: 20 },
  'london': { temp_c: 12, condition: 'Overcast', humidity: 82, wind_kmh: 15 },
  'tokyo': { temp_c: 24, condition: 'Sunny', humidity: 55, wind_kmh: 10 },
  'sydney': { temp_c: 22, condition: 'Clear', humidity: 60, wind_kmh: 25 },
  'paris': { temp_c: 15, condition: 'Light rain', humidity: 78, wind_kmh: 18 },
  'mumbai': { temp_c: 30, condition: 'Hot and humid', humidity: 88, wind_kmh: 12 },
  'berlin': { temp_c: 10, condition: 'Cloudy', humidity: 75, wind_kmh: 22 },
  'default': { temp_c: 20, condition: 'Mostly sunny', humidity: 60, wind_kmh: 15 },
};

function createServer() {
  const server = new McpServer({ name: 'weather', version: '1.0.0' });

  server.tool(
    'get_weather',
    'Get current weather for a city. Returns temperature, conditions, humidity and wind speed.',
    {
      city: z.string().describe('City name, e.g. "London" or "New York"'),
      units: z.enum(['celsius', 'fahrenheit']).default('celsius').describe('Temperature units'),
    },
    async ({ city, units }) => {
      const key = city.toLowerCase();
      const data = WEATHER_DATA[key] || { ...WEATHER_DATA['default'], condition: `Simulated data for ${city}` };
      const temp = units === 'fahrenheit' ? Math.round(data.temp_c * 9/5 + 32) : data.temp_c;
      const unit_label = units === 'fahrenheit' ? '°F' : '°C';
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            city: city,
            temperature: `${temp}${unit_label}`,
            condition: data.condition,
            humidity: `${data.humidity}%`,
            wind: `${data.wind_kmh} km/h`,
            note: 'Simulated data for demonstration purposes',
          }, null, 2),
        }],
      };
    }
  );

  server.tool(
    'get_forecast',
    'Get a 5-day weather forecast for a city.',
    {
      city: z.string().describe('City name'),
      days: z.number().int().min(1).max(5).default(5).describe('Number of forecast days'),
    },
    async ({ city, days }) => {
      const base = WEATHER_DATA[city.toLowerCase()] || WEATHER_DATA['default'];
      const conditions = ['Sunny', 'Partly cloudy', 'Cloudy', 'Light rain', 'Clear'];
      const forecast = Array.from({ length: days }, (_, i) => ({
        date: new Date(Date.now() + (i + 1) * 86400000).toISOString().split('T')[0],
        high_c: base.temp_c + Math.floor(Math.random() * 5) - 2,
        low_c: base.temp_c - 5 + Math.floor(Math.random() * 3),
        condition: conditions[Math.floor(Math.random() * conditions.length)],
      }));
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ city, forecast, note: 'Simulated data' }, null, 2),
        }],
      };
    }
  );

  server.tool(
    'compare_weather',
    'Compare weather between two cities.',
    {
      city1: z.string().describe('First city'),
      city2: z.string().describe('Second city'),
    },
    async ({ city1, city2 }) => {
      const d1 = WEATHER_DATA[city1.toLowerCase()] || WEATHER_DATA['default'];
      const d2 = WEATHER_DATA[city2.toLowerCase()] || WEATHER_DATA['default'];
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            comparison: {
              [city1]: { temp_c: d1.temp_c, condition: d1.condition, humidity: d1.humidity },
              [city2]: { temp_c: d2.temp_c, condition: d2.condition, humidity: d2.humidity },
            },
            warmer_city: d1.temp_c >= d2.temp_c ? city1 : city2,
            temp_difference_c: Math.abs(d1.temp_c - d2.temp_c),
          }, null, 2),
        }],
      };
    }
  );

  return server;
}

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'weather-mcp' }));

app.post('/mcp', async (req, res) => {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(PORT, () => console.log(`Weather MCP Server listening on :${PORT}`));
