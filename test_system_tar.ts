export {};

import { logError, warnError } from './sub_log';
import { ensureWindowsTarAvailable } from './sub_utils';


declare const require: any;
declare const process: any;

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const archivePathArg = process.argv[2];
const MATCH_PREFIX = 'iCloud';

if (process.platform !== 'win32') {
  logError(`当前脚本仅支持 Windows 运行，当前平台: ${process.platform}`);
  process.exit(1);
}

try {
  ensureWindowsTarAvailable();
} catch (error: any) {
  logError(error?.message || error);
  process.exit(1);
}

const normalizeArchiveEntryPath = (entryPath: string) =>

  String(entryPath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');




const getICloudDirectoryFromEntry = (entryPath: string) => {
  const normalizedPath = normalizeArchiveEntryPath(entryPath);
  const segments = normalizedPath.split('/').filter(Boolean);
  const matchedIndex = segments.findIndex((segment) => segment.startsWith(MATCH_PREFIX));

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
  fs.mkdirSync(dirPath, { recursive: true });
};

const allocateDirectoryPath = (basePath: string) => {
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

const runTarList = (archivePath: string) =>
  execFileSync('tar', ['-tf', archivePath], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

const extractArchiveWithSystemTar = (archivePath: string, workingDirectory: string) => {
  execFileSync('tar', ['-xf', archivePath], {
    cwd: workingDirectory,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
};

const walkFilesRecursively = (dirPath: string): string[] => {
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
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const matchedDirectories: string[] = [];

  entries.forEach((entry: { name: string; isDirectory: () => boolean }) => {
    if (!entry.isDirectory()) {
      return;
    }

    const fullPath = path.join(rootDir, entry.name);
    if (entry.name.startsWith(MATCH_PREFIX)) {
      matchedDirectories.push(fullPath);
      return;
    }

    matchedDirectories.push(...findICloudDirectoriesRecursively(fullPath));
  });

  return matchedDirectories;
};

const allocateFilePath = (targetFilePath: string) => {
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
  let movedFiles = 0;

  sourceDirectories.forEach((sourceDirectory) => {
    const files = walkFilesRecursively(sourceDirectory);
    console.log(`[system tar test] 发现 iCloud 目录: ${sourceDirectory}`);
    console.log(`[system tar test] 该目录下文件数: ${files.length}`);

    files.forEach((filePath) => {
      const relativePath = path.relative(sourceDirectory, filePath);
      const destinationPath = path.join(targetDirectory, relativePath);
      const finalPath = moveFileSafely(filePath, destinationPath);
      movedFiles += 1;
      console.log(`[move] ${filePath} -> ${finalPath}`);
    });
  });

  return movedFiles;
};

const main = () => {
  if (!archivePathArg) {
    logError('用法: npm run test:zip -- <压缩包路径>');
    logError('示例: npm run test:zip -- "D:\\tmp\\sample.zip"');
    process.exit(1);
  }

  const archivePath = path.resolve(archivePathArg);
  if (!fs.existsSync(archivePath)) {
    logError(`[system tar test] 文件不存在: ${archivePath}`);
    process.exit(1);
  }

  const archiveName = path.parse(archivePath).name;
  const archiveDir = path.dirname(archivePath);
  const tempExtractDir = allocateDirectoryPath(path.join(archiveDir, `${archiveName}_temp_extract`));

  console.log(`[system tar test] archivePath=${archivePath}`);
  console.log(`[system tar test] tempExtractDir=${tempExtractDir}`);

  const stdout = runTarList(archivePath);
  const entries = String(stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  console.log(`[system tar test] tar -tf 条目数: ${entries.length}`);

  const matchedDirectorySet = new Set<string>();
  entries.forEach((entryPath: string) => {
    const matchedDirectory = getICloudDirectoryFromEntry(entryPath);
    if (matchedDirectory) {
      matchedDirectorySet.add(matchedDirectory);
      console.log(`[match] ${entryPath} -> ${matchedDirectory}`);
    }
  });

  const matchedDirectories = Array.from(matchedDirectorySet);
  if (!matchedDirectories.length) {
    warnError(`[system tar test] 压缩包内未发现以 ${MATCH_PREFIX} 打头的文件夹。`);
    return;
  }

  ensureDirectory(tempExtractDir);

  try {
    console.log('[system tar test] 开始执行 tar -xf 全量解压...');
    extractArchiveWithSystemTar(archivePath, tempExtractDir);
    console.log('[system tar test] tar -xf 解压完成。');

    const existingICloudDirectories = findICloudDirectoriesRecursively(tempExtractDir);

    if (!existingICloudDirectories.length) {
      warnError('[system tar test] tar -xf 已完成，但未在解压结果中扫描到 iCloud 目录。');
      warnError('[system tar test] 这通常表示 tar -tf 的输出编码与磁盘实际目录名不一致，或压缩包结构和预期不同。');
      return;
    }

    console.log(`[system tar test] 解压后扫描到 iCloud 目录数: ${existingICloudDirectories.length}`);
    existingICloudDirectories.forEach((dirPath: string) => {
      console.log(`[system tar test] iCloud 目录: ${dirPath}`);
    });

    const movedFiles = moveFilesOutOfICloudDirectories(existingICloudDirectories, archiveDir);

    console.log(`[system tar test] 已移动文件数: ${movedFiles}`);
    console.log(`[system tar test] 最终输出目录: ${archiveDir}`);
  } finally {
    fs.rmSync(tempExtractDir, { recursive: true, force: true });
    console.log('[system tar test] 临时解压目录已清理。');
  }
};

try {
  main();
} catch (error: any) {
  logError('[system tar test] 执行失败:');
  logError(error?.stack || error);

  if (typeof error?.stdout === 'string' && error.stdout.trim()) {
    logError('[system tar test] stdout:');
    logError(error.stdout.trim());
  }

  if (typeof error?.stderr === 'string' && error.stderr.trim()) {
    logError('[system tar test] stderr:');
    logError(error.stderr.trim());
  }

  logError('[system tar test] 请确认系统 `tar` 可用，并且压缩包是完整可读的。');
  process.exit(1);
}
