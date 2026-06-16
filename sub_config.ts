declare const require: any;
declare const process: any;

export const readLastDownloadedUrl = async () => {
  console.log('读取上次下载进度。');
  const fs = require('fs');
  const configPath = `${process.cwd()}/config.json`;

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const rawUrl = parsed?.lastDownloadedUrl;

    if (rawUrl == null) {
      return '';
    }

    if (typeof rawUrl !== 'string') {
      throw new Error('配置文件 config.json 中的 lastDownloadedUrl 无效');
    }

    const url = rawUrl.trim();
    if (!url) {
      return '';
    }

    if (!/^https:\/\/www\.icloud\.com\.cn\/photos\/#\//.test(url)) {
      throw new Error('配置文件 config.json 中的 lastDownloadedUrl 无效');
    }

    return url;
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return '';
    }

    throw error;
  }
};

export const readSavePath = () => {
  const fs = require('fs');
  const path = require('path');
  const scriptPath = process.argv[1]
    ? path.resolve(process.argv[1])
    : path.resolve(process.cwd(), 'icloud_webdownload.ts');
  const fallbackSavePath = path.join(path.dirname(scriptPath), 'download');

  try {
    const configPath = `${process.cwd()}/config.json`;
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const configuredSavePath = parsed?.savePath;

    if (typeof configuredSavePath === 'string' && configuredSavePath.trim()) {
      const resolvedSavePath = path.resolve(configuredSavePath.trim());
      fs.mkdirSync(resolvedSavePath, { recursive: true });
      return resolvedSavePath;
    }
  } catch {}

  fs.mkdirSync(fallbackSavePath, { recursive: true });
  return fallbackSavePath;
};

export const readDownloadTimeoutSeconds = () => {
  const fallbackTimeoutSeconds = 60;

  try {
    const fs = require('fs');
    const configPath = `${process.cwd()}/config.json`;
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const configuredTimeoutSeconds = parsed?.downloadTimeoutSeconds;

    if (
      typeof configuredTimeoutSeconds === 'number' &&
      Number.isFinite(configuredTimeoutSeconds) &&
      configuredTimeoutSeconds > 0
    ) {
      return configuredTimeoutSeconds;
    }
  } catch {}

  return fallbackTimeoutSeconds;
};

export const updateLastDownloadedUrl = (url: string) => {

  const fs = require('fs');
  const configPath = `${process.cwd()}/config.json`;
  let parsed: any = {};

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    parsed = JSON.parse(raw);
  } catch {}

  parsed.lastDownloadedUrl = url;
  fs.writeFileSync(configPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf-8');
  console.log(`已更新当前下载进度`);
};

