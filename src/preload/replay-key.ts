// Key that saves the instant replay clip (the buffer itself runs in the main process, see recorder.ts).
import { ipcRenderer } from 'electron';
import { matchCombo, typingInField } from './hotkey';
import { clipContext } from './session-tracker';

let started = false;

export function initReplayKey(key: string): void {
  if (started || !key) return;
  started = true;
  window.addEventListener('keydown', (e) => {
    if (e.repeat || typingInField(e) || !matchCombo(e, key)) return;
    e.preventDefault();
    e.stopPropagation();
    void ipcRenderer.invoke('replay-save', clipContext());
  }, true);
}
