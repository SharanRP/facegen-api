#!/usr/bin/env node

const { Client, Databases, Query } = require('node-appwrite');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

class VectorSetup {
  constructor() {
    this.appwrite = {
      client: new Client()
        .setEndpoint(process.env.APPWRITE_ENDPOINT)
        .setProject(process.env.APPWRITE_PROJECT_ID)
        .setKey(process.env.APPWRITE_API_KEY),
      databaseId: process.env.APPWRITE_DATABASE_ID,
      collectionId: process.env.APPWRITE_COLLECTION_ID
    };
    
    this.databases = new Databases(this.appwrite.client);

    this.ollama = {
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      model: process.env.OLLAMA_MODEL || 'mxbai-embed-large:latest'
    };

    this.vectorize = {
      indexName: process.env.VECTORIZE_INDEX_NAME || 'avatar-embeddings',
      dimensions: this.getModelDimensions(this.ollama.model),
      batchSize: parseInt(process.env.BATCH_SIZE) || 50
    };

    this.config = {
      maxRetries: 3,
      requestDelay: 50
    };

    this.stats = {
      total: 0,
      processed: 0,
      skipped: 0,
      errors: 0,
      startTime: Date.now(),
      vectorizeIndexCreated: false
    };

    console.log('Vector Setup Initialized');
    console.log(`Model: ${this.ollama.model}`);
    console.log(`Dimensions: ${this.vectorize.dimensions}`);
    console.log(`Ollama URL: ${this.ollama.baseUrl}`);
    console.log(`Vectorize Index: ${this.vectorize.indexName}`);
    console.log(`Batch Size: ${this.vectorize.batchSize}\n`);
  }

  getModelDimensions(model) {
    const dimensions = {
      'nomic-embed-text': 768,
      'mxbai-embed-large': 1024,
      'mxbai-embed-large:latest': 1024,
      'all-minilm': 384,
      'bge-small': 384,
      'bge-base': 768,
      'bge-large': 1024
    };
    
    const baseModel = model.replace(':latest', '');
    return dimensions[model] || dimensions[baseModel] || 768;
  }

  async checkStatus() {
    console.log('Checking system status...');

    try {
      const response = await fetch(`${this.ollama.baseUrl}/api/tags`);
      
      if (!response.ok) {
        throw new Error(`Ollama not running. Start with: ollama serve`);
      }

      const data = await response.json();
      const models = data.models.map(m => m.name);
      
      console.log(`Ollama is running`);
      console.log(`Available models: ${models.join(', ')}`);

      const modelExists = models.some(model => 
        model === this.ollama.model || 
        model === `${this.ollama.model}:latest` ||
        model.startsWith(this.ollama.model.replace(':latest', ''))
      );

      if (!modelExists) {
        console.log(`Model '${this.ollama.model}' not found`);
        console.log(`Available models: ${models.join(', ')}`);
        console.log(`Run: ollama pull ${this.ollama.model.replace(':latest', '')}`);
        throw new Error(`Model ${this.ollama.model} not available`);
      }

      console.log(`Model '${this.ollama.model}' is ready\n`);

      const avatarsResponse = await this.databases.listDocuments(
        this.appwrite.databaseId,
        this.appwrite.collectionId,
        [Query.limit(1)]
      );
      const totalAvatars = avatarsResponse.total;
      console.log(`Appwrite: ${totalAvatars.toLocaleString()} avatars found`);

      const { execSync } = require('child_process');
      try {
        const listOutput = execSync('wrangler vectorize list', { encoding: 'utf8', stdio: 'pipe' });
        if (listOutput.includes(this.vectorize.indexName)) {
          console.log(`Vectorize index '${this.vectorize.indexName}' exists`);
          
          try {
            const infoOutput = execSync(`wrangler vectorize info ${this.vectorize.indexName}`, { encoding: 'utf8' });
            const vectorCountMatch = infoOutput.match(/vectorCount\s*│\s*(\d+)/i);
            const vectorCount = vectorCountMatch ? parseInt(vectorCountMatch[1]) : 0;
            console.log(`Vectors stored: ${vectorCount.toLocaleString()}`);
            
            if (vectorCount >= totalAvatars) {
              console.log('All avatars already have vectors. Use --force to regenerate.');
              return false;
            }
          } catch (error) {
            console.log('Index exists but couldn\'t get vector count');
          }
        } else {
          console.log(`Vectorize index '${this.vectorize.indexName}' not found`);
        }
      } catch (error) {
        console.log('Wrangler CLI not found or error checking Vectorize');
      }

      return true;

    } catch (error) {
      console.error('Status check failed:', error.message);
      console.log('\nTroubleshooting:');
      console.log('1. Install Ollama: https://ollama.ai');
      console.log('2. Start Ollama: ollama serve');
      console.log(`3. Pull model: ollama pull ${this.ollama.model.replace(':latest', '')}`);
      throw error;
    }
  }

  async generateEmbedding(text) {
    let retries = 0;
    
    while (retries < this.config.maxRetries) {
      try {
        const response = await fetch(`${this.ollama.baseUrl}/api/embeddings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: this.ollama.model,
            prompt: text.trim()
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Ollama API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        return data.embedding;

      } catch (error) {
        retries++;
        if (retries >= this.config.maxRetries) {
          throw new Error(`Failed after ${this.config.maxRetries} retries: ${error.message}`);
        }
        
        console.log(`Retry ${retries}/${this.config.maxRetries}: ${error.message}`);
        await this.sleep(1000 * retries);
      }
    }
  }

  async createVectorizeIndex() {
    try {
      console.log('Creating Cloudflare Vectorize index...');

      const { execSync } = require('child_process');
      
      try {
        execSync('wrangler --version', { stdio: 'ignore' });
      } catch (error) {
        throw new Error('Wrangler CLI not found. Please install: npm install -g wrangler');
      }

      try {
        const listOutput = execSync('wrangler vectorize list', { encoding: 'utf8', stdio: 'pipe' });
        if (listOutput.includes(this.vectorize.indexName)) {
          console.log('Vectorize index already exists');
          this.stats.vectorizeIndexCreated = true;
          return;
        }
      } catch (error) {
        // Continue to create
      }

      const createCommand = `wrangler vectorize create ${this.vectorize.indexName} --dimensions=${this.vectorize.dimensions} --metric=cosine`;
      
      console.log(`Creating index with ${this.vectorize.dimensions} dimensions...`);
      const output = execSync(createCommand, { encoding: 'utf8', stdio: 'pipe' });
      
      console.log('Vectorize index created successfully');
      this.stats.vectorizeIndexCreated = true;

      await this.updateWranglerConfig();

    } catch (error) {
      console.error('Error creating Vectorize index:', error.message);
      throw error;
    }
  }

  async updateWranglerConfig() {
    try {
      console.log('Updating wrangler.toml configuration...');

      const wranglerPath = path.join(process.cwd(), 'wrangler.toml');
      let wranglerContent = await fs.readFile(wranglerPath, 'utf8');

      if (wranglerContent.includes('[[vectorize]]')) {
        console.log('Vectorize binding already configured');
        return;
      }

      const vectorizeBinding = `
[[vectorize]]
binding = "VECTORIZE"
index_name = "${this.vectorize.indexName}"

`;

      const envIndex = wranglerContent.indexOf('[env.');
      if (envIndex !== -1) {
        wranglerContent = wranglerContent.slice(0, envIndex) + vectorizeBinding + wranglerContent.slice(envIndex);
      } else {
        wranglerContent += vectorizeBinding;
      }

      await fs.writeFile(wranglerPath, wranglerContent);
      console.log('wrangler.toml updated with Vectorize configuration');

    } catch (error) {
      console.error('Error updating wrangler.toml:', error.message);
      throw error;
    }
  }

  async getAllAvatars() {
    const allAvatars = [];
    let offset = 0;
    const limit = 100;

    console.log('Fetching all avatars from Appwrite...');

    while (true) {
      try {
        const response = await this.databases.listDocuments(
          this.appwrite.databaseId,
          this.appwrite.collectionId,
          [
            Query.limit(limit),
            Query.offset(offset)
          ]
        );

        if (response.documents.length === 0) break;

        allAvatars.push(...response.documents);
        offset += limit;

        console.log(`Fetched ${allAvatars.length} avatars...`);
        await this.sleep(50);

      } catch (error) {
        console.error('Error fetching avatars:', error.message);
        throw error;
      }
    }

    console.log(`Total avatars: ${allAvatars.length}`);
    return allAvatars;
  }

  async processAvatarsToVectorize(avatars) {
    console.log(`\nProcessing ${avatars.length} avatars to Vectorize...\n`);

    for (let i = 0; i < avatars.length; i += this.vectorize.batchSize) {
      const batch = avatars.slice(i, i + this.vectorize.batchSize);
      
      console.log(`Processing batch ${Math.floor(i / this.vectorize.batchSize) + 1}/${Math.ceil(avatars.length / this.vectorize.batchSize)}`);

      await this.processBatch(batch);

      if ((i + this.vectorize.batchSize) % 200 === 0) {
        this.printProgress();
      }

      await this.sleep(this.config.requestDelay);
    }
  }

  async processBatch(batch) {
    const vectors = [];

    for (const avatar of batch) {
      try {
        const description = avatar.Description || '';
        const tags = avatar.Tags || '';
        const combinedText = `${description} ${tags}`.trim();

        if (!combinedText) {
          console.log(`Skipping ${avatar.$id} - no content`);
          this.stats.skipped++;
          continue;
        }

        console.log(`Processing ${avatar.$id}: "${combinedText.substring(0, 50)}..."`);

        const embedding = await this.generateEmbedding(combinedText);

        vectors.push({
          id: avatar.$id,
          values: embedding,
          metadata: {
            description: description,
            tags: tags,
            fileId: avatar.fileId,
            bucketId: avatar.bucketId,
            width: avatar.width,
            height: avatar.height,
            text: combinedText
          }
        });

        this.stats.processed++;
        console.log(`Prepared ${avatar.$id} for Vectorize`);

        await this.sleep(this.config.requestDelay);

      } catch (error) {
        console.error(`Error processing ${avatar.$id}:`, error.message);
        this.stats.errors++;
      }
    }

    if (vectors.length > 0) {
      await this.storeVectorsInVectorize(vectors);
    }
  }

  async storeVectorsInVectorize(vectors) {
    try {
      console.log(`Storing ${vectors.length} vectors in Vectorize...`);

      const tempFile = path.join(process.cwd(), 'temp-vectors.ndjson');
      const ndjsonContent = vectors.map(vector => JSON.stringify(vector)).join('\n');
      await fs.writeFile(tempFile, ndjsonContent);

      const { execSync } = require('child_process');
      const insertCommand = `wrangler vectorize insert ${this.vectorize.indexName} --file=${tempFile}`;
      
      execSync(insertCommand, { stdio: 'inherit' });

      await fs.unlink(tempFile);

      console.log(`Successfully stored ${vectors.length} vectors in Vectorize`);

    } catch (error) {
      console.error('Error storing vectors in Vectorize:', error.message);
      throw error;
    }
  }

  async run() {
    console.log('Starting Vector Search Setup...\n');

    try {
      const shouldContinue = await this.checkStatus();
      if (!shouldContinue && !process.argv.includes('--force')) {
        return;
      }

      await this.createVectorizeIndex();

      const avatars = await this.getAllAvatars();
      this.stats.total = avatars.length;

      if (avatars.length === 0) {
        console.log('No avatars found in database');
        return;
      }

      await this.processAvatarsToVectorize(avatars);

      this.printFinalStats();

      this.printNextSteps();

    } catch (error) {
      console.error('Setup failed:', error.message);
      process.exit(1);
    }
  }

  printProgress() {
    const elapsed = (Date.now() - this.stats.startTime) / 1000;
    const rate = this.stats.processed / elapsed;
    const remaining = this.stats.total - this.stats.processed - this.stats.skipped;
    const eta = remaining / rate;

    console.log(`\nProgress Update:`);
    console.log(`   Processed: ${this.stats.processed}/${this.stats.total}`);
    console.log(`   Skipped: ${this.stats.skipped}`);
    console.log(`   Errors: ${this.stats.errors}`);
    console.log(`   Rate: ${rate.toFixed(1)} avatars/sec`);
    console.log(`   ETA: ${Math.ceil(eta / 60)} minutes\n`);
  }

  printFinalStats() {
    const elapsed = (Date.now() - this.stats.startTime) / 1000;
    
    console.log(`\nVector Search Setup Completed!\n`);
    console.log(`Final Statistics:`);
    console.log(`   Total avatars: ${this.stats.total}`);
    console.log(`   Successfully processed: ${this.stats.processed}`);
    console.log(`   Skipped: ${this.stats.skipped}`);
    console.log(`   Errors: ${this.stats.errors}`);
    console.log(`   Total time: ${Math.ceil(elapsed / 60)} minutes`);
    console.log(`   Success rate: ${((this.stats.processed / this.stats.total) * 100).toFixed(1)}%`);
    console.log(`   Cost: $0.00 (FREE with Ollama!)`);
  }

  printNextSteps() {
    console.log(`\nNext Steps:`);
    console.log(`1. Deploy your updated worker: npm run deploy`);
    console.log(`2. Test vector search: curl "https://your-worker.workers.dev/avatar?description=professional%20woman"`);
    console.log(`3. Keep Ollama running for future embedding generation`);
    console.log(`\nYou now have FREE world-class semantic search!`);
    console.log(`Features unlocked:`);
    console.log(`   • Lightning-fast local embeddings`);
    console.log(`   • No API costs or rate limits`);
    console.log(`   • Privacy-first (all processing local)`);
    console.log(`   • Scalable to millions of vectors`);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

if (require.main === module) {
  const setup = new VectorSetup();
  setup.run().catch(error => {
    console.error('Script failed:', error);
    process.exit(1);
  });
}

module.exports = VectorSetup;