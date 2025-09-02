# 🧪 Descope Store MCP Testing Guide

## Prerequisites
- ✅ Descope Store API running at http://localhost:3000
- ✅ MCP server configured in Claude Desktop
- ✅ Claude Desktop restarted after configuration

## Test Prompts for Claude Desktop

### 1. **Search Products**
```
Search for authentication products in the Descope store
```
**Expected:** List of 4 Descope products with names, prices, and descriptions

### 2. **Search with Query**
```
Find products related to "mug" in the Descope store
```
**Expected:** Should return the Descope Mug product details

### 3. **Get Product Details**
```
Show me detailed information about product ID 1 from the Descope store
```
**Expected:** Full details of Multi-Factor Tee including variants, pricing, stock

### 4. **Compare Products**
```
Compare products 1, 2, and 3 from the Descope store
```
**Expected:** Comparison table showing Multi-Factor Tee, Descope Mug, and Descope Cap

### 5. **Create Order**
```
Create an order for user@example.com with:
- 1 Multi-Factor Tee (product ID 1, variant ID 2)  
- 1 Descope Mug (product ID 2)
```
**Expected:** Order confirmation with order ID, total price, and item details

### 6. **Advanced Search**
```
Search for all clothing items in the Descope store
```
**Expected:** Should return tee and hoodie products

## Troubleshooting

If commands don't work:
1. Check that Descope Store is running: http://localhost:3000/health
2. Verify MCP server is connected (look for connection indicator in Claude Desktop)
3. Try restarting Claude Desktop
4. Check the configuration file is correct

## Available Tools
- `search_products` - Search and filter products
- `get_product_details` - Get detailed product information  
- `compare_products` - Compare multiple products
- `create_order` - Create new orders

## API Endpoints (for reference)
- GET http://localhost:3000/api/products
- GET http://localhost:3000/api/products/1
- GET http://localhost:3000/api/products?query=mug
- POST http://localhost:3000/api/orders