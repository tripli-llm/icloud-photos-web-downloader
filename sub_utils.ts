import type { Page } from 'playwright';
import { readSavePath } from './sub_config';
import { logError, warnError } from './sub_log';


declare const require: any;
declare const process: any;

export const ensureWindowsTarAvailable = () => {
  const { execFileSync } = require('child_process');

  try {
    execFileSync('tar', ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch {
    throw new Error('当前系统未检测到可用的 tar，请使用 Windows 10 或更高版本运行本项目。');
  }
};

export const readPhotoTimeText = async (page: Page) => {

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    for (const frame of [page.mainFrame(), ...page.frames()]) {
      const timeText = frame.locator('text=/\\d{4}年\\d{1,2}月\\d{1,2}日\\s+\\d{1,2}:\\d{2}/').first();
      if (await timeText.count()) {
        const txt = (await timeText.innerText()).trim();
        if (txt) return txt;
      }
    }
    await page.waitForTimeout(500);
  }

  return '';
};

export const readPhotoIndexText = async (page: Page) => {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    for (const frame of [page.mainFrame(), ...page.frames()]) {
      const indexText = frame.locator('text=/^\\d+\\s*\\/\\s*\\d+$/').first();
      if (await indexText.count()) {
        const txt = (await indexText.innerText()).trim();
        if (txt) {
          return txt.replace(/\s*\/\s*/g, ' / ');
        }
      }
    }
    await page.waitForTimeout(300);
  }

  return '';
};

export const detectFileExtensionByContent = (downloadPath: string) => {
  try {
    const fs = require('fs');
    const fd = fs.openSync(downloadPath, 'r');
    const header = new Uint8Array(64);
    const bytesRead = fs.readSync(fd, header, 0, header.length, 0);
    fs.closeSync(fd);

    const u8 = Array.from(header.slice(0, bytesRead));
    const at = (i: number) => (i < u8.length ? u8[i] : -1);
    const ascii = (start: number, end: number) => String.fromCharCode(...u8.slice(start, end));

    if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) {
      return 'jpg';
    }

    if (
      at(0) === 0x89 &&
      at(1) === 0x50 &&
      at(2) === 0x4e &&
      at(3) === 0x47 &&
      at(4) === 0x0d &&
      at(5) === 0x0a &&
      at(6) === 0x1a &&
      at(7) === 0x0a
    ) {
      return 'png';
    }

    if (ascii(0, 4) === 'GIF8') {
      return 'gif';
    }

    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
      return 'webp';
    }

    if (ascii(4, 8) === 'ftyp') {
      const brand = ascii(8, 12).toLowerCase();
      if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) {
        return 'heic';
      }
      if (brand === 'qt  ') {
        return 'mov';
      }
      if (brand === 'avif') {
        return 'avif';
      }
      return 'mp4';
    }

    if (at(0) === 0x25 && at(1) === 0x50 && at(2) === 0x44 && at(3) === 0x46) {
      return 'pdf';
    }

    return '';
  } catch {
    return '';
  }
};

const parsePhotoTimeToDate = (photoTime: string) => {
  const match = photoTime.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})$/);
  if (!match) {
    throw new Error(`无法解析页面顶部时间: ${photoTime}`);
  }

  const [, year, month, day, hour, minute] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), 0, 0);
};

export const setFileTimestampsFromPhotoTime = (filePathOrPaths: string | string[], photoTime: string) => {
  const filePaths = Array.isArray(filePathOrPaths) ? filePathOrPaths : [filePathOrPaths];

  filePaths.forEach((filePath) => {
    try {
      const fs = require('fs');
      const { execFileSync } = require('child_process');
      const targetDate = parsePhotoTimeToDate(photoTime);

      if (Number.isNaN(targetDate.getTime())) {
        throw new Error(`无效时间: ${photoTime}`);
      }

      fs.utimesSync(filePath, targetDate, targetDate);

      if (process.platform === 'win32') {
        execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            '$time = [DateTimeOffset]::FromUnixTimeMilliseconds([int64]$env:CB_TARGET_TIME_MS).LocalDateTime; $item = Get-Item -LiteralPath $env:CB_TARGET_FILE_PATH; $item.CreationTime = $time; $item.LastWriteTime = $time;',
          ],
          {
            stdio: 'ignore',
            env: {
              ...process.env,
              CB_TARGET_FILE_PATH: filePath,
              CB_TARGET_TIME_MS: String(targetDate.getTime()),
            },
          }
        );
      }
    } catch (error: any) {
      warnError(`设置文件创建时间和修改时间失败 (${filePath}): ${error?.message || error}`);
    }

  });
};

export const formatNowForFileName = () => {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(
    now.getMinutes()
  )}${pad(now.getSeconds())}`;
};

export const saveErrorScreenshot = async (page: Page, error: any, savePath?: string) => {
  const fs = require('fs');
  const path = require('path');
  const targetSavePath = savePath || readSavePath();
  const screenshotPath = path.join(targetSavePath, `_error_${formatNowForFileName()}.png`);

  try {
    fs.mkdirSync(targetSavePath, { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });
    logError(`发生异常，已保存当前页面截屏: ${screenshotPath}`);
  } catch (screenshotError: any) {
    logError(`发生异常，但页面截屏保存失败: ${screenshotError?.message || screenshotError}`);
  }

  logError(`异常信息: ${error?.message || error}`);

};

export const sanitizeFileName = (fileName: string) => {
  const normalized = fileName
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();

  return normalized || 'download';
};

// 生成“最终保存文件路径”：
// 1. 优先使用浏览器建议的文件名
// 2. 如果建议文件名没有扩展名，就根据临时下载文件内容推断扩展名
// 3. 如果目标目录已存在同名文件，就自动追加 _1、_2... 避免覆盖
export const buildSavedFilePath = (savePath: string, downloadPath: string, suggestedFileName: string) => {
  const fs = require('fs');
  const path = require('path');

  // 拆出“文件名主体 + 扩展名”，例如 photo.jpg -> { name: 'photo', ext: '.jpg' }
  const parsed = path.parse(suggestedFileName || 'download');

  // 清理 Windows 不允许出现在文件名中的字符，避免保存时报错
  const baseName = sanitizeFileName(parsed.name || 'download');

  // 有些下载临时文件没有扩展名，所以这里尝试从文件内容里识别真实类型
  const detectedExt = detectFileExtensionByContent(downloadPath);

  // 优先用浏览器给出的扩展名；如果它没给，再用我们识别出来的扩展名
  const finalExt = parsed.ext || (detectedExt ? `.${detectedExt}` : '');

  // 先拼出默认目标路径，例如 d:\iCloud_webdownload\photo.jpg
  let targetPath = path.join(savePath, `${baseName}${finalExt}`);

  // 如果已经有同名文件，就改成 photo_1.jpg、photo_2.jpg ...
  let i = 1;
  while (fs.existsSync(targetPath)) {
    targetPath = path.join(savePath, `${baseName}_${i}${finalExt}`);
    i += 1;
  }

  return targetPath;
};

const normalizeArchiveEntryPath = (entryPath: string) =>
  String(entryPath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');

const getICloudDirectoryFromEntry = (entryPath: string) => {
  const normalizedPath = normalizeArchiveEntryPath(entryPath);
  const segments = normalizedPath.split('/').filter(Boolean);
  const matchedIndex = segments.findIndex((segment) => segment.startsWith('iCloud'));

  if (matchedIndex === -1) {
    return '';
  }

  const matchedSegmentIsDirectory = normalizedPath.endsWith('/') || matchedIndex < segments.length - 1;
  if (!matchedSegmentIsDirectory) {
    return '';
  }

  return segments.slice(0, matchedIndex + 1).join('/');
};

const ensureDirectory = (dirPath: string) => {
  const fs = require('fs');
  fs.mkdirSync(dirPath, { recursive: true });
};

const allocateDirectoryPath = (basePath: string) => {
  const fs = require('fs');

  if (!fs.existsSync(basePath)) {
    return basePath;
  }

  let index = 2;
  while (true) {
    const candidatePath = `${basePath}_${index}`;
    if (!fs.existsSync(candidatePath)) {
      return candidatePath;
    }
    index += 1;
  }
};

const runTarList = (archivePath: string) => {
  const { execFileSync } = require('child_process');
  return execFileSync('tar', ['-tf', archivePath], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
};

const extractArchiveWithSystemTar = (archivePath: string, workingDirectory: string) => {
  const { execFileSync } = require('child_process');
  execFileSync('tar', ['-xf', archivePath], {
    cwd: workingDirectory,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
};

const walkFilesRecursively = (dirPath: string): string[] => {
  const fs = require('fs');
  const path = require('path');
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files: string[] = [];

  entries.forEach((entry: { name: string; isDirectory: () => boolean; isFile: () => boolean }) => {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFilesRecursively(fullPath));
      return;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  });

  return files;
};

const findICloudDirectoriesRecursively = (rootDir: string): string[] => {
  const fs = require('fs');
  const path = require('path');
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const matchedDirectories: string[] = [];

  entries.forEach((entry: { name: string; isDirectory: () => boolean }) => {
    if (!entry.isDirectory()) {
      return;
    }

    const fullPath = path.join(rootDir, entry.name);
    if (entry.name.startsWith('iCloud')) {
      matchedDirectories.push(fullPath);
      return;
    }

    matchedDirectories.push(...findICloudDirectoriesRecursively(fullPath));
  });

  return matchedDirectories;
};

const allocateFilePath = (targetFilePath: string) => {
  const fs = require('fs');
  const path = require('path');

  if (!fs.existsSync(targetFilePath)) {
    return targetFilePath;
  }

  const parsed = path.parse(targetFilePath);
  let index = 2;
  while (true) {
    const candidatePath = path.join(parsed.dir, `${parsed.name}_${index}${parsed.ext}`);
    if (!fs.existsSync(candidatePath)) {
      return candidatePath;
    }
    index += 1;
  }
};

const moveFileSafely = (sourcePath: string, targetPath: string) => {
  const fs = require('fs');
  const path = require('path');

  ensureDirectory(path.dirname(targetPath));
  const safeTargetPath = allocateFilePath(targetPath);

  try {
    fs.renameSync(sourcePath, safeTargetPath);
  } catch (error: any) {
    if (error?.code !== 'EXDEV') {
      throw error;
    }
    fs.copyFileSync(sourcePath, safeTargetPath);
    fs.unlinkSync(sourcePath);
  }

  return safeTargetPath;
};

const moveFilesOutOfICloudDirectories = (sourceDirectories: string[], targetDirectory: string) => {
  const path = require('path');
  const movedFiles: string[] = [];

  sourceDirectories.forEach((sourceDirectory) => {
    const files = walkFilesRecursively(sourceDirectory);

    files.forEach((filePath) => {
      const relativePath = path.relative(sourceDirectory, filePath);
      const destinationPath = path.join(targetDirectory, relativePath);
      const finalPath = moveFileSafely(filePath, destinationPath);
      movedFiles.push(finalPath);
    });
  });

  return movedFiles;
};

/**
 * 先用系统 tar -tf 检查压缩包内是否存在 iCloud 开头的目录，
 * 再用 tar -xf 全量解压到临时目录，最后把这些目录中的文件移动到保存目录。
 * 返回最终移动出来的文件路径列表。
 */
export const extractICloudPhotosDirectoryFromZip = async (zipFilePath: string, savePath: string): Promise<string[]> => {
  try {
    const fs = require('fs');
    const path = require('path');

    if (!fs.existsSync(zipFilePath)) {
      warnError(`[zip-extract] 压缩包不存在，跳过解压: ${zipFilePath}`);
      return [];
    }


    const archivePath = path.resolve(zipFilePath);
    const targetDirectory = path.resolve(savePath || path.dirname(archivePath));
    const archiveDir = path.dirname(archivePath);
    const archiveName = path.parse(archivePath).name;
    const tempExtractDir = allocateDirectoryPath(path.join(archiveDir, `${archiveName}_temp_extract`));

    const stdout = runTarList(archivePath);
    const entries = String(stdout || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const matchedDirectorySet = new Set<string>();
    entries.forEach((entryPath: string) => {
      const matchedDirectory = getICloudDirectoryFromEntry(entryPath);
      if (!matchedDirectory) {
        return;
      }
      matchedDirectorySet.add(matchedDirectory);
    });

    if (!matchedDirectorySet.size) {
      return [];
    }

    ensureDirectory(tempExtractDir);
    ensureDirectory(targetDirectory);

    try {
      extractArchiveWithSystemTar(archivePath, tempExtractDir);

      const existingICloudDirectories = findICloudDirectoriesRecursively(tempExtractDir);
      if (!existingICloudDirectories.length) {
        warnError('[zip-extract] tar -xf 已完成，但未在解压结果中扫描到 iCloud 目录。');
        warnError('[zip-extract] 这通常表示 tar -tf 输出编码与磁盘实际目录名不一致，或压缩包结构和预期不同。');
        return [];
      }


      return moveFilesOutOfICloudDirectories(existingICloudDirectories, targetDirectory);
    } finally {
      fs.rmSync(tempExtractDir, { recursive: true, force: true });
    }
  } catch (error: any) {
    warnError(`[zip-extract] 自动解压压缩包中的 iCloud 目录失败: ${error?.message || error}`);

    if (typeof error?.stdout === 'string' && error.stdout.trim()) {
      warnError('[zip-extract] stdout:');
      warnError(error.stdout.trim());
    }

    if (typeof error?.stderr === 'string' && error.stderr.trim()) {
      warnError('[zip-extract] stderr:');
      warnError(error.stderr.trim());
    }


    return [];
  }
};

