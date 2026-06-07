import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { SQLiteProvider } from '../providers/sqlite.js';

function generateApiKey(): string {
  return 'memcp-' + crypto.randomBytes(24).toString('hex');
}

const program = new Command();

async function getClaudeConfigPath() {
  const home = os.homedir();
  // macOS path
  return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
}

program
  .name('memcp-cli')
  .description('CLI for MemCP cross-agent communication server')
  .version('1.0.0');

program
  .command('config')
  .description('Configure MemCP embeddings')
  .option('--provider <provider>', 'Embedding provider (local, openai)', 'local')
  .option('--key <key>', 'API key for openai provider')
  .option('--url <url>', 'Base URL for openai provider', 'https://api.openai.com/v1/embeddings')
  .option('--model <model>', 'Model name', 'text-embedding-3-small')
  .action(async (options) => {
    const envContent = [
      `MEMCP_EMBEDDING_PROVIDER=${options.provider}`,
      `MEMCP_EMBEDDING_KEY=${options.key || ''}`,
      `MEMCP_EMBEDDING_URL=${options.url}`,
      `MEMCP_EMBEDDING_MODEL=${options.model}`,
    ].join('\n');
    
    await fs.writeFile(path.join(process.cwd(), '.env'), envContent);
    console.log('Configuration saved to .env');
  });

program
  .command('install')
  .description('Install MemCP server to Claude Desktop')
  .action(async () => {
    try {
      const configPath = await getClaudeConfigPath();
      let config: any = {};
      
      try {
        const content = await fs.readFile(configPath, 'utf8');
        config = JSON.parse(content);
      } catch (e) {
        console.log('Creating new config file...');
      }

      if (!config.mcpServers) config.mcpServers = {};
      
      const serverPath = path.join(process.cwd(), 'dist/mcp/server.js');
      
      config.mcpServers.memcp = {
        command: 'node',
        args: [serverPath],
      };

      await fs.writeFile(configPath, JSON.stringify(config, null, 2));
      console.log(`Successfully installed MemCP to ${configPath}`);
      console.log(`Server path: ${serverPath}`);
      console.log('Please restart Claude Desktop.');
    } catch (error: any) {
      console.error(`Installation failed: ${error.message}`);
    }
  });

program
  .command('generate-api-key')
  .description('Generate a new API key for server authentication')
  .option('-s, --set <key>', 'Use a specific key instead of generating one')
  .option('--no-env', 'Do not write to .env file (just print)')
  .action(async (options) => {
    const apiKey = options.set || generateApiKey();
    
    if (!options.noEnv) {
      const envPath = path.join(process.cwd(), '.env');
      let envContent = '';
      try {
        envContent = await fs.readFile(envPath, 'utf8');
      } catch (e) {}
      
      // Update or add MEMCP_API_KEY
      const lines = envContent.split('\n').filter(l => !l.startsWith('MEMCP_API_KEY='));
      lines.push(`MEMCP_API_KEY=${apiKey}`);
      await fs.writeFile(envPath, lines.join('\n'));
      console.log(`API key written to ${envPath}`);
    }

    console.log(`\nAPI Key: ${apiKey}`);
    console.log('\nTo use this key, include it in requests:');
    console.log('  X-API-Key: ' + apiKey);
    console.log('  Authorization: Bearer ' + apiKey);
    console.log('\nTo set a new key later, run:');
    console.log('  npm run cli generate-api-key');
    console.log('  Or set MEMCP_API_KEY in your .env file and restart the server.');
  });

program
  .command('monitor')
  .description('Monitor stored conversations')
  .option('-q, --query <query>', 'Search for specific conversations')
  .action(async (options) => {
    const storage = new SQLiteProvider();
    const query = options.query || '';
    const results = await storage.searchConversations(query);
    
    console.log(`Found ${results.length} conversations:`);
    results.forEach(c => {
      console.log(`- [${c.id}] ${c.projectId} | ${c.agentId} | Summary: ${c.summary || 'N/A'}`);
    });
  });

program
  .command('list-messages')
  .description('List messages for a conversation')
  .argument('<conversationId>', 'ID of the conversation')
  .action(async (id) => {
    const storage = new SQLiteProvider();
    const messages = await storage.getConversationMessages(id);
    
    messages.forEach(m => {
      console.log(`[${m.timestamp.toISOString()}] ${m.role}: ${m.content}`);
    });
  });

program.parse();
