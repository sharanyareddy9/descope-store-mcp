import { createMcpHandler } from '@vercel/mcp-adapter';
import DescopeClient from '@descope/node-sdk';
import { z } from 'zod';
import axios from 'axios';

// Initialize Descope client
const descopeClient = DescopeClient({
  projectId: process.env.DESCOPE_PROJECT_ID,
  managementKey: process.env.DESCOPE_MANAGEMENT_KEY,
});

// Validation schemas
const UserSchema = z.object({
  loginId: z.string(),
  email: z.string().email().optional(),
  name: z.string().optional(),
  phone: z.string().optional(),
  picture: z.string().url().optional(),
  customAttributes: z.record(z.any()).optional(),
});

const CreateUserSchema = z.object({
  loginId: z.string(),
  email: z.string().email().optional(),
  name: z.string().optional(),
  phone: z.string().optional(),
  password: z.string().optional(),
  customAttributes: z.record(z.any()).optional(),
});

const UpdateUserSchema = z.object({
  loginId: z.string(),
  email: z.string().email().optional(),
  name: z.string().optional(),
  phone: z.string().optional(),
  customAttributes: z.record(z.any()).optional(),
});

// Custom token verification function
async function verifyToken(token) {
  try {
    // Verify the JWT token with Descope
    const authInfo = await descopeClient.validateJwt(token);
    
    if (!authInfo.valid) {
      throw new Error('Invalid token');
    }

    return {
      valid: true,
      claims: authInfo.claims,
      userId: authInfo.claims.sub,
      permissions: authInfo.claims.permissions || [],
      roles: authInfo.claims.roles || [],
    };
  } catch (error) {
    console.error('Token verification failed:', error);
    return {
      valid: false,
      error: error.message,
    };
  }
}

// Create MCP handler with Descope authentication
const handler = createMcpHandler({
  name: 'descope-store-mcp',
  version: '1.0.0',
  description: 'Descope Store MCP Server - User management with OAuth 2.1 authentication',
  
  // Custom authentication function
  async authenticate(request) {
    const authHeader = request.headers.get('authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { authenticated: false, error: 'Missing or invalid authorization header' };
    }

    const token = authHeader.substring(7);
    const verification = await verifyToken(token);
    
    if (!verification.valid) {
      return { authenticated: false, error: verification.error || 'Token verification failed' };
    }

    return {
      authenticated: true,
      user: {
        id: verification.userId,
        claims: verification.claims,
        permissions: verification.permissions,
        roles: verification.roles,
      },
    };
  },

  // Define available tools
  tools: {
    list_users: {
      description: 'List all users in the Descope project',
      inputSchema: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Maximum number of users to return (default: 100)',
            minimum: 1,
            maximum: 1000,
          },
          page: {
            type: 'number',
            description: 'Page number for pagination (default: 0)',
            minimum: 0,
          },
        },
      },
      handler: async (args, context) => {
        try {
          const limit = args.limit || 100;
          const page = args.page || 0;
          
          const response = await descopeClient.management.user.searchAll({
            limit,
            page,
          });

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                users: response.users || [],
                totalUsers: response.totalUsers || 0,
                page,
                limit,
                hasMore: (response.users?.length || 0) === limit,
              }, null, 2),
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `Error listing users: ${error.message}`,
            }],
            isError: true,
          };
        }
      },
    },

    get_user: {
      description: 'Get a specific user by login ID',
      inputSchema: {
        type: 'object',
        properties: {
          loginId: {
            type: 'string',
            description: 'The login ID of the user to retrieve',
          },
        },
        required: ['loginId'],
      },
      handler: async (args, context) => {
        try {
          const { loginId } = args;
          const user = await descopeClient.management.user.load(loginId);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify(user, null, 2),
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `Error getting user: ${error.message}`,
            }],
            isError: true,
          };
        }
      },
    },

    create_user: {
      description: 'Create a new user in the Descope project',
      inputSchema: {
        type: 'object',
        properties: {
          loginId: {
            type: 'string',
            description: 'Unique login ID for the user',
          },
          email: {
            type: 'string',
            format: 'email',
            description: 'User email address',
          },
          name: {
            type: 'string',
            description: 'User display name',
          },
          phone: {
            type: 'string',
            description: 'User phone number',
          },
          password: {
            type: 'string',
            description: 'User password (optional)',
          },
          customAttributes: {
            type: 'object',
            description: 'Custom user attributes',
          },
        },
        required: ['loginId'],
      },
      handler: async (args, context) => {
        try {
          const validatedData = CreateUserSchema.parse(args);
          
          const user = await descopeClient.management.user.create(
            validatedData.loginId,
            {
              email: validatedData.email,
              name: validatedData.name,
              phone: validatedData.phone,
              password: validatedData.password,
              customAttributes: validatedData.customAttributes,
            }
          );

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: 'User created successfully',
                user,
              }, null, 2),
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `Error creating user: ${error.message}`,
            }],
            isError: true,
          };
        }
      },
    },

    update_user: {
      description: 'Update an existing user',
      inputSchema: {
        type: 'object',
        properties: {
          loginId: {
            type: 'string',
            description: 'Login ID of the user to update',
          },
          email: {
            type: 'string',
            format: 'email',
            description: 'Updated email address',
          },
          name: {
            type: 'string',
            description: 'Updated display name',
          },
          phone: {
            type: 'string',
            description: 'Updated phone number',
          },
          customAttributes: {
            type: 'object',
            description: 'Updated custom attributes',
          },
        },
        required: ['loginId'],
      },
      handler: async (args, context) => {
        try {
          const validatedData = UpdateUserSchema.parse(args);
          
          const user = await descopeClient.management.user.update(
            validatedData.loginId,
            {
              email: validatedData.email,
              name: validatedData.name,
              phone: validatedData.phone,
              customAttributes: validatedData.customAttributes,
            }
          );

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: 'User updated successfully',
                user,
              }, null, 2),
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `Error updating user: ${error.message}`,
            }],
            isError: true,
          };
        }
      },
    },

    delete_user: {
      description: 'Delete a user from the Descope project',
      inputSchema: {
        type: 'object',
        properties: {
          loginId: {
            type: 'string',
            description: 'Login ID of the user to delete',
          },
        },
        required: ['loginId'],
      },
      handler: async (args, context) => {
        try {
          const { loginId } = args;
          await descopeClient.management.user.delete(loginId);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `User ${loginId} deleted successfully`,
              }, null, 2),
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `Error deleting user: ${error.message}`,
            }],
            isError: true,
          };
        }
      },
    },

    get_oauth_urls: {
      description: 'Get OAuth 2.1 authorization and token URLs for authentication',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      handler: async (args, context) => {
        try {
          const baseUrl = process.env.SERVER_URL || 'https://descope-store-mcp.vercel.app';
          const projectId = process.env.DESCOPE_PROJECT_ID;
          
          const authUrl = `https://api.descope.com/v1/oauth2/authorize?` +
            `response_type=code&` +
            `client_id=${projectId}&` +
            `redirect_uri=${encodeURIComponent(baseUrl + '/auth/callback')}&` +
            `scope=openid profile email&` +
            `state=mcp_auth`;

          const tokenUrl = `https://api.descope.com/v1/oauth2/token`;

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                authorization_endpoint: authUrl,
                token_endpoint: tokenUrl,
                redirect_uri: baseUrl + '/auth/callback',
                client_id: projectId,
                scope: 'openid profile email',
                response_type: 'code',
                grant_type: 'authorization_code',
                instructions: [
                  '1. Visit the authorization_endpoint URL to get an authorization code',
                  '2. Exchange the code for an access token using the token_endpoint',
                  '3. Use the access token as Bearer token in MCP requests',
                ],
              }, null, 2),
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `Error getting OAuth URLs: ${error.message}`,
            }],
            isError: true,
          };
        }
      },
    },
  },

  // Define available resources
  resources: {
    'descope://users': {
      description: 'Access to user data and management',
      mimeType: 'application/json',
      handler: async (uri, context) => {
        try {
          const response = await descopeClient.management.user.searchAll({
            limit: 100,
            page: 0,
          });

          return {
            contents: [{
              uri,
              mimeType: 'application/json',
              text: JSON.stringify({
                users: response.users || [],
                totalUsers: response.totalUsers || 0,
                timestamp: new Date().toISOString(),
              }, null, 2),
            }],
          };
        } catch (error) {
          throw new Error(`Failed to load users resource: ${error.message}`);
        }
      },
    },

    'descope://config': {
      description: 'Server configuration and OAuth endpoints',
      mimeType: 'application/json',
      handler: async (uri, context) => {
        const baseUrl = process.env.SERVER_URL || 'https://descope-store-mcp.vercel.app';
        const projectId = process.env.DESCOPE_PROJECT_ID;

        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({
              server_url: baseUrl,
              project_id: projectId,
              oauth: {
                authorization_endpoint: `https://api.descope.com/v1/oauth2/authorize`,
                token_endpoint: `https://api.descope.com/v1/oauth2/token`,
                redirect_uri: baseUrl + '/auth/callback',
                scope: 'openid profile email',
              },
              mcp: {
                name: 'descope-store-mcp',
                version: '1.0.0',
                description: 'Descope Store MCP Server - User management with OAuth 2.1 authentication',
              },
            }, null, 2),
          }],
        };
      },
    },
  },
});

export default handler;