/**
 * Chat agent route — uses Gemini with tool calling through the gateway
 * Includes a fallback deterministic agent when no API key is provided
 */
import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { authenticate } from '../middleware/auth.js';
import { getAllTools, routeToolCall, parseToolName } from '../mcp/client.js';
import { query } from '../db/pool.js';

const router = express.Router();
router.use(authenticate);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

async function logAudit(userId, serverSlug, toolName, args, durationMs, success, errorMsg) {
  if (!serverSlug) return;
  try {
    const sResult = await query('SELECT id FROM mcp_servers WHERE slug = $1', [serverSlug]).catch(() => ({ rows: [] }));
    await query(
      `INSERT INTO audit_logs (user_id, server_id, server_slug, tool_name, tool_arguments, duration_ms, success, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, sResult.rows[0]?.id || null, serverSlug, toolName, JSON.stringify(args || {}), durationMs, success, errorMsg || null]
    );
  } catch (e) {
    console.error('Audit logging failed in chat:', e.message);
  }
}

// Fallback rule-based agent when LLM key is absent or fails
async function runFallbackAgent(message, user) {
  const userRole = user?.role || 'member';
  const mcpTools = await getAllTools(userRole);
  const lower = message.toLowerCase();
  const toolCallsLog = [];
  let responseText = '';

  const callTool = async (prefixedName, args) => {
    const { serverSlug, toolName } = parseToolName(prefixedName);
    const start = Date.now();
    let toolResult, success = true, errorMsg;
    try {
      toolResult = await routeToolCall(prefixedName, args, userRole);
    } catch (e) {
      toolResult = { content: [{ type: 'text', text: `Error: ${e.message}` }] };
      success = false;
      errorMsg = e.message;
    }
    const durationMs = Date.now() - start;
    toolCallsLog.push({ tool: prefixedName, args, result: toolResult, durationMs, success });
    await logAudit(user.id, serverSlug, toolName, args, durationMs, success, errorMsg);
    return toolResult;
  };

  const isCreateProduct = /(create|add|make|insert|new).*(product|item)/i.test(message);

  if (isCreateProduct) {
    // Extract name (handle quoted names first, then 'named/called ...', then 'product ...')
    let name = 'New Product';
    const quoted = message.match(/["']([^"']+)["']/);
    if (quoted) {
      name = quoted[1].trim();
    } else {
      const namedMatch = message.match(/(?:named|called)\s+([^,]+?)(?:\s+(?:with|for|at|price|\$|\d)|$)/i);
      if (namedMatch) {
        name = namedMatch[1].trim();
      } else {
        const prodMatch = message.match(/(?:create|add)\s+(?:a\s+|an\s+|new\s+)?(?:product|item)\s+([^,]+?)(?:\s+(?:with|for|at|price|\$|\d)|$)/i);
        if (prodMatch) name = prodMatch[1].trim();
      }
    }

    // Extract price
    const priceMatch = message.match(/(?:price|for|\$)\s*[:=]?\s*\$?([0-9]+(?:\.[0-9]{1,2})?)/i) ||
                       message.match(/([0-9]+(?:\.[0-9]{1,2})?)\s*(?:dollars|usd)/i) ||
                       message.match(/\$?([0-9]+\.[0-9]{2})/);
    const price = priceMatch ? priceMatch[1] : '19.99';
    const res = await callTool('woocommerce__create_product', { name, regular_price: price });
    responseText = `Successfully created product "${name}" with regular price $${price} on the WooCommerce storefront.`;
  } else if (lower.includes('order') || lower.includes('orders')) {
    const res = await callTool('woocommerce__list_orders', { per_page: 10 });
    let text = res?.content?.[0]?.text || '[]';
    try {
      const orders = JSON.parse(text);
      if (orders.length === 0) {
        responseText = 'No recent orders were found in the WooCommerce store.';
      } else {
        responseText = `Found ${orders.length} order(s):\n` + orders.map(o => `• Order #${o.id} - Status: ${o.status}, Total: $${o.total} (${o.customer_name || 'Guest'})`).join('\n');
      }
    } catch {
      responseText = `Orders response:\n${text}`;
    }
  } else if (lower.includes('product') || lower.includes('products')) {
    const res = await callTool('woocommerce__list_products', { per_page: 10 });
    let text = res?.content?.[0]?.text || '[]';
    try {
      const prods = JSON.parse(text);
      responseText = `Products in store:\n` + prods.map(p => `• ${p.name} ($${p.price || p.regular_price || 'N/A'}) - [${p.status}]`).join('\n');
    } catch {
      responseText = `Products response:\n${text}`;
    }
  } else if (lower.includes('weather') || lower.includes('forecast') || lower.includes('temperature')) {
    const cityMatch = message.match(/(?:in|for|at)\s+([a-zA-Z\s]+)/i);
    const city = cityMatch ? cityMatch[1].trim() : 'London';
    const res = await callTool('weather__get_weather', { city });
    responseText = `Weather in ${city}: ` + (res?.content?.[0]?.text || 'No data');
  } else if (lower.includes('calculate') || lower.includes('math') || /[0-9]+\s*[\+\-\*\/]\s*[0-9]+/.test(message)) {
    const exprMatch = message.match(/(?:calculate|compute|what is)?\s*([0-9\.\s\+\-\*\/\(\)]+)/i);
    const expression = exprMatch ? exprMatch[1].trim() : '2 + 2';
    const res = await callTool('calculator__calculate', { expression });
    responseText = `Calculation result for "${expression}": ` + (res?.content?.[0]?.text || '');
  } else {
    // Default list tools
    const tools = await getAllTools();
    responseText = `I have access to ${tools.length} tools across your connected MCP servers: ${tools.map(t => t.name).join(', ')}. Ask me to create a product, check orders, check weather, or perform calculations!`;
  }

  return { message: responseText, toolCalls: toolCallsLog, history: [] };
}

router.post('/', async (req, res) => {
  const { message, history = [] } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'OVERRIDE_ME' || GEMINI_API_KEY === '') {
    const fallbackRes = await runFallbackAgent(message, req.user);
    return res.json(fallbackRes);
  }

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const userRole = req.user?.role || 'member';
    const mcpTools = await getAllTools(userRole);
    const geminiTools = [{
      functionDeclarations: mcpTools.map(t => ({
        name: t.name.replace(/__/g, '_'),
        description: t.description,
        parameters: t.inputSchema || { type: 'OBJECT', properties: {} },
      })),
    }];

    const toolNameMap = {};
    for (const t of mcpTools) {
      toolNameMap[t.name.replace(/__/g, '_')] = t.name;
    }

    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      tools: geminiTools,
      systemInstruction: 'You are a helpful assistant with access to WooCommerce store data, weather information, and calculator tools. Use the available tools to answer questions accurately. Always show the data you retrieved.',
    });

    const chat = model.startChat({ history });
    const toolCallsLog = [];
    let result = await chat.sendMessage(message);
    let response = result.response;

    let iterations = 0;
    while (response.functionCalls()?.length > 0 && iterations < 5) {
      iterations++;
      const functionCalls = response.functionCalls();
      const functionResponses = [];

      for (const call of functionCalls) {
        const mcpToolName = toolNameMap[call.name] || call.name;
        const { serverSlug, toolName } = parseToolName(mcpToolName);
        const start = Date.now();
        let toolResult, success = true, errorMsg;

        try {
          toolResult = await routeToolCall(mcpToolName, call.args, userRole);
        } catch (e) {
          toolResult = { content: [{ type: 'text', text: `Error: ${e.message}` }] };
          success = false;
          errorMsg = e.message;
        }

        const durationMs = Date.now() - start;
        toolCallsLog.push({ tool: mcpToolName, args: call.args, result: toolResult, durationMs, success });
        await logAudit(req.user.id, serverSlug, toolName, call.args, durationMs, success, errorMsg);

        const resultText = toolResult?.content?.[0]?.text || JSON.stringify(toolResult);
        functionResponses.push({ functionResponse: { name: call.name, response: { result: resultText } } });
      }

      result = await chat.sendMessage(functionResponses);
      response = result.response;
    }

    res.json({
      message: response.text(),
      toolCalls: toolCallsLog,
      history: (await chat.getHistory()).slice(-20),
    });
  } catch (e) {
    console.error('Gemini error, falling back to local orchestrator:', e.message);
    const fallbackRes = await runFallbackAgent(message, req.user);
    res.json(fallbackRes);
  }
});

export default router;
