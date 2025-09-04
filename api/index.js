// Simple Node.js serverless function for Vercel
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { url, method } = req;
  const pathname = new URL(url, `http://${req.headers.host}`).pathname;

  // Load environment variables
  const DESCOPE_PROJECT_ID = process.env.DESCOPE_PROJECT_ID;
  const DESCOPE_MANAGEMENT_KEY = process.env.DESCOPE_MANAGEMENT_KEY;
  const SERVER_URL = process.env.SERVER_URL || 'https://descope-store-mcp.vercel.app';

  try {
    // Root endpoint - MCP server info
    if (pathname === '/' && method === 'GET') {
      return res.status(200).json({
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
    }

    // Health check endpoint
    if (pathname === '/health' && method === 'GET') {
      return res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment: {
          hasDescopeProjectId: !!DESCOPE_PROJECT_ID,
          hasManagementKey: !!DESCOPE_MANAGEMENT_KEY,
          serverUrl: SERVER_URL
        }
      });
    }

    // MCP endpoint
    if (pathname === '/mcp' && method === 'GET') {
      if (!DESCOPE_PROJECT_ID || !DESCOPE_MANAGEMENT_KEY) {
        return res.status(500).json({
          error: 'Server configuration error',
          message: 'Environment variables not configured. Please set DESCOPE_PROJECT_ID and DESCOPE_MANAGEMENT_KEY in Vercel dashboard.'
        });
      }

      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid Authorization header' });
      }

      // For now, return a simple MCP response without token validation
      // Token validation can be added once environment variables are configured
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

      // Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const sseData = `data: ${JSON.stringify(initMessage)}\n\n`;
      return res.status(200).send(sseData);
    }

    // OAuth Authorization endpoint
    if (pathname === '/oauth/authorize' && method === 'GET') {
      if (!DESCOPE_PROJECT_ID) {
        return res.status(500).json({
          error: 'Server configuration error',
          message: 'DESCOPE_PROJECT_ID not configured'
        });
      }

      const { client_id, redirect_uri, state, code_challenge, code_challenge_method } = req.query;

      if (!client_id || !redirect_uri) {
        return res.status(400).json({ error: 'Missing required parameters' });
      }

      // Redirect to Descope authentication
      const descopeAuthUrl = `https://auth.descope.io/${DESCOPE_PROJECT_ID}/oauth2/authorize` +
        `?client_id=${encodeURIComponent(client_id)}` +
        `&redirect_uri=${encodeURIComponent(redirect_uri)}` +
        `&response_type=code` +
        `&scope=openid profile email` +
        (state ? `&state=${encodeURIComponent(state)}` : '') +
        (code_challenge ? `&code_challenge=${encodeURIComponent(code_challenge)}` : '') +
        (code_challenge_method ? `&code_challenge_method=${encodeURIComponent(code_challenge_method)}` : '');

      return res.redirect(302, descopeAuthUrl);
    }

    // OAuth Token endpoint
    if (pathname === '/oauth/token' && method === 'POST') {
      if (!DESCOPE_PROJECT_ID) {
        return res.status(500).json({
          error: 'Server configuration error',
          message: 'DESCOPE_PROJECT_ID not configured'
        });
      }

      const { code, client_id, redirect_uri, code_verifier } = req.body;

      if (!code || !client_id) {
        return res.status(400).json({ error: 'Missing required parameters' });
      }

      try {
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
          return res.status(400).json({ error: 'Token exchange failed', details: tokenData });
        }

        return res.status(200).json(tokenData);

      } catch (error) {
        console.error('Token exchange error:', error);
        return res.status(500).json({ error: 'Internal server error' });
      }
    }

    // Favicon endpoint
    if (pathname === '/favicon.ico') {
      return res.status(204).end();
    }

    // 404 handler
    return res.status(404).json({ error: 'Not found' });

  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}