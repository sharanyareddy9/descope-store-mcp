import "dotenv/config";
import express from "express";
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

// Environment variables for Vercel
const STORE_BASE_URL = process.env.DESCOPE_STORE_URL || 'https://descope-store.vercel.app';
const SERVER_URL = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://localhost:3443';

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
      // Fetch products from deployed Descope store
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

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            found: products.length,
            query: args.query,
            category: args.category,
            products: products,
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
      // Fetch products from deployed Descope store
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
            ...product,
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
      // Fetch products from deployed Descope store
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
          price: p.price,
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
    const storeInfo = {
      store_name: "Descope Authentication Store",
      description: "Premium authentication-themed merchandise and apparel",
      total_products: 2,
      categories: ["apparel"],
      total_variants: 2,
      featured_products: [
        { id: "1", title: "Multi-Factor Authentication T-Shirt", price: "$29.99" },
        { id: "2", title: "Passwordless Login Hoodie", price: "$59.99" }
      ],
      server_info: {
        mcp_version: "2025-03-26",
        auth_provider: "Descope OAuth 2.1",
        deployment: "Vercel Serverless",
        user_scopes: extra.authInfo.scopes
      }
    };

    return {
      content: [{
        type: "text",
        text: JSON.stringify(storeInfo, null, 2)
      }]
    };
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
    <title>Descope Store MCP Server - Vercel</title>
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
        .title {
            font-size: 2.5rem;
            font-weight: 700;
            background: linear-gradient(135deg, #7deded, #6366f1);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 16px;
            text-align: center;
        }
        .subtitle {
            text-align: center;
            color: #9ca3af;
            margin-bottom: 40px;
        }
        .deployment-badge {
            background: #059669;
            color: white;
            padding: 8px 16px;
            border-radius: 20px;
            font-size: 0.9rem;
            display: inline-block;
            margin-bottom: 20px;
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
        .feature {
            background: #374151;
            padding: 20px;
            border-radius: 8px;
            border-left: 4px solid #7deded;
            margin: 20px 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1 class="title">🔐 Descope Store MCP</h1>
        <p class="subtitle">
            <span class="deployment-badge">✨ Deployed on Vercel</span><br>
            Model Context Protocol Server with OAuth 2.1
        </p>
        
        <div class="feature">
            <h3>🛡️ Production Ready</h3>
            <p>Deployed on Vercel with Descope OAuth 2.1 authentication</p>
        </div>

        <h3>🔗 MCP Endpoints</h3>
        <div class="endpoints">
            <div class="endpoint">SSE Endpoint: ${SERVER_URL}/sse</div>
            <div class="endpoint">Message Endpoint: ${SERVER_URL}/message</div>
            <div class="endpoint">OAuth Metadata: ${SERVER_URL}/.well-known/oauth-authorization-server</div>
        </div>

        <div style="text-align: center; margin-top: 40px; color: #6b7280;">
            <p>Project ID: ${process.env.DESCOPE_PROJECT_ID}</p>
            <p>Powered by @descope/mcp-express + Vercel</p>
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
    deployment: 'Vercel Serverless',
    endpoints: {
      sse: `${SERVER_URL}/sse`,
      message: `${SERVER_URL}/message`,
      oauth_metadata: `${SERVER_URL}/.well-known/oauth-authorization-server`
    },
    timestamp: new Date().toISOString()
  });
});

// Export for Vercel
export default app;