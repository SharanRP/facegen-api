# Avatar API Service

A fast, semantic avatar API service built on Cloudflare Workers that serves curated avatar images based on natural language descriptions. Think DiceBear, but with real images and intelligent search.

## 🎯 What This Project Does

The Avatar API Service allows users to get avatar images by simply describing what they want in natural language. Instead of using random seeds or complex parameters, users can request avatars like:

- `?description=professional` → Returns a professional business avatar
- `?description=doctor-smile` → Returns a friendly medical professional avatar  
- `?description=creative-designer` → Returns an artistic/creative avatar

The service uses **semantic search** to match user descriptions with a curated database of avatar images stored in Appwrite, then serves them globally via Cloudflare's edge network.

## 🌐 Live API

**Production URL:** `https://avatar-api-service.avatar-api.workers.dev`

### Quick Test
```html
<img src="https://avatar-api-service.avatar-api.workers.dev/avatar?description=professional" alt="Avatar" />
```

## 📡 API Endpoints

### `GET /avatar`
Returns an avatar image based on description.

**Parameters:**
- `description` (required): Natural language description of desired avatar

**Example:**
```
GET /avatar?description=professional-business
GET /avatar?description=doctor-healthcare  
GET /avatar?description=creative-designer
```

**Response:** PNG image (256x256 pixels)

### `GET /health`
Health check endpoint for monitoring.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": 1759520000000,
  "services": {
    "database": {"status": "healthy"},
    "storage": {"status": "healthy"}
  }
}
```

### `GET /metrics`
Performance and usage metrics.

**Response:**
```json
{
  "timestamp": 1759520000000,
  "metrics": {
    "requests_total": 1234,
    "cache_hit_rate": 0.85,
    "avg_response_time": 45
  }
}
```

## 🔧 Environment Variables

### Required (Appwrite Configuration)
```env
APPWRITE_PROJECT_ID=your_project_id
APPWRITE_ENDPOINT=https://nyc.cloud.appwrite.io/v1
APPWRITE_DATABASE_ID=your_database_id
APPWRITE_COLLECTION_ID=avatars
APPWRITE_BUCKET_ID=your_bucket_id
APPWRITE_API_KEY=your_api_key
```

### Optional (Performance Tuning)
```env
RATE_LIMIT_PER_MINUTE=100
RATE_LIMIT_PER_HOUR=1000
CACHE_TTL_SUCCESS=3600
CACHE_TTL_ERROR=300
CIRCUIT_BREAKER_THRESHOLD=5
CIRCUIT_BREAKER_TIMEOUT=30000
LOG_LEVEL=info
```

## 🚀 Quick Start

### 1. Clone and Install
```bash
git clone <your-repo>
cd avatar-api-service
npm install
```

### 2. Environment Setup
```bash
# Copy environment template
cp .env.example .env

# Edit .env with your Appwrite credentials
# Get these from: https://cloud.appwrite.io
```

### 3. Appwrite Setup
1. Create project in [Appwrite Cloud](https://cloud.appwrite.io)
2. Create database with collection named "avatars"
3. Create storage bucket for avatar images
4. Generate API key with Database:Read and Storage:Read permissions
5. Upload avatar images and create corresponding documents

### 4. Local Development
```bash
# Setup Cloudflare Workers and KV namespaces
npm run setup

# Start development server
npm run dev

# Test the API
curl http://localhost:8787/health
curl "http://localhost:8787/avatar?description=professional"
```

### 5. Deploy to Production
```bash
npm run deploy:production
```

## 🏗️ Architecture

- **Platform**: Cloudflare Workers (Edge Computing)
- **Database**: Appwrite (Document database for avatar metadata)
- **Storage**: Appwrite Storage (PNG image files)
- **Caching**: Cloudflare Edge Cache (Global CDN)
- **Rate Limiting**: Cloudflare KV (Distributed rate limiting)

## 🔍 How Search Works

1. **User Query**: `?description=professional-doctor`
2. **Keyword Extraction**: `["professional", "doctor"]`
3. **Database Search**: Searches `Tags` field in Appwrite collection
4. **Enhanced Ranking**: Uses semantic matching with synonyms
5. **Image Delivery**: Streams PNG image from Appwrite storage
6. **Edge Caching**: Cached globally for fast subsequent requests

## 📊 Database Schema

Your Appwrite collection should have these attributes:

| Field | Type | Size | Required | Description |
|-------|------|------|----------|-------------|
| `Description` | String | 500 | Yes | Human-readable description |
| `Tags` | String | 1000 | Yes | Comma-separated searchable keywords |
| `fileId` | String | 100 | Yes | Reference to image file in storage |
| `bucketId` | String | 100 | Yes | Storage bucket identifier |
| `width` | Integer | - | Yes | Image width in pixels |
| `height` | Integer | - | Yes | Image height in pixels |

**Indexes:**
- `tags_index` (Fulltext on `Tags`)
- `size_index` (Key on `width`, `height`)

## 🛠️ Development Commands

```bash
# Setup (first time only)
npm run setup

# Development
npm run dev

# Build and test
npm run build
npm run test

# Code quality
npm run lint
npm run format

# Deployment
npm run deploy              # Deploy to development
npm run deploy:staging      # Deploy to staging
npm run deploy:production   # Deploy to production
```

## 🔐 Security & Performance

- **Rate Limiting**: 100 requests/minute, 1000 requests/hour per IP
- **Input Validation**: Sanitizes all user input
- **CORS Enabled**: Cross-origin requests supported
- **Circuit Breaker**: Protects against backend failures
- **Edge Caching**: 1-hour cache for images, 5-minute cache for errors
- **Global CDN**: Served from 200+ Cloudflare locations worldwide

## 📈 Monitoring

- **Health Checks**: `/health` endpoint for uptime monitoring
- **Metrics**: `/metrics` endpoint for performance data
- **Correlation IDs**: Every request gets a unique tracking ID
- **Cloudflare Analytics**: Built-in request analytics and performance metrics

## 🌍 Deployment Environments

- **Development**: `http://localhost:8787` (local testing)
- **Staging**: `https://avatar-api-service-staging.avatar-api.workers.dev`
- **Production**: `https://avatar-api-service.avatar-api.workers.dev`

## 🎨 Usage Examples

### HTML
```html
<img src="https://avatar-api-service.avatar-api.workers.dev/avatar?description=professional" 
     alt="Professional Avatar" width="256" height="256" />
```

### React
```jsx
function Avatar({ userType }) {
  return (
    <img 
      src={`https://avatar-api-service.avatar-api.workers.dev/avatar?description=${userType}`}
      alt={`${userType} avatar`}
      width="256" 
      height="256"
    />
  );
}
```

### CSS
```css
.profile-pic {
  background-image: url('https://avatar-api-service.avatar-api.workers.dev/avatar?description=professional');
  width: 256px;
  height: 256px;
  border-radius: 50%;
}
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm test`
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

---

**Built with ❤️ using Cloudflare Workers, Appwrite, and TypeScript**