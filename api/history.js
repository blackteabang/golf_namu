import { kv } from '@vercel/kv';

export default async function handler(request, response) {
  const STORAGE_KEY_PLAYERS = 'golf_players';
  const STORAGE_KEY_HISTORY = 'golf_history';
  const STORAGE_KEY_ROOMS = 'golf_rooms';

  try {
    if (request.method === 'GET') {
      const players = await kv.get(STORAGE_KEY_PLAYERS) || [];
      const history = await kv.get(STORAGE_KEY_HISTORY) || [];
      const rooms = await kv.get(STORAGE_KEY_ROOMS) || [];
      return response.status(200).json({ players, history, rooms });
    } 
    
    if (request.method === 'POST') {
      const { players, history, rooms } = request.body;
      
      if (players) {
        await kv.set(STORAGE_KEY_PLAYERS, players);
      }
      
      if (history) {
        await kv.set(STORAGE_KEY_HISTORY, history.slice(0, 100));
      }

      if (rooms) {
        await kv.set(STORAGE_KEY_ROOMS, rooms);
      }
      
      return response.status(200).json({ message: 'Success' });
    }

    return response.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('KV Error:', error);
    return response.status(500).json({ error: 'Failed to sync with server' });
  }
}
