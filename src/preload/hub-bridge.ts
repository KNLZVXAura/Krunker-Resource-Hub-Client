// Preload of the KRH website window (the hub). It gives the website one small door into the client:
// window.krhClientBridge.call(action, payload). The main process checks who is calling and what is asked
// (see site-bridge.ts), so the page can only do the fixed list of "use this post" actions.
import { contextBridge, ipcRenderer } from 'electron';

const ACTIONS = new Set(['info', 'use-css', 'use-script', 'weekly-stats', 'use-bundle', 'ping-stats']);

contextBridge.exposeInMainWorld('krhClientBridge', {
  call: (action: string, payload?: unknown): Promise<unknown> => {
    if (typeof action !== 'string' || !ACTIONS.has(action)) return Promise.reject(new Error('blocked action'));
    // Only plain data goes through (strings, numbers, booleans, simple objects)
    const clean = ((): unknown => { try { return JSON.parse(JSON.stringify(payload ?? {})); } catch { return {}; } })();
    return ipcRenderer.invoke('bridge:call', action, clean);
  },
});
