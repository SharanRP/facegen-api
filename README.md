# Avatar API Service

A Cloudflare Worker API service for serving avatar images with Appwrite backend integration.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Cloudflare account (free tier works)
- Appwrite Cloud account or self-hosted instance

### 1. Clone and Install
```bash
git clone <your-repo>
cd avatar-api-service
npm install
```

### 2. Environment Setup
```bash
# Copy the environment template
cp .env.example .env

# Copy the wrangler template
cp wrangler.toml.template wrangler.toml

# Edit .env with your Appwrite credentials
# Edit wrangler.toml with your configuration
```

### 3. Appwrite Setup
1. Create project in [Appwrite Cloud](https://cloud.appwrite.io)
2. Create database and collection with required schema
3. Create storage bucket for avatar images
4. Generate API key with Database:Read and Storage:Read permissions
5. Upload some avatar images to the storage bucket

### 4. Seed Test Data
```bash
# Add sample avatar documents to your database
npm run seed
```

### 5. Setup Cloudflare
```bash
# Setup KV namespaces and secrets
npm run setup
```

### 6. Development
```bash
# Start local development server
npm run dev

# Test the API
curl "http://localhost:8787/health"
curl "http://localhost:8787/avatar?description=professional"
```

### 7. Deploy
```bash
# Deploy to development
npm run deploy

# Deploy to production
npm run deploy:production
```

## 📡 API Endpoints

### Avatar Search
```
GET /avatar?description=<search_terms>&scale=<size>&format=<format>
```

**Parameters:**
- `description` (required): Search terms for avatar (e.g., "professional business")
- `scale` (optional): Image size - 128, 256, or 512 pixels (default: 256)
- `format` (optional): Image format - webp or png (default: webp)

**Examples:**
```bash
# Basic search
curl "http://localhost:8787/avatar?description=professional"

# With specific size and format
curl "http://localhost:8787/avatar?description=doctor-smile&scale=512&format=png"
```

### Health Check
```
GET /health
```

### Metrics
```
GET /metrics
```

## 🔧 Configuration

### Environment Variables (.env)
```env
APPWRITE_PROJECT_ID=your_project_id
APPWRITE_ENDPOINT=https://nyc.cloud.appwrite.io/v1
APPWRITE_DATABASE_ID=your_database_id
APPWRITE_COLLECTION_ID=avatars
APPWRITE_BUCKET_ID=your_bucket_id
APPWRITE_API_KEY=your_api_key

# Optional settings
RATE_LIMIT_PER_MINUTE=100
RATE_LIMIT_PER_HOUR=1000
CACHE_TTL_SUCCESS=3600
CACHE_TTL_ERROR=300
CIRCUIT_BREAKER_THRESHOLD=5
CIRCUIT_BREAKER_TIMEOUT=30000
LOG_LEVEL=info
```

### Appwrite Collection Schema
Your collection should have these attributes:
- `description` (String, 500 chars, required)
- `tags` (String, 1000 chars, required)
- `fileId` (String, 100 chars, required)
- `bucketId` (String, 100 chars, required)
- `width` (Integer, required)
- `height` (Integer, required)

### Indexes
- `tags_index` (Fulltext on `tags`)
- `size_index` (Key on `width`, `height`)

## 🔒 Security

### For GitHub
- `.env` files are gitignored
- `wrangler.toml` is gitignored (contains your IDs)
- Use `wrangler.toml.template` for sharing configuration structure
- Secrets are stored in Cloudflare Workers, not in code

### API Security
- Rate limiting (100 req/min, 1000 req/hour by default)
- CORS enabled for cross-origin requests
- Input validation and sanitization
- Circuit breaker for external service failures

## 🚀 Deployment Environments

- **Development**: `npm run deploy` or `npm run deploy:dev`
- **Staging**: `npm run deploy:staging`
- **Production**: `npm run deploy:production`

## 📊 Monitoring

- Health checks at `/health`
- Metrics at `/metrics`
- Request correlation IDs for tracing
- Performance timing for all operations
- Circuit breaker status monitoring

## 🛠️ Development

### Run Tests
```bash
npm test
```

### Lint Code
```bash
npm run lint
```

### Format Code
```bash
npm run format
```

### Local Development
```bash
npm run dev
```

## 📝 Example Avatar Document

```json
{
  "description": "Professional business avatar with suit",
  "tags": "professional, business, formal, suit, corporate, headshot",
  "fileId": "64f8a1b2c3d4e5f6g7h8i9j0",
  "bucketId": "avatar-images",
  "width": 256,
  "height": 256
}
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if needed
5. Run `npm test` and `npm run lint`
6. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details