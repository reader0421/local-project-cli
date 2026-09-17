// 对用户选定的黑色图标只做 RGB 反色，逐像素保留透明通道。
import { app, BrowserWindow } from 'electron';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const temporary = mkdtempSync(join(tmpdir(), 'localproject-tray-export-'));
app.setPath('userData', temporary);

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } });
  try {
    const image = readFileSync(join(root, 'resources/TraySource.png'));
    const source = `data:image/png;base64,${image.toString('base64')}`;
    await window.loadURL('data:text/html,<html><body></body></html>');
    const png = await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < pixels.data.length; i += 4) {
          pixels.data[i] = 255 - pixels.data[i];
          pixels.data[i + 1] = 255 - pixels.data[i + 1];
          pixels.data[i + 2] = 255 - pixels.data[i + 2];
        }
        context.putImageData(pixels, 0, 0);
        resolve(canvas.toDataURL('image/png').split(',')[1]);
      };
      image.onerror = reject;
      image.src = ${JSON.stringify(source)};
    })`);
    const destination = join(root, 'resources/TrayTemplate.png');
    writeFileSync(destination, Buffer.from(png, 'base64'));
    console.log(`Created ${destination}`);
  } finally {
    window.destroy();
    rmSync(temporary, { recursive: true, force: true });
  }
  app.exit(0);
}).catch((error) => { console.error(error); app.exit(1); });
