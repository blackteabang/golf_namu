import { kv } from '@vercel/kv';

export default async function handler(request, response) {
  const STORAGE_KEY_PLAYERS = 'golf_players';
  const STORAGE_KEY_HISTORY = 'golf_history';

  try {
    if (request.method === 'GET') {
      const players = await kv.get(STORAGE_KEY_PLAYERS) || [];
      const history = await kv.get(STORAGE_KEY_HISTORY) || [];
      return response.status(200).json({ players, history });
    } 
    
    if (request.method === 'POST') {
      const { players, history } = request.body;
      
      if (players) {
        await kv.set(STORAGE_KEY_PLAYERS, players);
      }
      
      if (history) {
        await kv.set(STORAGE_KEY_HISTORY, history);
      }
      
      return response.status(200).json({ message: 'Success' });
    }

    return response.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('KV Error:', error);
    return response.status(500).json({ error: 'Failed to sync with server' });
  }
}
