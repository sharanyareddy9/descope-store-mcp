#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import fs from 'fs';

const STORE_BASE_URL = process.env.DESCOPE_STORE_URL || 'http://localhost:3000';

class DescopeStoreClaudeDesktopServer {
  constructor() {
    this.server = new Server(
      {
        name: 'descope-store-claude-desktop',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    this.setupToolHandlers();
    this.setupResourceHandlers();
  }

  async getProductImageBase64(handle) {
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

  setupResourceHandlers() {
    // List available resources - these won't show UI but can be referenced
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      try {
        const response = await axios.get(`${STORE_BASE_URL}/api/products`);
        const products = response.data.products || [];
        
        const resources = products.map(product => ({
          uri: `descope://product/${product.id}`,
          name: `${product.title} - Product Details`,
          description: `Detailed information about ${product.title}`,
          mimeType: 'application/json'
        }));

        resources.unshift({
          uri: 'descope://catalog',
          name: 'Descope Product Catalog',
          description: 'Complete catalog of all Descope authentication products',
          mimeType: 'application/json'
        });

        return { resources };
      } catch (error) {
        return { resources: [] };
      }
    });

    // Read specific resources
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;
      
      if (uri === 'descope://catalog') {
        return await this.getCatalogResource();
      }
      
      const productMatch = uri.match(/^descope:\/\/product\/(\d+)$/);
      if (productMatch) {
        return await this.getProductResource(parseInt(productMatch[1]));
      }
      
      throw new Error(`Resource not found: ${uri}`);
    });
  }

  async getCatalogResource() {
    const response = await axios.get(`${STORE_BASE_URL}/api/products`);
    const products = response.data.products || [];

    return {
      contents: [{
        uri: 'descope://catalog',
        mimeType: 'application/json',
        text: JSON.stringify({
          catalog: {
            title: '🛡️ Descope Authentication Store',
            description: 'Premium authentication-themed products for developers',
            products: products.map(p => ({
              id: p.id,
              handle: p.handle,
              title: p.title,
              price: p.price,
              compareAtPrice: p.compare_at_price,
              description: p.body.replace(/<[^>]*>/g, ''),
              imageUrl: p.image_url,
              inStock: p.inventory_qty > 0,
              inventory: p.inventory_qty,
              variants: p.variants.length,
              tags: p.tags,
              vendor: p.vendor,
              type: p.type
            }))
          }
        }, null, 2)
      }]
    };
  }

  async getProductResource(productId) {
    const response = await axios.get(`${STORE_BASE_URL}/api/products/${productId}`);
    const product = response.data;

    return {
      contents: [{
        uri: `descope://product/${productId}`,
        mimeType: 'application/json',
        text: JSON.stringify({
          product: {
            ...product,
            description_plain: product.body.replace(/<[^>]*>/g, ''),
            image_url: product.image_url
          }
        }, null, 2)
      }]
    };
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
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
            name: 'compare_products',
            description: 'Compare multiple products with visual comparison',
            inputSchema: {
              type: 'object',
              properties: {
                productIds: {
                  type: 'array',
                  items: { type: 'number' },
                  description: 'Array of product IDs to compare (2-4 products)'
                }
              },
              required: ['productIds']
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
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'browse_catalog':
            return await this.browseCatalog(args);
          case 'get_product_details':
            return await this.getProductDetails(args);
          case 'search_products':
            return await this.searchProducts(args);
          case 'compare_products':
            return await this.compareProducts(args);
          case 'create_order':
            return await this.createOrder(args);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Error: ${error.message}`
            }
          ],
          isError: true
        };
      }
    });
  }

  async browseCatalog(args) {
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
      const imageBase64 = await this.getProductImageBase64(product.handle);
      
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

  async getProductDetails(args) {
    const { productId } = args;
    
    const response = await axios.get(`${STORE_BASE_URL}/api/products/${productId}`);
    const product = response.data;

    const content = [];
    
    // Add product image
    const imageBase64 = await this.getProductImageBase64(product.handle);
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

  async searchProducts(args) {
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
      const imageBase64 = await this.getProductImageBase64(product.handle);
      
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

  async compareProducts(args) {
    const { productIds } = args;
    
    if (productIds.length < 2) {
      throw new Error('At least 2 products required for comparison');
    }
    
    if (productIds.length > 4) {
      throw new Error('Maximum 4 products can be compared at once');
    }

    const products = [];
    for (const id of productIds) {
      try {
        const response = await axios.get(`${STORE_BASE_URL}/api/products/${id}`);
        products.push(response.data);
      } catch (error) {
        throw new Error(`Product ${id} not found`);
      }
    }

    const content = [
      {
        type: 'text',
        text: `# ⚖️ Product Comparison\n\n*Comparing ${products.length} Descope authentication products*\n\n---`
      }
    ];

    // Add comparison table
    content.push({
      type: 'text',
      text: `## 📊 Comparison Table\n\n| Product | Price | Stock | Variants |\n|---------|-------|-------|----------|\n${products.map(p => `| **${p.title}** | $${p.price} | ${p.inventory_qty} | ${p.variants.length} |`).join('\n')}`
    });

    // Add each product with image and details
    for (const product of products) {
      const imageBase64 = await this.getProductImageBase64(product.handle);
      
      if (imageBase64) {
        content.push({
          type: 'image',
          data: imageBase64,
          mimeType: 'image/png'
        });
      }
      
      content.push({
        type: 'text',
        text: `### ${product.title}\n**$${product.price}** | **${product.inventory_qty} in stock** | **${product.variants.length} variants**\n\n${product.body.replace(/<[^>]*>/g, '').substring(0, 120)}...\n\n---`
      });
    }

    return { content };
  }

  async createOrder(args) {
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

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('🛡️ Descope Store MCP Server (Claude Desktop Compatible) running on stdio');
  }
}

const server = new DescopeStoreClaudeDesktopServer();
server.run().catch(console.error);