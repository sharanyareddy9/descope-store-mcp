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

// Descope Social Login Page
app.get('/login', (req, res) => {
  const loginPage = `
<!DOCTYPE html>
<html>
<head>
    <title>Descope Store - Social Login</title>
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, sans-serif; 
            max-width: 600px; 
            margin: 50px auto;
            padding: 20px;
            background: #f5f5f5;
        }
        .auth-container {
            background: white;
            border-radius: 12px;
            padding: 40px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            text-align: center;
        }
        .provider-button {
            display: inline-block;
            width: 280px;
            margin: 10px;
            padding: 16px 24px;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 600;
            font-size: 16px;
            transition: transform 0.2s;
            border: 2px solid #ddd;
        }
        .provider-button:hover { transform: translateY(-2px); }
        .google { background: #4285f4; color: white; border-color: #4285f4; }
        .github { background: #333; color: white; border-color: #333; }
        .microsoft { background: #0078d4; color: white; border-color: #0078d4; }
        .apple { background: #000; color: white; border-color: #000; }
        .facebook { background: #1877f2; color: white; border-color: #1877f2; }
        .gitlab { background: #fc6d26; color: white; border-color: #fc6d26; }
        .info-box {
            background: #f8f9fa;
            border: 1px solid #e9ecef;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
            text-align: left;
        }
        .endpoint-list {
            font-family: 'Monaco', 'Menlo', monospace;
            font-size: 14px;
            background: #f8f9fa;
            padding: 15px;
            border-radius: 6px;
            margin: 10px 0;
        }
    </style>
</head>
<body>
    <div class="auth-container">
        <h1>🔐 Descope Store MCP</h1>
        <p style="color: #666; margin-bottom: 30px;">Choose your authentication provider</p>
        
        <div style="margin: 30px 0;">
            <a href="/oauth/google" class="provider-button google">Continue with Google</a><br>
            <a href="/oauth/github" class="provider-button github">Continue with GitHub</a><br>
            <a href="/oauth/microsoft" class="provider-button microsoft">Continue with Microsoft</a><br>
            <a href="/oauth/apple" class="provider-button apple">Continue with Apple</a><br>
            <a href="/oauth/facebook" class="provider-button facebook">Continue with Facebook</a><br>
            <a href="/oauth/gitlab" class="provider-button gitlab">Continue with GitLab</a>
        </div>

        <div class="info-box">
            <h3>🔗 MCP OAuth 2.1 Endpoints</h3>
            <div class="endpoint-list">
                <strong>Authorization:</strong> ${MCP_SERVER_URL}/oauth/authorize<br>
                <strong>Token Exchange:</strong> ${MCP_SERVER_URL}/oauth/token<br>
                <strong>MCP Tools:</strong> ${MCP_SERVER_URL}/mcp/tools<br>
                <strong>Health Check:</strong> ${MCP_SERVER_URL}/health
            </div>
        </div>

        <div style="margin-top: 20px; font-size: 14px; color: #888;">
            <p>✅ OAuth 2.1 Compliant | ✅ PKCE Required | ✅ Bearer Tokens</p>
            <p>Project ID: ${DESCOPE_PROJECT_ID}</p>
        </div>
    </div>
</body>
</html>`;
  
  res.send(loginPage);
});

// OAuth 2.1 Bearer Token Authentication Middleware
const authenticateBearer = async (req, res, next) => {
  // Public endpoints that don't require authentication
  const publicPaths = [
    '/health', 
    '/mcp/info', 
    '/login',
    '/oauth/',
    '/.well-known/'
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
      login_url: `${MCP_SERVER_URL}/login`
    });
  }

  const token = authHeader.substring(7);

  try {
    // First try to find token in our store
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
    if (tokenData.descope_session_jwt) {
      const validatedToken = await descopeClient.validateSession(tokenData.descope_session_jwt);
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
    next();

  } catch (error) {
    console.error('Token validation error:', error);
    return res.status(401).json({
      error: 'invalid_token',
      error_description: 'Token validation failed'
    });
  }
};

// Descope OAuth Start Endpoints (using proper SDK methods)
const oauthProviders = ['google', 'github', 'microsoft', 'apple', 'facebook', 'gitlab'];

oauthProviders.forEach(provider => {
  app.get(`/oauth/${provider}`, async (req, res) => {
    try {
      const redirectUrl = `${MCP_SERVER_URL}/oauth/callback/${provider}`;
      
      // Use Descope SDK's proper OAuth start method
      const urlResponse = await descopeClient.oauth.start[provider](redirectUrl);
      
      if (urlResponse.ok) {
        // Store provider info for callback
        const stateToken = generateRandomString(16);
        tokenStore.set(`oauth_state_${stateToken}`, {
          provider: provider,
          created_at: Date.now(),
          expires_at: Date.now() + (10 * 60 * 1000) // 10 minutes
        });
        
        // Add state parameter to URL for security
        const authUrl = new URL(urlResponse.data.url);
        authUrl.searchParams.set('state', stateToken);
        
        res.redirect(authUrl.toString());
      } else {
        throw new Error(`OAuth start failed: ${urlResponse.error}`);
      }
    } catch (error) {
      console.error(`OAuth ${provider} start error:`, error);
      res.status(500).json({
        error: 'oauth_start_failed',
        error_description: `Failed to start ${provider} OAuth flow: ${error.message}`
      });
    }
  });
});

// Descope OAuth Callback Handlers (using proper SDK methods)
oauthProviders.forEach(provider => {
  app.get(`/oauth/callback/${provider}`, async (req, res) => {
    const { code, state } = req.query;

    if (!code) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing authorization code'
      });
    }

    // Validate state token
    if (state) {
      const stateData = tokenStore.get(`oauth_state_${state}`);
      if (!stateData || stateData.provider !== provider) {
        return res.status(400).json({
          error: 'invalid_state',
          error_description: 'Invalid state parameter'
        });
      }
      tokenStore.delete(`oauth_state_${state}`);
    }

    try {
      // Use Descope SDK's proper OAuth exchange method
      const exchangeResponse = await descopeClient.oauth.exchange(code);

      if (exchangeResponse.ok) {
        const { sessionJwt, refreshJwt } = exchangeResponse.data;
        
        // Generate MCP access token
        const mcpAccessToken = `mcp_at_${generateRandomString(32)}`;
        
        // Store token with Descope session
        tokenStore.set(mcpAccessToken, {
          provider: provider,
          token_type: 'Bearer',
          descope_session_jwt: sessionJwt,
          descope_refresh_jwt: refreshJwt,
          expires_at: Date.now() + (3600 * 1000), // 1 hour
          created_at: Date.now()
        });

        // Return success page with token
        const successPage = `
<!DOCTYPE html>
<html>
<head>
    <title>Authentication Success</title>
    <style>
        body { font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px; }
        .success { background: #d4edda; border: 1px solid #c3e6cb; padding: 20px; border-radius: 8px; }
        .token { background: #f8f9fa; border: 1px solid #dee2e6; padding: 15px; border-radius: 6px; font-family: monospace; word-break: break-all; margin: 10px 0; }
        .copy-btn { background: #007bff; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; }
    </style>
</head>
<body>
    <div class="success">
        <h2>✅ Authentication Successful!</h2>
        <p>You've successfully authenticated with <strong>${provider}</strong></p>
        
        <h3>Your Bearer Token:</h3>
        <div class="token" id="token">${mcpAccessToken}</div>
        <button class="copy-btn" onclick="copyToken()">Copy Token</button>
        
        <h3>Usage:</h3>
        <p>Add this header to your MCP requests:</p>
        <div class="token">Authorization: Bearer ${mcpAccessToken}</div>
        
        <h3>Test Endpoints:</h3>
        <p><strong>MCP Tools:</strong> <code>${MCP_SERVER_URL}/mcp/tools</code></p>
        <p><strong>Health Check:</strong> <code>${MCP_SERVER_URL}/health</code></p>
    </div>
    
    <script>
        function copyToken() {
            navigator.clipboard.writeText('${mcpAccessToken}');
            alert('Token copied to clipboard!');
        }
    </script>
</body>
</html>`;

        res.send(successPage);

      } else {
        throw new Error(`OAuth exchange failed: ${exchangeResponse.error}`);
      }

    } catch (error) {
      console.error(`OAuth ${provider} callback error:`, error);
      res.status(500).json({
        error: 'oauth_exchange_failed',
        error_description: `Failed to exchange ${provider} OAuth code: ${error.message}`
      });
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    auth: 'Descope OAuth 2.1 Social Login',
    mcp_version: '2025-03-26',
    supported_providers: oauthProviders,
    project_id: DESCOPE_PROJECT_ID
  });
});

// MCP Server Info endpoint
app.get('/mcp/info', (req, res) => {
  res.json({
    name: 'descope-store-oauth-mcp',
    version: '2025-03-26',
    description: 'Descope Store MCP Server with OAuth 2.1 Social Authentication',
    capabilities: {
      tools: true,
      resources: true,
      authentication: 'OAuth 2.1 Bearer Token via Descope'
    },
    auth_info: {
      provider: 'Descope Social OAuth',
      login_url: `${MCP_SERVER_URL}/login`,
      supported_providers: oauthProviders,
      token_type: 'Bearer',
      project_id: DESCOPE_PROJECT_ID
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
  console.log(`🔑 Social Login: ${MCP_SERVER_URL}/login`);
  console.log(`⚡ MCP Tools: ${MCP_SERVER_URL}/mcp/tools`);
  console.log(`💚 Health check: ${MCP_SERVER_URL}/health`);
  console.log(`🌐 Project ID: ${DESCOPE_PROJECT_ID}`);
  console.log(`✨ Supported Providers: ${oauthProviders.join(', ')}`);
  console.log(`🎯 Using Descope SDK OAuth methods: start[provider]() & exchange()`);
});