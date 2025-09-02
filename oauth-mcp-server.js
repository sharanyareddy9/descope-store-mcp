#!/usr/bin/env node
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import fs from 'fs';
import crypto from 'crypto';
import DescopeClient from '@descope/node-sdk';

const app = express();
const PORT = 3001;
const STORE_BASE_URL = process.env.DESCOPE_STORE_URL || 'http://localhost:3000';

// Descope OAuth 2.1 configuration
const DESCOPE_PROJECT_ID = process.env.DESCOPE_PROJECT_ID || 'P2XVkRJLvRWh9DEq8tAKUH6vNgTI';
const DESCOPE_MANAGEMENT_KEY = process.env.DESCOPE_MANAGEMENT_KEY || '';
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'http://localhost:3001';

// Initialize Descope client for OAuth 2.1
const descopeClient = DescopeClient({ 
  projectId: DESCOPE_PROJECT_ID,
  managementKey: DESCOPE_MANAGEMENT_KEY 
});

// In-memory token store (use Redis/database in production)
const tokenStore = new Map();
const clientStore = new Map();

// Generate secure random strings
const generateRandomString = (length = 32) => {
  return crypto.randomBytes(length).toString('base64url');
};

// Enable CORS with OAuth 2.1 compliant headers
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Client-ID'],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Simple login page using Descope SDK
app.get('/login', (req, res) => {
  const loginPage = `
<!DOCTYPE html>
<html>
<head>
    <title>Descope Store OAuth 2.1 Login</title>
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, sans-serif; 
            max-width: 600px; 
            margin: 50px auto;
            padding: 20px;
        }
        .auth-container {
            border: 1px solid #ddd;
            border-radius: 8px;
            padding: 30px;
            text-align: center;
            background: #f9f9f9;
        }
        .auth-button {
            display: inline-block;
            margin: 10px;
            padding: 12px 24px;
            background: #007bff;
            color: white;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 500;
        }
        .auth-button:hover { background: #0056b3; }
        .mcp-info {
            background: #e7f3ff;
            padding: 20px;
            margin: 20px 0;
            border-radius: 6px;
            border-left: 4px solid #007bff;
        }
    </style>
</head>
<body>
    <div class="auth-container">
        <h1>🔐 Descope Store MCP Server</h1>
        <p>OAuth 2.1 Authentication with Descope SDK</p>
        
        <div class="mcp-info">
            <h3>MCP 2025 Specification Compliant</h3>
            <p>✅ OAuth 2.1 Bearer Tokens</p>
            <p>✅ PKCE Required</p>
            <p>✅ Descope SDK Integration</p>
            <p>✅ Dynamic Client Registration</p>
        </div>

        <h3>Authentication Endpoints:</h3>
        <p><strong>Register Client:</strong> <code>POST /oauth/register</code></p>
        <p><strong>Authorize:</strong> <code>GET /oauth/authorize</code></p>
        <p><strong>Token:</strong> <code>POST /oauth/token</code></p>
        
        <div style="margin-top: 30px;">
            <h3>Test Authentication:</h3>
            <a href="/oauth/authorize?client_id=test&redirect_uri=${req.protocol}://${req.get('host')}/oauth/callback&response_type=code&scope=mcp:tools&code_challenge=test&code_challenge_method=S256" 
               class="auth-button">Start OAuth Flow</a>
        </div>

        <div style="margin-top: 20px; font-size: 12px; color: #666;">
            <p>Project ID: ${DESCOPE_PROJECT_ID}</p>
            <p>Powered by Descope SDK + OAuth 2.1</p>
        </div>
    </div>
</body>
</html>`;
  
  res.send(loginPage);
});

// OAuth 2.1 Bearer Token Authentication Middleware (MCP 2025 Compliant)
const authenticateBearer = async (req, res, next) => {
  // Public endpoints that don't require authentication
  const publicPaths = [
    '/health', 
    '/mcp/info', 
    '/.well-known/oauth-authorization-server',
    '/oauth/authorize',
    '/oauth/token',
    '/oauth/register'
  ];
  
  if (req.method === 'OPTIONS' || publicPaths.some(path => req.path.startsWith(path))) {
    return next();
  }

  const authHeader = req.headers.authorization;
  
  // MCP 2025 Spec: Authorization MUST be included in every HTTP request
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'invalid_token',
      error_description: 'Bearer token required in Authorization header',
      mcp_version: '2025-03-26',
      auth_endpoint: `${MCP_SERVER_URL}/oauth/authorize`,
      token_endpoint: `${MCP_SERVER_URL}/oauth/token`
    });
  }

  const token = authHeader.substring(7);

  try {
    // Validate access token per OAuth 2.1 Section 5.2
    const tokenData = tokenStore.get(token);
    
    if (!tokenData) {
      return res.status(401).json({
        error: 'invalid_token',
        error_description: 'Token not found or invalid'
      });
    }

    // Check token expiration
    if (tokenData.expires_at < Date.now()) {
      tokenStore.delete(token);
      return res.status(401).json({
        error: 'invalid_token',
        error_description: 'Token has expired'
      });
    }

    // Validate with Descope if it's a Descope session token
    if (tokenData.descope_token) {
      const validatedToken = await descopeClient.validateSession(tokenData.descope_token);
      if (!validatedToken.valid) {
        tokenStore.delete(token);
        return res.status(401).json({
          error: 'invalid_token',
          error_description: 'Descope session validation failed'
        });
      }
      req.user = validatedToken.token;
    }

    req.tokenData = tokenData;
    req.clientId = tokenData.client_id;
    next();

  } catch (error) {
    console.error('Token validation error:', error);
    return res.status(401).json({
      error: 'invalid_token',
      error_description: 'Token validation failed'
    });
  }
};

// OAuth 2.1 Authorization Server Metadata (RFC 8414)
app.get('/.well-known/oauth-authorization-server', (req, res) => {
  res.json({
    issuer: MCP_SERVER_URL,
    authorization_endpoint: `${MCP_SERVER_URL}/oauth/authorize`,
    token_endpoint: `${MCP_SERVER_URL}/oauth/token`,
    registration_endpoint: `${MCP_SERVER_URL}/oauth/register`,
    scopes_supported: ['mcp:tools', 'mcp:resources', 'store:read', 'store:write'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'client_credentials'],
    code_challenge_methods_supported: ['S256'], // PKCE required
    token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
    mcp_version: '2025-03-26'
  });
});

// Dynamic Client Registration (OAuth 2.1 / RFC 7591)
app.post('/oauth/register', async (req, res) => {
  const { 
    client_name, 
    redirect_uris = [`${MCP_SERVER_URL}/oauth/callback`],
    grant_types = ['authorization_code'],
    response_types = ['code'],
    scope = 'mcp:tools mcp:resources store:read'
  } = req.body;

  const clientId = `mcp_${generateRandomString(16)}`;
  const clientSecret = `mcp_sk_${generateRandomString(32)}`;

  // Validate redirect URIs per MCP 2025 spec
  const validRedirectUris = redirect_uris.filter(uri => {
    try {
      const url = new URL(uri);
      return url.protocol === 'https:' || 
             (url.protocol === 'http:' && url.hostname === 'localhost');
    } catch {
      return false;
    }
  });

  if (validRedirectUris.length === 0) {
    return res.status(400).json({
      error: 'invalid_redirect_uri',
      error_description: 'Redirect URIs must be HTTPS or localhost HTTP'
    });
  }

  const clientData = {
    client_id: clientId,
    client_secret: clientSecret,
    client_name: client_name || 'MCP Client',
    redirect_uris: validRedirectUris,
    grant_types,
    response_types,
    scope,
    created_at: Date.now()
  };

  clientStore.set(clientId, clientData);

  res.json({
    client_id: clientId,
    client_secret: clientSecret,
    client_name: clientData.client_name,
    redirect_uris: validRedirectUris,
    grant_types,
    response_types,
    scope
  });
});

// OAuth 2.1 Authorization Endpoint with Descope SDK
app.get('/oauth/authorize', async (req, res) => {
  const { 
    client_id, 
    redirect_uri, 
    response_type = 'code',
    scope = 'mcp:tools',
    state,
    code_challenge,
    code_challenge_method = 'S256'
  } = req.query;

  // Validate required parameters
  if (!client_id || !redirect_uri || !code_challenge) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'Missing required parameters: client_id, redirect_uri, code_challenge'
    });
  }

  // PKCE is REQUIRED per MCP 2025 spec
  if (code_challenge_method !== 'S256') {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'code_challenge_method must be S256'
    });
  }

  const client = clientStore.get(client_id);
  if (!client) {
    return res.status(400).json({
      error: 'invalid_client',
      error_description: 'Client not found'
    });
  }

  // Validate redirect URI
  if (!client.redirect_uris.includes(redirect_uri)) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'Invalid redirect_uri'
    });
  }

  // Generate authorization code
  const authCode = generateRandomString(16);
  
  // Store authorization code with PKCE challenge
  tokenStore.set(`auth_${authCode}`, {
    client_id,
    redirect_uri,
    scope,
    code_challenge,
    code_challenge_method,
    expires_at: Date.now() + (10 * 60 * 1000), // 10 minutes
    created_at: Date.now()
  });

  try {
    // Use Descope SDK to create OAuth authorization URL
    const descopeAuthUrl = await descopeClient.oAuth.start({
      provider: 'google', // Default to Google, can be made dynamic
      redirectUrl: `${MCP_SERVER_URL}/oauth/callback`,
      loginOptions: {
        customClaims: {
          mcp_auth_code: authCode,
          client_id: client_id,
          mcp_scope: scope
        }
      }
    });

    res.redirect(descopeAuthUrl);
  } catch (error) {
    console.error('Descope OAuth start error:', error);
    res.status(500).json({
      error: 'server_error',
      error_description: 'Failed to start OAuth flow with Descope'
    });
  }
});

// OAuth 2.1 Callback Handler using Descope SDK
app.get('/oauth/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'Missing authorization code'
    });
  }

  try {
    // Use Descope SDK to exchange code for token
    const authResponse = await descopeClient.oAuth.exchangeToken({
      code: code
    });

    // Validate the session token
    const sessionToken = authResponse.sessionToken;
    const validatedToken = await descopeClient.validateSession(sessionToken);

    if (!validatedToken.valid) {
      return res.status(400).json({
        error: 'invalid_grant',
        error_description: 'Invalid session token from Descope'
      });
    }

    // Extract custom claims to get original auth code
    const customClaims = validatedToken.token.custom_claims || {};
    const authCode = customClaims.mcp_auth_code;
    const clientId = customClaims.client_id;
    const scope = customClaims.mcp_scope || 'mcp:tools';

    if (!authCode) {
      return res.status(400).json({
        error: 'invalid_grant',
        error_description: 'Missing MCP auth code in token claims'
      });
    }

    const authData = tokenStore.get(`auth_${authCode}`);
    if (!authData) {
      return res.status(400).json({
        error: 'invalid_grant',
        error_description: 'Invalid or expired authorization code'
      });
    }

    // Generate MCP access token and associate with Descope session
    const mcpAccessToken = `mcp_at_${generateRandomString(32)}`;
    
    tokenStore.set(mcpAccessToken, {
      client_id: authData.client_id,
      scope: authData.scope,
      token_type: 'Bearer',
      descope_token: sessionToken,
      descope_user: validatedToken.token,
      expires_at: Date.now() + (3600 * 1000), // 1 hour
      created_at: Date.now()
    });

    // Clean up auth code
    tokenStore.delete(`auth_${authCode}`);

    // Redirect back to client with authorization code
    const finalRedirectUrl = new URL(authData.redirect_uri);
    finalRedirectUrl.searchParams.set('code', authCode);
    finalRedirectUrl.searchParams.set('state', 'authorized');

    res.redirect(finalRedirectUrl.toString());

  } catch (error) {
    console.error('Descope OAuth callback error:', error);
    res.status(500).json({
      error: 'server_error',
      error_description: 'Failed to process OAuth callback with Descope'
    });
  }
});

// OAuth 2.1 Token Endpoint
app.post('/oauth/token', async (req, res) => {
  const { 
    grant_type, 
    code, 
    redirect_uri, 
    client_id, 
    client_secret,
    code_verifier 
  } = req.body;

  if (grant_type === 'authorization_code') {
    // Validate authorization code
    const authData = tokenStore.get(`auth_${code}`);
    if (!authData) {
      return res.status(400).json({
        error: 'invalid_grant',
        error_description: 'Invalid or expired authorization code'
      });
    }

    // Validate PKCE code verifier
    if (!code_verifier) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'code_verifier required for PKCE'
      });
    }

    const expectedChallenge = crypto
      .createHash('sha256')
      .update(code_verifier)
      .digest('base64url');

    if (expectedChallenge !== authData.code_challenge) {
      return res.status(400).json({
        error: 'invalid_grant',
        error_description: 'Invalid code_verifier'
      });
    }

    // Generate access token
    const accessToken = `mcp_at_${generateRandomString(32)}`;
    const refreshToken = `mcp_rt_${generateRandomString(32)}`;

    tokenStore.set(accessToken, {
      client_id: authData.client_id,
      scope: authData.scope,
      token_type: 'Bearer',
      expires_at: Date.now() + (3600 * 1000), // 1 hour
      created_at: Date.now()
    });

    // Clean up auth code
    tokenStore.delete(`auth_${code}`);

    res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: refreshToken,
      scope: authData.scope
    });

  } else if (grant_type === 'client_credentials') {
    // Machine-to-machine authentication
    const client = clientStore.get(client_id);
    if (!client || client.client_secret !== client_secret) {
      return res.status(401).json({
        error: 'invalid_client',
        error_description: 'Invalid client credentials'
      });
    }

    const accessToken = `mcp_at_${generateRandomString(32)}`;
    
    tokenStore.set(accessToken, {
      client_id,
      scope: 'mcp:tools mcp:resources store:read',
      token_type: 'Bearer',
      expires_at: Date.now() + (3600 * 1000), // 1 hour
      created_at: Date.now()
    });

    res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'mcp:tools mcp:resources store:read'
    });

  } else {
    res.status(400).json({
      error: 'unsupported_grant_type',
      error_description: 'Only authorization_code and client_credentials are supported'
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    auth: 'OAuth 2.1 Bearer Token',
    mcp_version: '2025-03-26',
    project_id: DESCOPE_PROJECT_ID
  });
});

// MCP Server Info endpoint
app.get('/mcp/info', (req, res) => {
  res.json({
    name: 'descope-store-oauth-mcp',
    version: '2025-03-26',
    description: 'Descope Store MCP Server with OAuth 2.1 Authentication',
    capabilities: {
      tools: true,
      resources: true,
      authentication: 'OAuth 2.1 Bearer Token'
    },
    auth_info: {
      provider: 'Descope + OAuth 2.1',
      authorization_endpoint: `${MCP_SERVER_URL}/oauth/authorize`,
      token_endpoint: `${MCP_SERVER_URL}/oauth/token`,
      registration_endpoint: `${MCP_SERVER_URL}/oauth/register`,
      supported_scopes: ['mcp:tools', 'mcp:resources', 'store:read', 'store:write'],
      grant_types: ['authorization_code', 'client_credentials'],
      pkce_required: true
    }
  });
});

// Apply authentication to all MCP endpoints
app.use('/mcp', authenticateBearer);

// MCP Tools endpoint
app.get('/mcp/tools', async (req, res) => {
  try {
    const tools = [
      {
        name: 'search_products',
        description: 'Search for products in the Descope authentication store',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query for products' },
            category: { type: 'string', description: 'Product category filter' }
          }
        }
      },
      {
        name: 'get_product',
        description: 'Get detailed information about a specific product',
        inputSchema: {
          type: 'object',
          properties: {
            product_id: { type: 'string', description: 'Product ID' }
          },
          required: ['product_id']
        }
      },
      {
        name: 'compare_products',
        description: 'Compare multiple products side by side',
        inputSchema: {
          type: 'object',
          properties: {
            product_ids: { 
              type: 'array', 
              items: { type: 'string' },
              description: 'Array of product IDs to compare'
            }
          },
          required: ['product_ids']
        }
      }
    ];

    res.json({ tools });
  } catch (error) {
    console.error('Tools error:', error);
    res.status(500).json({ error: 'Failed to fetch tools' });
  }
});

// MCP Tool execution endpoint
app.post('/mcp/tools/:toolName', async (req, res) => {
  const { toolName } = req.params;
  const { arguments: toolArgs } = req.body;

  try {
    let result;

    switch (toolName) {
      case 'search_products':
        result = await searchProducts(toolArgs.query, toolArgs.category);
        break;
      case 'get_product':
        result = await getProduct(toolArgs.product_id);
        break;
      case 'compare_products':
        result = await compareProducts(toolArgs.product_ids);
        break;
      default:
        return res.status(404).json({ error: 'Tool not found' });
    }

    res.json({ result });
  } catch (error) {
    console.error(`Tool ${toolName} error:`, error);
    res.status(500).json({ error: `Failed to execute ${toolName}` });
  }
});

// Tool implementation functions
async function searchProducts(query, category) {
  const response = await axios.get(`${STORE_BASE_URL}/api/products`);
  let products = response.data;

  if (query) {
    products = products.filter(p => 
      p.title.toLowerCase().includes(query.toLowerCase()) ||
      p.description.toLowerCase().includes(query.toLowerCase())
    );
  }

  if (category) {
    products = products.filter(p => p.product_type === category);
  }

  return products.map(p => ({
    id: p.id,
    title: p.title,
    price: p.variants[0]?.price || 'N/A',
    description: p.description,
    image: p.image_url
  }));
}

async function getProduct(productId) {
  const response = await axios.get(`${STORE_BASE_URL}/api/products`);
  const product = response.data.find(p => p.id === productId);
  
  if (!product) {
    throw new Error('Product not found');
  }

  return {
    id: product.id,
    title: product.title,
    description: product.description,
    variants: product.variants,
    image: product.image_url,
    product_type: product.product_type,
    created_at: product.created_at,
    updated_at: product.updated_at
  };
}

async function compareProducts(productIds) {
  const response = await axios.get(`${STORE_BASE_URL}/api/products`);
  const products = response.data.filter(p => productIds.includes(p.id));
  
  return {
    comparison: products.map(p => ({
      id: p.id,
      title: p.title,
      price: p.variants[0]?.price || 'N/A',
      description: p.description,
      image: p.image_url,
      features: p.description.split('.').slice(0, 3)
    })),
    recommendation: products.length > 0 ? products[0].title : null
  };
}

app.listen(PORT, () => {
  console.log(`🔐 Descope Store OAuth 2.1 MCP Server running on port ${PORT}`);
  console.log(`📍 Server URL: ${MCP_SERVER_URL}`);
  console.log(`🔑 OAuth Authorization: ${MCP_SERVER_URL}/oauth/authorize`);
  console.log(`🎫 Token Endpoint: ${MCP_SERVER_URL}/oauth/token`);
  console.log(`📝 Client Registration: ${MCP_SERVER_URL}/oauth/register`);
  console.log(`💚 Health check: ${MCP_SERVER_URL}/health`);
  console.log(`🌐 Project ID: ${DESCOPE_PROJECT_ID}`);
  console.log(`✨ MCP 2025 Compliant with OAuth 2.1 + PKCE`);
});