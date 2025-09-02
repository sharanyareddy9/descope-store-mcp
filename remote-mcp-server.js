#!/usr/bin/env node
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import fs from 'fs';

const app = express();
const PORT = 3001;
const STORE_BASE_URL = process.env.DESCOPE_STORE_URL || 'http://localhost:3000';

// Descope configuration
const DESCOPE_PROJECT_ID = process.env.DESCOPE_PROJECT_ID || 'P2XjqNOwjdlP1TbPmOEE9BXpHKdG';
const DESCOPE_MANAGEMENT_KEY = process.env.DESCOPE_MANAGEMENT_KEY || 'K2XjqNOwjdlP1TbPmOEE9BXpHKdG.P2XjqNOwjdlP1TbPmOEE9BXpHKdG';

// Enable CORS for all origins (required for remote MCP)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Descope-Token', 'X-Descope-Project-ID', 'Accept']
}));

app.use(express.json());

// Descope authentication middleware
const authenticateWithDescope = async (req, res, next) => {
  // Allow health check and info endpoints without auth
  if (req.path === '/health' || req.path === '/mcp/info' || req.method === 'OPTIONS') {
    return next();
  }

  const authHeader = req.headers.authorization;
  const descopeToken = req.headers['x-descope-token'];
  const projectId = req.headers['x-descope-project-id'] || DESCOPE_PROJECT_ID;

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
      message: 'Please provide a valid Descope token',
      auth_methods: {
        'Bearer Token': 'Authorization: Bearer <token>',
        'Descope Token': 'X-Descope-Token: <token>',
        'Project ID': 'X-Descope-Project-ID: <project_id> (optional)'
      },
      auth_endpoints: {
        'login': '/auth/login',
        'signup': '/auth/signup'
      }
    });
  }

  try {
    // Validate token with Descope (simplified validation for demo)
    // In production, you would validate against Descope's validation endpoint
    const isValidToken = await validateDescopeToken(token, projectId);
    
    if (isValidToken) {
      req.user = { token, projectId };
      next();
    } else {
      res.status(401).json({ 
        error: 'Invalid token', 
        message: 'Token validation failed'
      });
    }
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({ 
      error: 'Authentication service error', 
      message: 'Unable to validate token'
    });
  }
};

// Simplified token validation (demo purposes)
async function validateDescopeToken(token, projectId) {
  try {
    // For demo purposes, accept specific demo tokens or any valid-looking JWT
    const demoTokens = [
      'descope-demo-token-2024',
      'mcp-connector-token',
      'descope-store-access'
    ];
    
    if (demoTokens.includes(token)) {
      return true;
    }
    
    // Basic JWT format check (in production, validate with Descope API)
    if (token.includes('.') && token.length > 20) {
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('Token validation error:', error);
    return false;
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    auth: 'Descope Authentication Required'
  });
});

// MCP Server Info endpoint
app.get('/mcp/info', (req, res) => {
  res.json({
    name: 'descope-store-remote-mcp',
    version: '1.0.0',
    description: 'Descope Authentication Store MCP Server with Descope Auth',
    capabilities: {
      tools: true,
      resources: true,
      authentication: 'Descope'
    },
    auth_info: {
      provider: 'Descope',
      project_id: DESCOPE_PROJECT_ID,
      required_headers: ['Authorization: Bearer <token>', 'X-Descope-Token: <token>'],
      demo_tokens: ['descope-demo-token-2024', 'mcp-connector-token', 'descope-store-access']
    }
  });
});

// Authentication endpoints
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  
  // Simplified login for demo (in production, integrate with Descope SDK)
  if (email && password) {
    const demoToken = 'descope-demo-token-2024';
    res.json({
      success: true,
      token: demoToken,
      user: { email, authenticated: true },
      message: 'Demo authentication successful'
    });
  } else {
    res.status(400).json({
      error: 'Missing credentials',
      message: 'Email and password required'
    });
  }
});

app.post('/auth/signup', async (req, res) => {
  const { email, password, name } = req.body;
  
  // Simplified signup for demo
  if (email && password) {
    const demoToken = 'descope-demo-token-2024';
    res.json({
      success: true,
      token: demoToken,
      user: { email, name, authenticated: true },
      message: 'Demo signup successful'
    });
  } else {
    res.status(400).json({
      error: 'Missing information',
      message: 'Email and password required'
    });
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

// Tool implementations
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

  // Add each product with embedded image and details
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
  
  // Add product image
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
  
  // Validate products exist first
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
  console.log(`🛡️ Descope Store Remote MCP Server running on port ${PORT}`);
  console.log(`📍 Server URL: http://localhost:${PORT}`);
  console.log(`⚡ MCP Tools: http://localhost:${PORT}/mcp/tools`);
  console.log(`💚 Health check: http://localhost:${PORT}/health`);
  console.log('');
  console.log('🌐 Ready for tunnel setup with ngrok!');
});