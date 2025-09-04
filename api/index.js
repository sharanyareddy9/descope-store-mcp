import "dotenv/config";
import express from "express";
import cors from "cors";
import axios from "axios";
import { z } from "zod";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  descopeMcpAuthRouter,
  descopeMcpBearerAuth,
  defineTool,
  createMcpServerHandler
} from "@descope/mcp-express";

const app = express();

// Environment variables for Vercel
const STORE_BASE_URL = process.env.DESCOPE_STORE_URL || 'https://descope-store.vercel.app';
// Use production URL instead of preview URL for consistent domain
const SERVER_URL = process.env.NODE_ENV === 'production'
  ? 'https://descope-store-mcp.vercel.app'
  : (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://localhost:3443');

// Middleware
app.use(express.json());
app.use(cors({
  origin: '*',
  credentials: true
}));

// Add Descope MCP Auth Router (OAuth 2.1 endpoints)
app.use(descopeMcpAuthRouter({
  projectId: process.env.DESCOPE_PROJECT_ID,
  managementKey: process.env.DESCOPE_MANAGEMENT_KEY,
  serverUrl: SERVER_URL
}));

// Note: Bearer auth is handled by the MCP handler itself, not as middleware
// This allows unauthenticated requests to /sse to be redirected to OAuth login

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
const { server } = createMcpServerHandler([
  searchProducts,
  getProduct,
  compareProducts,
  getStoreInfo
]);

// Initialize transport
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined, // set to undefined for stateless servers
});

// Auth middleware - following Express MCP example pattern
app.use(["/mcp"], descopeMcpBearerAuth());

// MCP endpoint
app.post('/mcp', async (req, res) => {
  console.log('Received MCP request:', req.body);
  try {
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  }
});

// Method not allowed handlers
const methodNotAllowed = (req, res) => {
  console.log(`Received ${req.method} MCP request`);
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed."
    },
    id: null
  });
};

app.get('/mcp', methodNotAllowed);
app.delete('/mcp', methodNotAllowed);

// Connect server to transport
server.connect(transport);

// Public endpoints
app.get('/', (req, res) => {
  const homePage = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Descope Store MCP Server</title>
    <script>
        const SERVER_URL = '${SERVER_URL}/mcp';
    </script>
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    colors: {
                        primary: "#7deded", // Teal
                        secondary: "#6366F1", // Indigo
                        accent: "#EC4899", // Pink
                        dark: {
                            DEFAULT: "#111827",
                            lighter: "#1F2937",
                        }
                    },
                    fontFamily: {
                        sans: ["Inter", "system-ui", "sans-serif"],
                        heading: ["Space Grotesk", "system-ui", "sans-serif"],
                    },
                },
            },
        };
    </script>
    <style>
        @import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap");

        body {
            background-color: #111827;
            color: #F3F4F6;
        }

        pre {
            background: #1F2937 !important;
            color: #E5E7EB !important;
            position: relative;
            white-space: pre-wrap;
            word-wrap: break-word;
            word-break: break-word;
            border-radius: 0.5rem;
            padding: 1rem;
            margin: 0.5rem 0;
            border: 1px solid #374151;
        }

        .card {
            background: #1F2937;
            border: 1px solid #374151;
        }

        .copy-button {
            position: absolute;
            top: 0.5rem;
            right: 0.5rem;
            background: #374151;
            color: #9CA3AF;
            border: none;
            padding: 0.25rem 0.5rem;
            border-radius: 0.25rem;
            font-size: 0.75rem;
            cursor: pointer;
            transition: all 0.2s;
        }

        .copy-button:hover {
            background: #4B5563;
            color: #F3F4F6;
        }

        .copy-button.copied {
            background: #059669;
            color: white;
        }
    </style>
</head>
<body class="dark">
    <main class="container mx-auto px-4 py-8 max-w-4xl">
        <div class="text-center mb-12">
            <h1 class="text-5xl font-bold font-heading text-white mb-4">
                🔐 Descope Store MCP
            </h1>
            <p class="text-xl text-gray-300 mb-6">
                Model Context Protocol Server with OAuth 2.1 Authentication
            </p>
            <div class="inline-flex items-center bg-green-600 text-white px-4 py-2 rounded-full text-sm font-medium">
                ✨ Deployed on Vercel
            </div>
        </div>

        <div class="grid gap-8">
            <div class="card rounded-lg p-6">
                <h2 class="text-2xl font-bold font-heading text-white mb-4">About</h2>
                <p class="text-gray-300 mb-4">
                    This MCP server provides authenticated access to the Descope Authentication Store,
                    featuring premium authentication-themed merchandise and apparel. The server uses
                    <a href="https://www.descope.com/" class="text-primary hover:underline">Descope</a>
                    OAuth 2.1 for secure authentication and authorization.
                </p>
            </div>

            <div class="card rounded-lg p-6">
                <h2 class="text-2xl font-bold font-heading text-white mb-4">Quick Start</h2>
                <div class="space-y-6">
                    <div>
                        <h3 class="text-xl font-semibold text-white mb-3">Server URL</h3>
                        <pre class="relative"><code id="server-url">${SERVER_URL}/mcp</code><button class="copy-button" onclick="copyToClipboard('server-url', this)">Copy</button></pre>
                    </div>

                    <div>
                        <h3 class="text-xl font-semibold text-white mb-3">Configuration</h3>
                        <pre class="relative"><code id="config-json">{
  "mcpServers": {
    "descope-store": {
      "command": "npx",
      "args": [
        "@modelcontextprotocol/server-remote",
        "${SERVER_URL}/mcp"
      ]
    }
  }
}</code><button class="copy-button" onclick="copyToClipboard('config-json', this)">Copy</button></pre>
                    </div>
                </div>
            </div>

            <div class="card rounded-lg p-6">
                <h2 class="text-2xl font-bold font-heading text-white mb-4">IDE Integration</h2>
                <div class="space-y-6">
                    <div>
                        <h3 class="text-xl font-semibold text-white mb-3">Claude Desktop</h3>
                        <ol class="list-decimal pl-6 space-y-2 text-gray-300">
                            <li>Open Claude Desktop Settings</li>
                            <li>Navigate to <strong class="font-semibold text-white">MCP Servers</strong></li>
                            <li>Add the configuration above to your <code class="bg-gray-800 px-2 py-1 rounded">claude_desktop_config.json</code></li>
                            <li>Restart Claude Desktop</li>
                            <li>Authenticate via OAuth when prompted</li>
                        </ol>
                    </div>

                    <div>
                        <h3 class="text-xl font-semibold text-white mb-3">Windsurf</h3>
                        <ol class="list-decimal pl-6 space-y-2 text-gray-300">
                            <li>Open Windsurf Settings</li>
                            <li>Navigate to <strong class="font-semibold text-white">Cascade</strong> → <strong class="font-semibold text-white">Model Context Provider Servers</strong></li>
                            <li>Select <strong class="font-semibold text-white">Add Server</strong></li>
                            <li>Enter the server URL above</li>
                            <li>Complete OAuth authentication</li>
                        </ol>
                    </div>
                </div>
            </div>

            <div class="card rounded-lg p-6">
                <h2 class="text-2xl font-bold font-heading text-white mb-4">Available Tools</h2>
                <div class="grid md:grid-cols-2 gap-4">
                    <div class="bg-gray-800 p-4 rounded-lg">
                        <h4 class="font-semibold text-white mb-2">search_products</h4>
                        <p class="text-gray-300 text-sm">Search for Descope store products by query and category</p>
                    </div>
                    <div class="bg-gray-800 p-4 rounded-lg">
                        <h4 class="font-semibold text-white mb-2">get_product</h4>
                        <p class="text-gray-300 text-sm">Get detailed information about a specific product</p>
                    </div>
                    <div class="bg-gray-800 p-4 rounded-lg">
                        <h4 class="font-semibold text-white mb-2">compare_products</h4>
                        <p class="text-gray-300 text-sm">Compare multiple products side by side</p>
                    </div>
                    <div class="bg-gray-800 p-4 rounded-lg">
                        <h4 class="font-semibold text-white mb-2">get_store_info</h4>
                        <p class="text-gray-300 text-sm">Get general store information and statistics</p>
                    </div>
                </div>
            </div>

            <div class="card rounded-lg p-6">
                <h2 class="text-2xl font-bold font-heading text-white mb-4">Authentication</h2>
                <div class="space-y-4">
                    <div class="flex items-center space-x-3">
                        <div class="w-2 h-2 bg-green-500 rounded-full"></div>
                        <span class="text-gray-300">OAuth 2.1 compliant with PKCE</span>
                    </div>
                    <div class="flex items-center space-x-3">
                        <div class="w-2 h-2 bg-green-500 rounded-full"></div>
                        <span class="text-gray-300">Scope-based access control</span>
                    </div>
                    <div class="flex items-center space-x-3">
                        <div class="w-2 h-2 bg-green-500 rounded-full"></div>
                        <span class="text-gray-300">Bearer token authentication</span>
                    </div>
                    <div class="flex items-center space-x-3">
                        <div class="w-2 h-2 bg-green-500 rounded-full"></div>
                        <span class="text-gray-300">Secure Descope integration</span>
                    </div>
                </div>
            </div>

            <div class="card rounded-lg p-6">
                <h2 class="text-2xl font-bold font-heading text-white mb-4">Troubleshooting</h2>
                <p class="mb-4 text-gray-300">If you encounter authentication issues, try clearing the MCP auth cache:</p>
                <pre class="relative"><code>rm -rf ~/.mcp-auth</code><button class="copy-button" onclick="copyToClipboard(this.previousElementSibling, this)">Copy</button></pre>
            </div>
        </div>
    </main>

    <footer class="bg-gray-900 py-6 mt-12">
        <div class="container mx-auto px-4 text-center text-gray-400">
            <p>&copy; 2025 Descope Store MCP. All rights reserved.</p>
            <p class="mt-2">Project ID: ${process.env.DESCOPE_PROJECT_ID || 'Not Set'}</p>
            <p class="mt-1">Powered by <a href="https://www.descope.com/" class="text-primary hover:underline">@descope/mcp-express</a> + Vercel</p>
        </div>
    </footer>

    <script>
        function copyToClipboard(elementOrId, button) {
            let text;
            if (typeof elementOrId === 'string') {
                text = document.getElementById(elementOrId).textContent;
            } else {
                text = elementOrId.textContent;
            }
            
            navigator.clipboard.writeText(text).then(() => {
                const originalText = button.textContent;
                button.textContent = 'Copied!';
                button.classList.add('copied');
                
                setTimeout(() => {
                    button.textContent = originalText;
                    button.classList.remove('copied');
                }, 2000);
            }).catch(err => {
                console.error('Failed to copy: ', err);
            });
        }

        // Initialize server URL display
        document.addEventListener('DOMContentLoaded', () => {
            const serverUrlElement = document.getElementById('server-url');
            if (serverUrlElement && SERVER_URL) {
                serverUrlElement.textContent = SERVER_URL;
            }
        });
    </script>
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
      mcp: `${SERVER_URL}/mcp`,
      oauth_metadata: `${SERVER_URL}/.well-known/oauth-authorization-server`
    },
    timestamp: new Date().toISOString()
  });
});

// MCP Discovery endpoints that Claude Web might expect
app.get('/.well-known/mcp-capabilities', (req, res) => {
  res.json({
    version: '2025-03-26',
    capabilities: {
      tools: {
        listChanged: true
      },
      resources: {
        subscribe: false,
        listChanged: false
      },
      prompts: {
        listChanged: false
      },
      logging: {}
    },
    serverInfo: {
      name: 'Descope Store MCP Server',
      version: '1.0.0'
    },
    tools: [
      {
        name: 'search_products',
        description: 'Search for Descope authentication products in the store'
      },
      {
        name: 'get_product',
        description: 'Get detailed information about a specific Descope store product'
      },
      {
        name: 'compare_products',
        description: 'Compare multiple Descope store products side by side'
      },
      {
        name: 'get_store_info',
        description: 'Get general information about the Descope authentication store'
      }
    ]
  });
});

app.get('/.well-known/mcp-server', (req, res) => {
  res.json({
    name: 'Descope Store MCP Server',
    version: '1.0.0',
    mcp_version: '2025-03-26',
    endpoints: {
      mcp: `${SERVER_URL}/mcp`
    },
    auth: {
      type: 'oauth2',
      authorization_url: `https://app.descope.com/oauth2/v1/authorize`,
      token_url: `https://api.descope.com/oauth2/v1/token`,
      scopes: ['store:read']
    }
  });
});

// Alternative endpoint that some MCP clients might expect
app.get('/mcp/capabilities', (req, res) => {
  res.redirect('/.well-known/mcp-capabilities');
});

// Favicon endpoint to prevent 404 errors in Claude Web
app.get('/favicon.ico', (req, res) => {
  // Return a simple 1x1 transparent PNG
  const transparentPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChAI9jU77zgAAAABJRU5ErkJggg==',
    'base64'
  );
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
  res.send(transparentPng);
});

// Export for Vercel
export default app;