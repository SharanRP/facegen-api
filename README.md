# Avatar API Service

A Cloudflare Worker API service for serving avatar images with Appwrite backend integration.

## Features

- Global edge distribution via Cloudflare Workers
- Intelligent caching with configurable TTL
- Rate limiting with sliding window algorithm
- Full-text search on avatar descriptions and tags
- Image streaming without buffering
- Comprehensive error handling and monitoring

## Development

### Prerequisites

- Node.js 18+
- Cloudflare account with Workers enabled
- Appwrite instance with avatar database

### Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables in `wrangler.toml`

3. Set secrets:
   ```bash
   wrangler secret put APPWRITE_PROJECT_ID
   wrangler secret put APPWRITE_API_KEY
   ```

4. Start development server:
   ```bash
   npm run dev
   ```

### Deployment

```bash
# Deploy to development
npm run deploy

# Deploy to production
npm run deploy:production
```

## API Usage

```
GET /avatar?description={text}&scale={size}&format={type}
```

### Parameters

- `description`: Avatar description (1-200 characters)
- `scale`: Image size (128, 256, or 512)
- `format`: Image format (webp or png, default: webp)

### Response

Returns binary image data with appropriate headers:
- `Content-Type`: image/webp or image/png
- `Cache-Control`: public, max-age=3600
- `X-Avatar-Id`: Avatar document ID
- `X-RateLimit-Remaining`: Remaining requests
- `X-RateLimit-Reset`: Rate limit reset time

## License

MIT