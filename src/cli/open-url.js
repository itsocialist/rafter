import { spawn } from 'child_process';

export function browserCommand(platform = process.platform) {
  if (platform === 'darwin') return { command: 'open', args: [] };
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', ''] };
  return { command: 'xdg-open', args: [] };
}

export function openUrl(url) {
  const opener = browserCommand();
  try {
    const child = spawn(opener.command, [...opener.args, url], { detached: true, stdio: 'ignore' });
    child.once('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
