#!/bin/bash
set -e

ENVIRONMENT=${1:-development}

echo "🚀 Setting up Avatar API Service for $ENVIRONMENT environment..."

if [ ! -f ".env" ]; then
    echo "❌ .env file not found. Please create it first."
    exit 1
fi

source .env

if ! command -v wrangler &> /dev/null; then
    echo "❌ Wrangler CLI not found. Installing..."
    npm install -g wrangler
fi

if ! wrangler whoami &> /dev/null; then
    echo "🔐 Logging in to Cloudflare..."
    wrangler login
fi

echo "🗄️ Creating KV namespace for rate limiting..."
KV_NAME="avatar-api-rate-limit-$ENVIRONMENT"
KV_OUTPUT=$(wrangler kv namespace create "$KV_NAME" 2>/dev/null || echo "")

if [ -n "$KV_OUTPUT" ]; then
    KV_ID=$(echo "$KV_OUTPUT" | grep -o 'id = "[^"]*"' | cut -d'"' -f2)
    echo "✅ Created KV namespace: $KV_ID"
    
    if [ "$ENVIRONMENT" = "development" ]; then
        sed -i.bak "s/your_dev_kv_namespace_id/$KV_ID/g" wrangler.toml
        sed -i.bak "s/your_dev_preview_kv_namespace_id/$KV_ID/g" wrangler.toml
    fi
    rm -f wrangler.toml.bak
fi

echo "🔐 Setting up secrets..."
echo "Setting APPWRITE_PROJECT_ID..."
echo "$APPWRITE_PROJECT_ID" | wrangler secret put APPWRITE_PROJECT_ID --env "$ENVIRONMENT"

echo "Setting APPWRITE_API_KEY..."
echo "$APPWRITE_API_KEY" | wrangler secret put APPWRITE_API_KEY --env "$ENVIRONMENT"

echo "✅ Setup completed for $ENVIRONMENT environment!"
echo "🚀 You can now run: npm run dev"