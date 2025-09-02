#!/usr/bin/env node
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import fs from 'fs';
import DescopeClient from '@descope/node-sdk';

const app = express();
const PORT = 3001;
const STORE_BASE_URL = process.env.DESCOPE_STORE_URL || 'http://localhost:3000';

// Descope configuration
const DESCOPE_PROJECT_ID = process.env.DESCOPE_PROJECT_ID || 'P2XVkRJLvRWh9DEq8tAKUH6vNgTI';
const DESCOPE_MANAGEMENT_KEY = process.env.DESCOPE_MANAGEMENT_KEY || '';

// Initialize Descope client
const descopeClient = DescopeClient({ 
  projectId: DESCOPE_PROJECT_ID,
  managementKey: DESCOPE_MANAGEMENT_KEY 
});

// Enable CORS for all origins (required for remote MCP)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Descope-Token', 'X-Descope-Project-ID', 'Accept'],
  credentials: true
}));

app.use(express.json());
app.use(express.static('public'));

// Descope authentication middleware
const authenticateWithDescope = async (req, res, next) => {
  // Allow health check, info, and auth endpoints without auth
  const publicPaths = ['/health', '/mcp/info', '/auth/', '/oauth/', '/login', '/signup'];
  if (req.method === 'OPTIONS' || publicPaths.some(path => req.path.includes(path))) {
    return next();
  }

  const authHeader = req.headers.authorization;
  const descopeToken = req.headers['x-descope-token'];

  let token = null;
  
  // Extract token from Authorization header or custom header
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (descopeToken) {
    token = descopeToken;
  }

  if (!token) {
    return res.status(401).json({ 
      error: 'Authentication required', 
      message: 'Please authenticate with Descope first',
      auth_flow: {
        step1: 'Visit /login for social authentication',
        step2: 'Complete OAuth flow',
        step3: 'Use returned token in Authorization header'
      },
      social_providers: ['google', 'github', 'microsoft', 'apple']
    });
  }

  try {
    // Validate token with Descope
    const validatedToken = await descopeClient.validateSession(token);
    
    if (validatedToken.valid) {
      req.user = validatedToken.token;
      next();
    } else {
      res.status(401).json({ 
        error: 'Invalid token', 
        message: 'Token validation failed',
        action: 'Please re-authenticate at /login'
      });
    }
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(401).json({ 
      error: 'Authentication failed', 
      message: 'Token validation failed',
      action: 'Please authenticate at /login'
    });
  }
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    auth: 'Descope Social Authentication',
    project_id: DESCOPE_PROJECT_ID
  });
});

// MCP Server Info endpoint
app.get('/mcp/info', (req, res) => {
  res.json({
    name: 'descope-store-social-auth-mcp',
    version: '1.0.0',
    description: 'Descope Authentication Store MCP Server with Social Login',
    capabilities: {
      tools: true,
      resources: true,
      authentication: 'Descope Social OAuth'
    },
    auth_info: {
      provider: 'Descope',
      project_id: DESCOPE_PROJECT_ID,
      auth_flow: 'Social OAuth (Google, GitHub, Microsoft, Apple)',
      login_url: '/login',
      supported_providers: ['google', 'github', 'microsoft', 'apple']
    }
  });
});

// Login page with social authentication
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
        .container { 
            background: white; 
            padding: 40px; 
            border-radius: 8px; 
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .logo { 
            text-align: center; 
            margin-bottom: 30px; 
            color: #2563eb;
            font-size: 24px;
            font-weight: bold;
        }
        .social-button {
            display: block;
            width: 100%;
            padding: 12px 20px;
            margin: 10px 0;
            border: 1px solid #ddd;
            border-radius: 6px;
            text-decoration: none;
            color: #333;
            text-align: center;
            font-weight: 500;
            transition: all 0.3s;
        }
        .social-button:hover {
            background: #f8f9fa;
            border-color: #2563eb;
        }
        .google { border-left: 4px solid #4285f4; }
        .github { border-left: 4px solid #333; }
        .microsoft { border-left: 4px solid #00a1f1; }
        .apple { border-left: 4px solid #000; }
        .info {
            background: #e3f2fd;
            padding: 15px;
            border-radius: 6px;
            margin-top: 20px;
            font-size: 14px;
        }
        .demo-section {
            background: #fff3cd;
            padding: 15px;
            border-radius: 6px;
            margin-top: 20px;
            border-left: 4px solid #ffc107;
        }
        .token-display {
            background: #f8f9fa;
            padding: 10px;
            border-radius: 4px;
            font-family: monospace;
            font-size: 12px;
            word-break: break-all;
            margin-top: 10px;
        }
    </style>
    <script src="https://unpkg.com/@descope/web-js-sdk@latest/dist/index.umd.js"></script>
</head>
<body>
    <div class="container">
        <div class="logo">🛡️ Descope Store</div>
        <h2>Social Authentication</h2>
        <p>Choose your preferred login method:</p>
        
        <a href="/oauth/google" class="social-button google">
            🔍 Continue with Google
        </a>
        
        <a href="/oauth/github" class="social-button github">
            🐙 Continue with GitHub  
        </a>
        
        <a href="/oauth/microsoft" class="social-button microsoft">
            🏢 Continue with Microsoft
        </a>
        
        <a href="/oauth/apple" class="social-button apple">
            🍎 Continue with Apple
        </a>
        
        <div class="demo-section">
            <strong>Demo Mode:</strong> For testing, you can use this demo token:
            <div class="token-display">descope-demo-token-2024</div>
            <button onclick="useDemoToken()" style="margin-top: 10px; padding: 8px 16px; border: none; background: #ffc107; border-radius: 4px; cursor: pointer;">
                Use Demo Token
            </button>
        </div>
        
        <div class="info">
            <strong>For MCP Connectors:</strong> After authentication, copy the token and use it in Claude Web:
            <br>• Header: <code>Authorization: Bearer &lt;token&gt;</code>
            <br>• URL: <code>${req.protocol}://${req.get('host')}</code>
        </div>
        
        <div id="result" style="margin-top: 20px;"></div>
    </div>
    
    <script>
        async function useDemoToken() {
            const token = 'descope-demo-token-2024';
            document.getElementById('result').innerHTML = \`
                <div style="background: #d4edda; padding: 15px; border-radius: 6px; border-left: 4px solid #28a745;">
                    <strong>Demo Token Ready!</strong><br>
                    Use this in Claude Web Connectors:<br>
                    <div class="token-display">Authorization: Bearer \${token}</div>
                    <button onclick="copyToken('\${token}')" style="margin-top: 10px; padding: 6px 12px; border: none; background: #28a745; color: white; border-radius: 4px; cursor: pointer;">
                        Copy Token
                    </button>
                </div>
            \`;
        }
        
        function copyToken(token) {
            navigator.clipboard.writeText('Bearer ' + token);
            alert('Token copied to clipboard!');
        }
        
        // Handle OAuth redirects
        if (window.location.hash.includes('access_token')) {
            const params = new URLSearchParams(window.location.hash.substring(1));
            const token = params.get('access_token');
            if (token) {
                document.getElementById('result').innerHTML = \`
                    <div style="background: #d4edda; padding: 15px; border-radius: 6px; border-left: 4px solid #28a745;">
                        <strong>Authentication Successful!</strong><br>
                        Your token:<br>
                        <div class="token-display">\${token}</div>
                        <button onclick="copyToken('\${token}')" style="margin-top: 10px; padding: 6px 12px; border: none; background: #28a745; color: white; border-radius: 4px; cursor: pointer;">
                            Copy Token
                        </button>
                    </div>
                \`;
            }
        }
    </script>
</body>
</html>
  `;
  
  res.send(loginPage);
});

// OAuth endpoints
app.get('/oauth/:provider', async (req, res) => {
  const provider = req.params.provider;
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  
  try {
    // For demo purposes, simulate OAuth flow
    // In production, integrate with actual Descope OAuth flows
    const demoToken = `descope-${provider}-${Date.now()}`;
    
    res.redirect(`/login#access_token=${demoToken}&provider=${provider}&success=true`);
  } catch (error) {
    console.error('OAuth error:', error);
    res.redirect(`/login?error=oauth_failed&provider=${provider}`);
  }
});

// Helper function to get base64 images
async function getProductImageBase64(handle) {
  const imageMap = {
    'multi-factor-tee': '/Users/sharanyareddycharabuddi/ai-projects/descope-store/public/images/small/multi-factor-tee.png',
    'descope-mug': '/Users/sharanyareddycharabuddi/ai-projects/descope-store/public/images/small/descope-mug.png',
    'descope-cap': '/Users/sharanyareddycharabuddi/ai-projects/descope-store/public/images/small/descope-cap.png',
    'descope-hoodie': '/Users/sharanyareddycharabuddi/ai-projects/descope-store/public/images/small/descope-hoodie.png'
  };
  
  const imagePath = imageMap[handle] || '/Users/sharanyareddycharabuddi/ai-projects/descope-store/public/images/small/descope-logo.png';
  
  try {
    const imageBuffer = fs.readFileSync(imagePath);
    return imageBuffer.toString('base64');
  } catch (error) {
    console.error(`Error reading image ${imagePath}:`, error);
    return null;
  }
}

// List available tools (protected endpoint)
app.get('/mcp/tools', authenticateWithDescope, (req, res) => {
  res.json({
    tools: [
      {
        name: 'browse_catalog',
        description: 'Browse the complete Descope product catalog with images displayed inline',
        inputSchema: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              description: 'Filter by category (optional): Shirts, Hat, Clothing, Home & Kitchen'
            }
          }
        }
      },
      {
        name: 'get_product_details',
        description: 'Get detailed product information with embedded image display',
        inputSchema: {
          type: 'object',
          properties: {
            productId: {
              type: 'number',
              description: 'ID of the product to get details for'
            }
          },
          required: ['productId']
        }
      },
      {
        name: 'search_products',
        description: 'Search products with image previews',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query for products (e.g., "tee", "mug", "authentication")'
            }
          }
        }
      },
      {
        name: 'create_order',
        description: 'Create a new order for Descope products',
        inputSchema: {
          type: 'object',
          properties: {
            customer_email: {
              type: 'string',
              description: 'Customer email address'
            },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  product_id: { type: 'number' },
                  variant_id: { type: 'number' },
                  quantity: { type: 'number' }
                },
                required: ['product_id', 'quantity']
              },
              description: 'Array of items to order'
            }
          },
          required: ['customer_email', 'items']
        }
      }
    ]
  });
});

// Execute tool calls (protected endpoint)  
app.post('/mcp/tools/call', authenticateWithDescope, async (req, res) => {
  const { name, arguments: args } = req.body;

  try {
    switch (name) {
      case 'browse_catalog':
        return res.json(await browseCatalog(args || {}));
      case 'get_product_details':
        return res.json(await getProductDetails(args));
      case 'search_products':
        return res.json(await searchProducts(args || {}));
      case 'create_order':
        return res.json(await createOrder(args));
      default:
        return res.status(400).json({ error: `Unknown tool: ${name}` });
    }
  } catch (error) {
    console.error(`Tool execution error:`, error);
    res.status(500).json({ 
      error: `Error executing ${name}: ${error.message}`,
      isError: true 
    });
  }
});

// Tool implementations (same as before)
async function browseCatalog(args) {
  const { category } = args;
  const url = new URL(`${STORE_BASE_URL}/api/products`);
  
  if (category) url.searchParams.set('type', category);
  
  const response = await axios.get(url.toString());
  const products = response.data.products;

  const content = [
    {
      type: 'text',
      text: `# 🛡️ Descope Authentication Store Catalog\n\n*Premium developer merchandise with authentication themes*\n\n---`
    }
  ];

  for (const product of products) {
    const imageBase64 = await getProductImageBase64(product.handle);
    
    if (imageBase64) {
      content.push({
        type: 'image',
        data: imageBase64,
        mimeType: 'image/png'
      });
    }
    
    content.push({
      type: 'text',
      text: `## ${product.title}\n\n**$${product.price}** ${product.compare_at_price ? `~~$${product.compare_at_price}~~ (Save $${(product.compare_at_price - product.price).toFixed(2)})` : ''}\n\n${product.body.replace(/<[^>]*>/g, '').substring(0, 200)}...\n\n**📦 Stock:** ${product.inventory_qty} units | **🎯 Variants:** ${product.variants.length} options\n**🏷️ Tags:** ${product.tags.join(', ')}\n**🆔 Product ID:** ${product.id}\n\n---`
    });
  }

  content.push({
    type: 'text',
    text: `\n📊 **Catalog Summary:**\n- **${products.length} Products** available\n- **${products.reduce((sum, p) => sum + p.variants.length, 0)} Variants** total\n- **${products.reduce((sum, p) => sum + p.inventory_qty, 0)} Items** in stock\n- **Price Range:** $${Math.min(...products.map(p => p.price))} - $${Math.max(...products.map(p => p.price))}`
  });

  return { content };
}

async function getProductDetails(args) {
  const { productId } = args;
  
  const response = await axios.get(`${STORE_BASE_URL}/api/products/${productId}`);
  const product = response.data;

  const content = [];
  
  const imageBase64 = await getProductImageBase64(product.handle);
  if (imageBase64) {
    content.push({
      type: 'image',
      data: imageBase64,
      mimeType: 'image/png'
    });
  }
  
  content.push({
    type: 'text',
    text: `# 🛡️ ${product.title}\n\n*${product.vendor} • ${product.type}*\n\n---\n\n## 💰 Pricing\n**$${product.price}** ${product.compare_at_price ? `~~$${product.compare_at_price}~~ (${Math.round(((product.compare_at_price - product.price) / product.compare_at_price) * 100)}% off)` : ''}\n\n## 📝 Description\n${product.body.replace(/<[^>]*>/g, '')}\n\n## 📦 Availability\n- **In Stock:** ${product.inventory_qty} units\n- **SKU:** ${product.sku}\n- **Status:** ${product.inventory_qty > 0 ? '✅ Available' : '❌ Out of Stock'}\n\n## 🎯 Variants Available\n${product.variants.map(v => `- **${v.option1_value}**: $${v.price} (${v.inventory_qty} available)`).join('\n')}\n\n## 🏷️ Product Tags\n${product.tags.map(tag => `\`${tag}\``).join(' ')}`
  });

  return { content };
}

async function searchProducts(args) {
  const { query } = args;
  const url = new URL(`${STORE_BASE_URL}/api/products`);
  
  if (query) url.searchParams.set('query', query);
  
  const response = await axios.get(url.toString());
  const products = response.data.products;

  if (products.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: `🔍 No products found for query: "${query}"`
        }
      ]
    };
  }

  const content = [
    {
      type: 'text',
      text: `# 🔍 Search Results: "${query || 'All Products'}"\n\n*Found ${products.length} Descope authentication products*\n\n---`
    }
  ];

  for (const product of products) {
    const imageBase64 = await getProductImageBase64(product.handle);
    
    if (imageBase64) {
      content.push({
        type: 'image',
        data: imageBase64,
        mimeType: 'image/png'
      });
    }
    
    content.push({
      type: 'text',
      text: `## 🛡️ ${product.title}\n\n**💰 $${product.price}** ${product.compare_at_price ? `~~$${product.compare_at_price}~~ (Save $${(product.compare_at_price - product.price).toFixed(2)})` : ''}\n\n${product.body.replace(/<[^>]*>/g, '').substring(0, 200)}...\n\n**📦 Stock:** ${product.inventory_qty} units | **🎯 Variants:** ${product.variants.length} options\n**🏷️ Tags:** ${product.tags.join(', ')}\n**🆔 Product ID:** ${product.id}\n\n---`
    });
  }

  return { content };
}

async function createOrder(args) {
  const { customer_email, items } = args;
  
  for (const item of items) {
    try {
      await axios.get(`${STORE_BASE_URL}/api/products/${item.product_id}`);
    } catch (error) {
      throw new Error(`Product ${item.product_id} not found`);
    }
  }
  
  const response = await axios.post(`${STORE_BASE_URL}/api/orders`, {
    customer_email,
    items
  });

  const order = response.data;

  return {
    content: [
      {
        type: 'text',
        text: `# 🎉 Order Created Successfully!\n\n*Your Descope authentication products are on the way*\n\n---\n\n## 📋 Order Details\n\n**Order ID:** #${order.id}\n**Customer:** ${order.customer_email}\n**Status:** ${order.status.toUpperCase()}\n**Total:** $${order.total_price}\n**Items:** ${order.items.length}\n**Date:** ${new Date(order.created_at).toLocaleDateString()}\n\n## 🛍️ Items Ordered\n\n${order.items.map(item => 
          `- **${item.product_title}**${item.variant_sku ? ` (${item.variant_sku})` : ''}\n  - Quantity: ${item.quantity}\n  - Price: $${item.price} each\n  - Subtotal: $${(item.price * item.quantity).toFixed(2)}`
        ).join('\n\n')}\n\n## 📦 Next Steps\n\n1. ✅ **Order Confirmed** - Your order has been placed\n2. ⏳ **Processing** - We're preparing your items\n3. 🚚 **Shipping** - Your order will be shipped soon\n4. 📧 **Updates** - Check your email for tracking information\n\n*Thank you for choosing Descope authentication products!*`
      }
    ]
  };
}

// Start the server
app.listen(PORT, () => {
  console.log(`🛡️ Descope Store Social Auth MCP Server running on port ${PORT}`);
  console.log(`📍 Server URL: http://localhost:${PORT}`);
  console.log(`🔐 Social Login: http://localhost:${PORT}/login`);
  console.log(`⚡ MCP Tools: http://localhost:${PORT}/mcp/tools`);
  console.log(`💚 Health check: http://localhost:${PORT}/health`);
  console.log(`🌐 Project ID: ${DESCOPE_PROJECT_ID}`);
  console.log('');
  console.log('🌐 Ready for social authentication with Descope!');
});