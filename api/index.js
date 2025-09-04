import { Hono } from 'hono';
import { handle } from 'hono/vercel';
import DescopeClient from '@descope/node-sdk';
import { z } from 'zod';

// Load environment variables
const DESCOPE_PROJECT_ID = process.env.DESCOPE_PROJECT_ID;
const DESCOPE_MANAGEMENT_KEY = process.env.DESCOPE_MANAGEMENT_KEY;
const SERVER_URL = process.env.SERVER_URL || 'https://descope-store-mcp.vercel.app';

// Initialize Descope client only if environment variables are available
let descopeClient = null;
if (DESCOPE_PROJECT_ID && DESCOPE_MANAGEMENT_KEY) {
  try {
    descopeClient = DescopeClient({
      projectId: DESCOPE_PROJECT_ID,
      managementKey: DESCOPE_MANAGEMENT_KEY
    });
  } catch (error) {
    console.error('Failed to initialize Descope client:', error);
  }
} else {
  console.warn('Missing environment variables: DESCOPE_PROJECT_ID, DESCOPE_MANAGEMENT_KEY');
}

const app = new Hono();

// CORS middleware
app.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (c.req.method === 'OPTIONS') {
    return c.text('', 200);
  }
  
  await next();
});

// Root endpoint - MCP server info
app.get('/', (c) => {
  return c.json({
    name: 'Descope Store MCP Server',
    version: '2.0.0',
    description: 'Clean MCP server for Descope user management with OAuth 2.1 authentication',
    endpoints: {
      mcp: '/mcp',
      oauth: {
        authorize: '/oauth/authorize',
        token: '/oauth/token'
      }
    },
    documentation: 'https://github.com/sharanyareddy9/descope-store-mcp'
  });
});

// MCP Server-Sent Events endpoint
app.get('/mcp', async (c) => {
  // Check if Descope client is available
  if (!descopeClient) {
    return c.json({
      error: 'Server configuration error',
      message: 'Descope client not initialized. Please check environment variables.'
    }, 500);
  }

  const authHeader = c.req.header('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }

  const token = authHeader.substring(7);
  
  try {
    // Verify token with Descope
    const tokenValidation = await descopeClient.validateSession(token);
    if (!tokenValidation.valid) {
      return c.json({ error: 'Invalid token' }, 401);
    }

    // Set up SSE headers
    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');

    // MCP initialization message
    const initMessage = {
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
          resources: {}
        },
        serverInfo: {
          name: 'descope-store-mcp',
          version: '2.0.0'
        }
      }
    };

    // Send SSE data
    const sseData = `data: ${JSON.stringify(initMessage)}\n\n`;
    
    return new Response(sseData, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    console.error('Token validation error:', error);
    return c.json({ error: 'Token validation failed' }, 401);
  }
});

// OAuth Authorization endpoint
app.get('/oauth/authorize', (c) => {
  if (!DESCOPE_PROJECT_ID) {
    return c.json({
      error: 'Server configuration error',
      message: 'DESCOPE_PROJECT_ID not configured'
    }, 500);
  }

  const clientId = c.req.query('client_id');
  const redirectUri = c.req.query('redirect_uri');
  const state = c.req.query('state');
  const codeChallenge = c.req.query('code_challenge');
  const codeChallengeMethod = c.req.query('code_challenge_method');

  if (!clientId || !redirectUri) {
    return c.json({ error: 'Missing required parameters' }, 400);
  }

  // Redirect to Descope authentication
  const descopeAuthUrl = `https://auth.descope.io/${DESCOPE_PROJECT_ID}/oauth2/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=openid profile email` +
    (state ? `&state=${encodeURIComponent(state)}` : '') +
    (codeChallenge ? `&code_challenge=${encodeURIComponent(codeChallenge)}` : '') +
    (codeChallengeMethod ? `&code_challenge_method=${encodeURIComponent(codeChallengeMethod)}` : '');

  return c.redirect(descopeAuthUrl);
});

// OAuth Token endpoint
app.post('/oauth/token', async (c) => {
  if (!DESCOPE_PROJECT_ID) {
    return c.json({
      error: 'Server configuration error',
      message: 'DESCOPE_PROJECT_ID not configured'
    }, 500);
  }

  try {
    const body = await c.req.json();
    const { code, client_id, redirect_uri, code_verifier } = body;

    if (!code || !client_id) {
      return c.json({ error: 'Missing required parameters' }, 400);
    }

    // Exchange code for token with Descope
    const tokenResponse = await fetch(`https://auth.descope.io/${DESCOPE_PROJECT_ID}/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id,
        redirect_uri,
        code_verifier
      })
    });

    const tokenData = await tokenResponse.json();
    
    if (!tokenResponse.ok) {
      return c.json({ error: 'Token exchange failed', details: tokenData }, 400);
    }

    return c.json(tokenData);

  } catch (error) {
    console.error('Token exchange error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Health check endpoint
app.get('/health', (c) => {
  return c.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    environment: {
      hasDescopeProjectId: !!DESCOPE_PROJECT_ID,
      hasManagementKey: !!DESCOPE_MANAGEMENT_KEY,
      serverUrl: SERVER_URL
    }
  });
});

// Favicon endpoint to prevent 404s
app.get('/favicon.ico', (c) => {
  return c.text('', 204);
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('Server error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

export default handle(app);