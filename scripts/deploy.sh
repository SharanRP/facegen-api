#!/bin/bash
set -e

ENVIRONMENT=${1:-development}

echo "🚀 Deploying Avatar API Service to $ENVIRONMENT..."

if [ ! -f ".env" ]; then
    echo "❌ .env file not found"
    exit 1
fi

echo "🔨 Building project..."
npm run build

echo "🧪 Running tests..."
npm run test

echo "📦 Deploying to $ENVIRONMENT..."
wrangler deploy --env "$ENVIRONMENT"

echo "✅ Deployment completed!"
echo "🌐 Test your deployment:"
echo "curl https://your-worker-url.workers.dev/health"