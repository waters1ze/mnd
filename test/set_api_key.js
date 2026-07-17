// test/set_api_key.js
// Saves the user's Groq API key to the secrets store
import { getSecretsStore } from '../dist/core/secrets.js';

async function main() {
  const store = await getSecretsStore();
  const apiKey = 'YOUR_GROQ_API_KEY_HERE';
  await store.set('groq_api_key', apiKey);
  console.log('Successfully saved Groq API key to secrets store.');
}

main().catch(console.error);
