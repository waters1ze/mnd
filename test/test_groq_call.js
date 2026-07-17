// test/test_groq_call.js
import { groqChat } from '../dist/core/groqClient.js';

async function main() {
  console.log("Sending chat request to Groq API...");
  const reply = await groqChat([
    { role: 'user', content: 'Say hello and tell me you are ready!' }
  ], 'test-connection');
  console.log("Groq Reply:", reply);
}

main().catch(console.error);
