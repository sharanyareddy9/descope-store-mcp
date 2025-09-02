#!/usr/bin/env node
import "dotenv/config";
import express from "express";
import https from "https";
import fs from "fs";
import cors from "cors";
import axios from "axios";
import { z } from "zod";
import { 
  descopeMcpAuthRouter, 
  descopeMcpBearerAuth,
  defineTool,
  createMcpServerHandler 
} from "@descope/mcp-express";

const app = express();
const PORT = process.env.PORT || 3001;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const STORE_BASE_URL = process.env.DESCOPE_STORE_URL || 'http://localhost:3000';
const SERVER_URL = process.env.SERVER_URL || `https://localhost:${HTTPS_PORT}`;

// Middleware
app.use(express.json());
app.use(cors({
  origin: '*',
  credentials: true
}));

// Add Descope MCP Auth Router (OAuth 2.1 endpoints)
app.use(descopeMcpAuthRouter());

// Apply Descope Bearer Auth to MCP endpoints
app.use(["/sse", "/message"], descopeMcpBearerAuth());

// Define authenticated tools using Descope MCP Express SDK
const searchProducts = defineTool({
  name: "search_products",
  description: "Search for Descope authentication products in the store",
  input: {
    query: z.string().optional().describe("Search query for products"),
    category: z.string().optional().describe("Product category filter (apparel, accessories)")
  },
  scopes: ["store:read"],
  handler: async (args, extra) => {
    try {
      const response = await axios.get(`${STORE_BASE_URL}/api/products`);
      let products = response.data;

      // Apply search filters
      if (args.query) {
        products = products.filter(p => 
          p.title.toLowerCase().includes(args.query.toLowerCase()) ||
          p.description.toLowerCase().includes(args.query.toLowerCase())
        );
      }

      if (args.category) {
        products = products.filter(p => 
          p.product_type.toLowerCase() === args.category.toLowerCase()
        );
      }

      const results = products.map(p => ({
        id: p.id,
        title: p.title,
        price: p.variants[0]?.price || 'N/A',
        description: p.description.substring(0, 150) + '...',
        image_url: p.image_url,
        product_type: p.product_type
      }));

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            found: results.length,
            query: args.query,
            category: args.category,
            products: results,
            user_scopes: extra.authInfo.scopes
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text", 
          text: `Error searching products: ${error.message}`
        }]
      };
    }
  }
});

const getProduct = defineTool({
  name: "get_product",
  description: "Get detailed information about a specific Descope store product",
  input: {
    product_id: z.string().describe("The product ID to retrieve")
  },
  scopes: ["store:read"],
  handler: async (args, extra) => {
    try {
      const response = await axios.get(`${STORE_BASE_URL}/api/products`);
      const product = response.data.find(p => p.id === args.product_id);
      
      if (!product) {
        return {
          content: [{
            type: "text",
            text: `Product with ID "${args.product_id}" not found`
          }]
        };
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            id: product.id,
            title: product.title,
            description: product.description,
            product_type: product.product_type,
            variants: product.variants,
            image_url: product.image_url,
            created_at: product.created_at,
            updated_at: product.updated_at,
            user_info: {
              scopes: extra.authInfo.scopes,
              authenticated_at: new Date().toISOString()
            }
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Error fetching product: ${error.message}`
        }]
      };
    }
  }
});

const compareProducts = defineTool({
  name: "compare_products", 
  description: "Compare multiple Descope store products side by side",
  input: {
    product_ids: z.array(z.string()).min(2).max(4).describe("Array of 2-4 product IDs to compare")
  },
  scopes: ["store:read"],
  handler: async (args, extra) => {
    try {
      const response = await axios.get(`${STORE_BASE_URL}/api/products`);
      const products = response.data.filter(p => args.product_ids.includes(p.id));
      
      if (products.length === 0) {
        return {
          content: [{
            type: "text",
            text: "No products found with the provided IDs"
          }]
        };
      }

      const comparison = {
        total_compared: products.length,
        requested_ids: args.product_ids,
        comparison: products.map(p => ({
          id: p.id,
          title: p.title,
          price: p.variants[0]?.price || 'N/A',
          product_type: p.product_type,
          description: p.description.substring(0, 100) + '...',
          image_url: p.image_url,
          variant_count: p.variants.length
        })),
        recommendation: products.length > 0 ? {
          top_pick: products[0].title,
          reason: "Based on availability and features"
        } : null,
        auth_info: {
          scopes: extra.authInfo.scopes,
          comparison_time: new Date().toISOString()
        }
      };

      return {
        content: [{
          type: "text",
          text: JSON.stringify(comparison, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Error comparing products: ${error.message}`
        }]
      };
    }
  }
});

const getStoreInfo = defineTool({
  name: "get_store_info",
  description: "Get general information about the Descope authentication store",
  input: {},
  scopes: ["store:read"],
  handler: async (args, extra) => {
    try {
      const response = await axios.get(`${STORE_BASE_URL}/api/products`);
      const products = response.data;
      
      const categories = [...new Set(products.map(p => p.product_type))];
      const totalVariants = products.reduce((sum, p) => sum + p.variants.length, 0);
      
      const storeInfo = {
        store_name: "Descope Authentication Store",
        description: "Premium authentication-themed merchandise and apparel",
        total_products: products.length,
        categories: categories,
        total_variants: totalVariants,
        featured_products: products.slice(0, 2).map(p => ({
          id: p.id,
          title: p.title,
          price: p.variants[0]?.price || 'N/A'
        })),
        server_info: {
          mcp_version: "2025-03-26",
          auth_provider: "Descope OAuth 2.1",
          user_scopes: extra.authInfo.scopes
        }
      };

      return {
        content: [{
          type: "text",
          text: JSON.stringify(storeInfo, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Error fetching store info: ${error.message}`
        }]
      };
    }
  }
});

// Create MCP server handler with all tools
const mcpHandler = createMcpServerHandler([
  searchProducts, 
  getProduct, 
  compareProducts, 
  getStoreInfo
]);

// Mount MCP handler on protected routes
app.use('/sse', mcpHandler);
app.use('/message', mcpHandler);

// Public endpoints
app.get('/', (req, res) => {
  const homePage = `
<!DOCTYPE html>
<html>
<head>
    <title>Descope Store MCP Server</title>
    <style>
        body { 
            font-family: Inter, system-ui, sans-serif;
            max-width: 800px; 
            margin: 0 auto;
            padding: 40px 20px;
            background: #111827;
            color: #f9fafb;
        }
        .container {
            background: #1f2937;
            border-radius: 12px;
            padding: 40px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.3);
        }
        .header {
            text-align: center;
            margin-bottom: 40px;
        }
        .title {
            font-size: 2.5rem;
            font-weight: 700;
            background: linear-gradient(135deg, #7deded, #6366f1);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 16px;
        }
        .subtitle {
            font-size: 1.2rem;
            color: #9ca3af;
            margin-bottom: 8px;
        }
        .description {
            color: #6b7280;
            font-size: 1rem;
        }
        .features {
            display: grid;
            gap: 20px;
            margin: 40px 0;
        }
        .feature {
            background: #374151;
            padding: 20px;
            border-radius: 8px;
            border-left: 4px solid #7deded;
        }
        .feature h3 {
            margin: 0 0 8px 0;
            color: #f3f4f6;
        }
        .feature p {
            margin: 0;
            color: #d1d5db;
            font-size: 0.9rem;
        }
        .endpoints {
            background: #0f172a;
            padding: 20px;
            border-radius: 8px;
            font-family: 'Monaco', monospace;
            font-size: 0.9rem;
            margin: 20px 0;
        }
        .endpoint {
            margin: 8px 0;
            color: #7deded;
        }
        .auth-info {
            background: #1e3a8a;
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
        }
        .tools-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin: 30px 0;
        }
        .tool-card {
            background: #4b5563;
            padding: 16px;
            border-radius: 6px;
            border: 1px solid #6b7280;
        }
        .tool-card h4 {
            margin: 0 0 8px 0;
            color: #f9fafb;
        }
        .tool-card p {
            margin: 0;
            color: #d1d5db;
            font-size: 0.85rem;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1 class="title">🔐 Descope Store MCP</h1>
            <p class="subtitle">Model Context Protocol Server</p>
            <p class="description">OAuth 2.1 authenticated access to Descope authentication products</p>
        </div>

        <div class="auth-info">
            <h3>🛡️ Authentication Required</h3>
            <p>This MCP server uses Descope OAuth 2.1 for authentication. Connect using your MCP client with the SSE endpoint below.</p>
        </div>

        <div class="features">
            <div class="feature">
                <h3>✅ OAuth 2.1 Compliant</h3>
                <p>Secure bearer token authentication with scope-based access control</p>
            </div>
            <div class="feature">
                <h3>🔧 MCP Tools</h3>
                <p>Search products, get product details, compare items, and access store information</p>
            </div>
            <div class="feature">
                <h3>🌐 SSE Transport</h3>
                <p>Server-Sent Events for real-time MCP communication</p>
            </div>
        </div>

        <h3>🔗 MCP Endpoints</h3>
        <div class="endpoints">
            <div class="endpoint">SSE Endpoint: ${SERVER_URL}/sse</div>
            <div class="endpoint">Message Endpoint: ${SERVER_URL}/message</div>
            <div class="endpoint">OAuth Metadata: ${SERVER_URL}/.well-known/oauth-authorization-server</div>
        </div>

        <h3>🛠️ Available Tools</h3>
        <div class="tools-grid">
            <div class="tool-card">
                <h4>search_products</h4>
                <p>Search Descope store products by query and category</p>
            </div>
            <div class="tool-card">
                <h4>get_product</h4>
                <p>Get detailed information about a specific product</p>
            </div>
            <div class="tool-card">
                <h4>compare_products</h4>
                <p>Compare multiple products side by side</p>
            </div>
            <div class="tool-card">
                <h4>get_store_info</h4>
                <p>Get general store information and statistics</p>
            </div>
        </div>

        <div style="text-align: center; margin-top: 40px; color: #6b7280; font-size: 0.9rem;">
            <p>Project ID: ${process.env.DESCOPE_PROJECT_ID}</p>
            <p>Powered by @descope/mcp-express SDK</p>
        </div>
    </div>
</body>
</html>`;
  
  res.send(homePage);
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    server: 'Descope Store MCP Server',
    version: '1.0.0',
    mcp_version: '2025-03-26',
    auth: 'Descope OAuth 2.1',
    endpoints: {
      sse: `${SERVER_URL}/sse`,
      message: `${SERVER_URL}/message`,
      oauth_metadata: `${SERVER_URL}/.well-known/oauth-authorization-server`
    },
    timestamp: new Date().toISOString()
  });
});

// HTTPS server configuration
const httpsOptions = {
  key: fs.readFileSync('key.pem'),
  cert: fs.readFileSync('cert.pem')
};

// Start HTTPS server
https.createServer(httpsOptions, app).listen(HTTPS_PORT, () => {
  console.log(`🔐 Descope Store MCP Server running on HTTPS port ${HTTPS_PORT}`);
  console.log(`📍 Server URL: ${SERVER_URL}`);
  console.log(`🔌 SSE Endpoint: ${SERVER_URL}/sse`);
  console.log(`💬 Message Endpoint: ${SERVER_URL}/message`);  
  console.log(`🔑 OAuth Metadata: ${SERVER_URL}/.well-known/oauth-authorization-server`);
  console.log(`🌐 Project ID: ${process.env.DESCOPE_PROJECT_ID}`);
  console.log(`✨ Using @descope/mcp-express SDK`);
  console.log(`🛡️ OAuth 2.1 Authentication Required`);
  console.log(`🌐 HTTPS Ready for MCP Connectors`);
});

// Also start HTTP server for local testing
app.listen(PORT, () => {
  console.log(`📍 HTTP Server also running on port ${PORT} for local testing`);
});