#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createUIResource } from '@mcp-ui/server';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

const STORE_BASE_URL = process.env.DESCOPE_STORE_URL || 'http://localhost:3000';

class DescopeStoreMCPUIServer {
  constructor() {
    this.server = new Server(
      {
        name: 'descope-store-mcp-ui',
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
    // Convert optimized small images to base64 data URLs for MCP UI
    const imageMap = {
      'multi-factor-tee': '/Users/sharanyareddycharabuddi/ai-projects/descope-store/public/images/small/multi-factor-tee.png',
      'descope-mug': '/Users/sharanyareddycharabuddi/ai-projects/descope-store/public/images/small/descope-mug.png',
      'descope-cap': '/Users/sharanyareddycharabuddi/ai-projects/descope-store/public/images/small/descope-cap.png',
      'descope-hoodie': '/Users/sharanyareddycharabuddi/ai-projects/descope-store/public/images/small/descope-hoodie.png'
    };
    
    const imagePath = imageMap[handle] || '/Users/sharanyareddycharabuddi/ai-projects/descope-store/public/images/small/descope-logo.png';
    
    try {
      const imageBuffer = fs.readFileSync(imagePath);
      return `data:image/png;base64,${imageBuffer.toString('base64')}`;
    } catch (error) {
      console.error(`Error reading image ${imagePath}:`, error);
      return null;
    }
  }

  setupResourceHandlers() {
    // List available UI resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      try {
        const response = await axios.get(`${STORE_BASE_URL}/api/products`);
        const products = response.data.products || [];
        
        const resources = products.map(product => ({
          uri: `ui://product/${product.id}`,
          name: `${product.title} - Product UI`,
          description: `Interactive product view for ${product.title} with image and details`,
          mimeType: 'text/html'
        }));

        // Add catalog resource
        resources.unshift({
          uri: 'ui://catalog',
          name: 'Descope Product Catalog UI',
          description: 'Interactive catalog of all Descope authentication products',
          mimeType: 'text/html'
        });

        return { resources };
      } catch (error) {
        return { resources: [] };
      }
    });

    // Read specific UI resources
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;
      
      if (uri === 'ui://catalog') {
        return await this.getCatalogUIResource();
      }
      
      const productMatch = uri.match(/^ui:\/\/product\/(\d+)$/);
      if (productMatch) {
        return await this.getProductUIResource(parseInt(productMatch[1]));
      }
      
      throw new Error(`Resource not found: ${uri}`);
    });
  }

  async getCatalogUIResource() {
    const response = await axios.get(`${STORE_BASE_URL}/api/products`);
    const products = response.data.products || [];

    // Generate product HTML with embedded base64 images
    const productHTMLPromises = products.map(async product => {
      const imageBase64 = await this.getProductImageBase64(product.handle);
      return `
        <div style="border: 1px solid #e1e1e1; border-radius: 8px; padding: 20px; background: white; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          ${imageBase64 ? `<img src="${imageBase64}" alt="${product.title}" 
               style="width: 100%; height: 200px; object-fit: cover; border-radius: 4px; margin-bottom: 15px;" />` : ''}
          
          <h3 style="margin: 0 0 10px 0; color: #1a1a1a; font-size: 18px;">${product.title}</h3>
          
          <div style="margin-bottom: 15px;">
            <span style="font-size: 20px; font-weight: bold; color: #2563eb;">$${product.price}</span>
            ${product.compare_at_price ? `
              <span style="text-decoration: line-through; color: #666; margin-left: 8px;">$${product.compare_at_price}</span>
              <span style="color: #059669; margin-left: 8px; font-size: 12px;">
                Save $${(product.compare_at_price - product.price).toFixed(2)}
              </span>
            ` : ''}
          </div>
          
          <p style="color: #666; font-size: 14px; margin-bottom: 15px;">
            ${product.body.replace(/<[^>]*>/g, '').substring(0, 120)}...
          </p>
          
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #888;">
            <span>📦 ${product.inventory_qty} in stock</span>
            <span>🎯 ${product.variants.length} variants</span>
          </div>
          
          <div style="margin-top: 10px;">
            ${product.tags.map(tag => `
              <span style="background: #f3f4f6; color: #374151; padding: 2px 6px; border-radius: 3px; font-size: 11px; margin-right: 4px;">
                ${tag}
              </span>
            `).join('')}
          </div>
        </div>
      `;
    });

    const productHTMLArray = await Promise.all(productHTMLPromises);

    const catalogHTML = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #1a1a1a; text-align: center; margin-bottom: 30px;">
          🛡️ Descope Authentication Store
        </h1>
        <p style="text-align: center; color: #666; margin-bottom: 40px;">
          Premium developer merchandise with authentication themes
        </p>
        
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px;">
          ${productHTMLArray.join('')}
        </div>
        
        <div style="text-align: center; margin-top: 40px; padding: 20px; background: #f8f9fa; border-radius: 8px;">
          <h3 style="color: #1a1a1a; margin-bottom: 10px;">📊 Catalog Summary</h3>
          <p style="color: #666; margin: 5px 0;">
            <strong>${products.length}</strong> Products available • 
            <strong>${products.reduce((sum, p) => sum + p.variants.length, 0)}</strong> Variants total • 
            <strong>${products.reduce((sum, p) => sum + p.inventory_qty, 0)}</strong> Items in stock
          </p>
          <p style="color: #666; margin: 5px 0;">
            Price Range: <strong>$${Math.min(...products.map(p => p.price))} - $${Math.max(...products.map(p => p.price))}</strong>
          </p>
        </div>
      </div>
    `;

    return {
      contents: [createUIResource({
        uri: 'ui://catalog',
        content: { 
          type: 'rawHtml', 
          htmlString: catalogHTML
        },
        encoding: 'text'
      })]
    };
  }

  async getProductUIResource(productId) {
    const response = await axios.get(`${STORE_BASE_URL}/api/products/${productId}`);
    const product = response.data;

    const imageBase64 = await this.getProductImageBase64(product.handle);

    const productHTML = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #1a1a1a; text-align: center; margin-bottom: 20px;">
          🛡️ ${product.title}
        </h1>
        <p style="text-align: center; color: #666; margin-bottom: 30px;">
          ${product.vendor} • ${product.type}
        </p>
        
        <div style="text-align: center; margin-bottom: 30px;">
          ${imageBase64 ? `<img src="${imageBase64}" alt="${product.title}" 
               style="max-width: 100%; height: auto; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);" />` : ''}
        </div>
        
        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 30px;">
          <h2 style="margin-top: 0; color: #1a1a1a;">💰 Pricing</h2>
          <div style="font-size: 28px; font-weight: bold; color: #2563eb; margin-bottom: 10px;">
            $${product.price}
            ${product.compare_at_price ? `
              <span style="text-decoration: line-through; color: #666; font-size: 20px; margin-left: 12px;">$${product.compare_at_price}</span>
              <span style="color: #059669; font-size: 16px; margin-left: 12px;">
                (${Math.round(((product.compare_at_price - product.price) / product.compare_at_price) * 100)}% off)
              </span>
            ` : ''}
          </div>
        </div>
        
        <div style="margin-bottom: 30px;">
          <h2 style="color: #1a1a1a;">📝 Description</h2>
          <p style="color: #666; line-height: 1.6;">
            ${product.body.replace(/<[^>]*>/g, '')}
          </p>
        </div>
        
        <div style="background: white; border: 1px solid #e1e1e1; border-radius: 8px; padding: 20px; margin-bottom: 30px;">
          <h2 style="margin-top: 0; color: #1a1a1a;">📦 Availability</h2>
          <ul style="list-style: none; padding: 0;">
            <li style="margin-bottom: 8px;"><strong>In Stock:</strong> ${product.inventory_qty} units</li>
            <li style="margin-bottom: 8px;"><strong>SKU:</strong> ${product.sku}</li>
            <li style="margin-bottom: 8px;">
              <strong>Status:</strong> 
              <span style="color: ${product.inventory_qty > 0 ? '#059669' : '#dc2626'};">
                ${product.inventory_qty > 0 ? '✅ Available' : '❌ Out of Stock'}
              </span>
            </li>
          </ul>
        </div>
        
        <div style="margin-bottom: 30px;">
          <h2 style="color: #1a1a1a;">🎯 Variants Available</h2>
          <div style="display: grid; gap: 10px;">
            ${product.variants.map(v => `
              <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <strong>${v.option1_value}</strong>
                  <div style="font-size: 12px; color: #666;">${v.inventory_qty} available</div>
                </div>
                <div style="font-weight: bold; color: #2563eb;">$${v.price}</div>
              </div>
            `).join('')}
          </div>
        </div>
        
        <div style="text-align: center;">
          <h2 style="color: #1a1a1a;">🏷️ Product Tags</h2>
          <div>
            ${product.tags.map(tag => `
              <span style="background: #2563eb; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; margin-right: 6px; margin-bottom: 6px; display: inline-block;">
                ${tag}
              </span>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    return {
      contents: [createUIResource({
        uri: `ui://product/${productId}`,
        content: { 
          type: 'rawHtml', 
          htmlString: productHTML
        },
        encoding: 'text'
      })]
    };
  }

  setupToolHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'browse_catalog_ui',
            description: 'Browse the Descope product catalog with rich interactive UI display',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'view_product_ui',
            description: 'View a specific product with interactive UI display',
            inputSchema: {
              type: 'object',
              properties: {
                productId: {
                  type: 'number',
                  description: 'ID of the product to view'
                }
              },
              required: ['productId']
            }
          },
          {
            name: 'search_products_ui',
            description: 'Search products and display with interactive UI',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query for products'
                }
              }
            }
          }
        ]
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'browse_catalog_ui':
            return await this.browseCatalogUI(args);
          case 'view_product_ui':
            return await this.viewProductUI(args);
          case 'search_products_ui':
            return await this.searchProductsUI(args);
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

  async browseCatalogUI(args) {
    const catalogResource = await this.getCatalogUIResource();
    
    return {
      content: [
        {
          type: 'resource',
          resource: catalogResource.contents[0].resource
        }
      ]
    };
  }

  async viewProductUI(args) {
    const { productId } = args;
    const productResource = await this.getProductUIResource(productId);
    
    return {
      content: [
        {
          type: 'resource',
          resource: productResource.contents[0].resource
        }
      ]
    };
  }

  async searchProductsUI(args) {
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

    const searchHTML = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 800px; margin: 0 auto;">
        <h1 style="color: #1a1a1a; text-align: center; margin-bottom: 20px;">
          🔍 Search Results: "${query || 'All Products'}"
        </h1>
        <p style="text-align: center; color: #666; margin-bottom: 40px;">
          Found ${products.length} Descope authentication products
        </p>
        
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px;">
          ${products.map(product => `
            <div style="border: 1px solid #e1e1e1; border-radius: 8px; padding: 20px; background: white; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <img src="${product.image_url}" alt="${product.title}" 
                   style="width: 100%; height: 180px; object-fit: cover; border-radius: 4px; margin-bottom: 15px;" />
              
              <h3 style="margin: 0 0 10px 0; color: #1a1a1a;">🛡️ ${product.title}</h3>
              
              <div style="margin-bottom: 15px;">
                <span style="font-size: 18px; font-weight: bold; color: #2563eb;">💰 $${product.price}</span>
                ${product.compare_at_price ? `
                  <span style="text-decoration: line-through; color: #666; margin-left: 8px;">$${product.compare_at_price}</span>
                  <span style="color: #059669; margin-left: 8px; font-size: 12px;">
                    Save $${(product.compare_at_price - product.price).toFixed(2)}
                  </span>
                ` : ''}
              </div>
              
              <p style="color: #666; font-size: 14px; margin-bottom: 15px;">
                ${product.body.replace(/<[^>]*>/g, '').substring(0, 150)}...
              </p>
              
              <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #888; margin-bottom: 10px;">
                <span>📦 Stock: ${product.inventory_qty} units</span>
                <span>🎯 Variants: ${product.variants.length} options</span>
              </div>
              
              <div>
                <span style="font-weight: bold; font-size: 12px; color: #666;">🆔 Product ID: ${product.id}</span>
              </div>
              
              <div style="margin-top: 10px;">
                ${product.tags.slice(0, 3).map(tag => `
                  <span style="background: #f3f4f6; color: #374151; padding: 2px 6px; border-radius: 3px; font-size: 11px; margin-right: 4px;">
                    ${tag}
                  </span>
                `).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    return {
      content: [
        {
          type: 'resource',
          resource: createUIResource({
            uri: `ui://search/${Date.now()}`,
            content: { 
              type: 'rawHtml', 
              htmlString: searchHTML
            },
            encoding: 'text'
          }).resource
        }
      ]
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('🛡️ Descope Store MCP UI Server running on stdio');
  }
}

const server = new DescopeStoreMCPUIServer();
server.run().catch(console.error);