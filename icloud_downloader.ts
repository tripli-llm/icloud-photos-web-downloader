import { launchAndEnterICloudHome } from './sub_login';
import {
  buildSavedFilePath,
  ensureWindowsTarAvailable,
  extractICloudPhotosDirectoryFromZip,
  readPhotoTimeText,
  saveErrorScreenshot,
  setFileTimestampsFromPhotoTime,
} from './sub_utils';

import {
  readDownloadTimeoutSeconds,
  readLastDownloadedUrl,
  readSavePath,
  updateLastDownloadedUrl,
} from './sub_config';
import type { Locator } from 'playwright';
import { logError, logUserAction, warnError } from './sub_log';

declare const process: any;
declare const require: any;

const email = process.argv[2] || process.env.ICLOUD_EMAIL;

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

if (!email) {


  logError('用法: npm run downloader <邮箱>');

  process.exit(1);
}

(async () => {
  const { page } = await launchAndEnterICloudHome(email);

  let savePath = '';
  let downloadTimeoutSeconds = 60;

  const isPhotosPage = () => {
    const allUrls = [page.url(), ...page.frames().map((f) => f.url())].join('\n').toLowerCase();
    return /icloud\.com\.cn\/photos(\/|$)/.test(allUrls);
  };

  const clickPhotosTab = async () => {
    const photoSelectors = [
      'text=/^照片$/',
      'text=/^Photos$/i',
      'a:has-text("照片")',
      'button:has-text("照片")',
      '[aria-label="照片"]',
      '[title="照片"]',
    ];

    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (isPhotosPage()) return true;

      for (const frame of [page.mainFrame(), ...page.frames()]) {
        for (const sel of photoSelectors) {
          const target = frame.locator(sel).first();
          if (await target.count()) {
            try {
              await target.click({ timeout: 3000 });
              await page.waitForTimeout(1000);
              if (isPhotosPage()) return true;
            } catch {}
          }
        }
      }

      await page.waitForTimeout(500);
    }

    return isPhotosPage();
  };

  const clickNextImageButton = async () => {
    const nextSelectors = [
      '[aria-label="下一张图像"]',
      '[title="下一张图像"]',
      'button:has-text("下一张图像")',
      'text=/^下一张图像$/',
      '[aria-label="Next image"]',
      '[title="Next image"]',
      'button:has-text("Next image")',
    ];

    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      for (const frame of [page.mainFrame(), ...page.frames()]) {
        for (const sel of nextSelectors) {
          const btn = frame.locator(sel).first();
          if (await btn.count()) {
            try {
              await btn.click({ timeout: 2000 });
              return true;
            } catch {}
          }
        }
      }

      await page.waitForTimeout(500);
    }

    return false;
  };

  const waitForNextImagePageReady = async (previousUrl: string) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const currentUrl = page.url();
      if (currentUrl !== previousUrl) {
        const photoTime = await readPhotoTimeText(page);
        if (photoTime) {
          return photoTime;
        }
      }

      await page.waitForTimeout(500);
    }

    return '';
  };

  const waitForUserSelectedStartPhoto = async () => {
    logUserAction('当前未配置 lastDownloadedUrl。');
    logUserAction('请在已打开的 iCloud “照片” 页面中，手动打开(双击)你要下载的第一张照片，脚本会自动开始下载。');

    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      const currentUrl = page.url();
      if (/^https:\/\/www\.icloud\.com\.cn\/photos\/#\//.test(currentUrl)) {
        const photoTime = await readPhotoTimeText(page);
        if (photoTime) {
          return {
            photoUrl: currentUrl,
            photoTime,
          };
        }
      }

      await page.waitForTimeout(500);
    }

    throw new Error('首次运行等待用户选择起始照片超时（10分钟）');
  };


  const openDownloadOptionsDialog = async () => {
    const moreContentSelectors = [
      '[aria-label*="显示更多内容"]',
      '[title*="显示更多内容"]',
      'button:has-text("显示更多内容")',
      '[aria-label*="More"]',
      '[title*="More"]',
    ];

    const moreDownloadSelectors = [
      'text=/^更多下载选项\.\.\.$/',
      'button:has-text("更多下载选项")',
      '[role="menuitem"]:has-text("更多下载选项")',
      'text=/^More Download Options\.\.\.$/i',
    ];

    const dialogSelectors = [
      'text=/^下载选项$/',
      '[role="dialog"]:has-text("下载选项")',
      'text=/^Download Options$/i',
    ];

    const openMenuDeadline = Date.now() + 15000;
    let menuOpened = false;

    while (Date.now() < openMenuDeadline && !menuOpened) {
      for (const frame of [page.mainFrame(), ...page.frames()]) {
        for (const sel of moreContentSelectors) {
          const btn = frame.locator(sel).first();
          if (await btn.count()) {
            try {
              await btn.click({ timeout: 2000 });
              menuOpened = true;
              break;
            } catch {}
          }
        }
        if (menuOpened) break;
      }

      if (!menuOpened) await page.waitForTimeout(500);
    }

    if (!menuOpened) return false;

    const menuItemDeadline = Date.now() + 10000;
    let clickedMenuItem = false;
    while (Date.now() < menuItemDeadline && !clickedMenuItem) {
      for (const frame of [page.mainFrame(), ...page.frames()]) {
        for (const sel of moreDownloadSelectors) {
          const item = frame.locator(sel).first();
          if (await item.count()) {
            try {
              await item.click({ timeout: 2000 });
              clickedMenuItem = true;
              break;
            } catch {}
          }
        }
        if (clickedMenuItem) break;
      }

      if (!clickedMenuItem) await page.waitForTimeout(500);
    }

    if (!clickedMenuItem) return false;

    const dialogDeadline = Date.now() + 10000;
    while (Date.now() < dialogDeadline) {
      for (const frame of [page.mainFrame(), ...page.frames()]) {
        for (const sel of dialogSelectors) {
          if (await frame.locator(sel).first().count()) {
            return true;
          }
        }
      }
      await page.waitForTimeout(500);
    }

    return false;
  };

  /**
   * 在下载弹窗中查找“未修改的原片 / Original Unmodified”这一行，
   * 返回对应的下载按钮，供后续点击触发下载。
   */
  const findOriginalDownloadButton = async (): Promise<Locator | null> => {
    const originalRowSelectors = [
      '[role="dialog"] :has-text("未修改的原片")',
      '[role="dialog"] :has-text("Original Unmodified")',
    ];

    const downloadButtonSelectors = [
      'button:has-text("下载")',
      '[aria-label*="下载"]',
      '[title*="下载"]',
      'button:has-text("Download")',
      '[aria-label*="Download"]',
      '[title*="Download"]',
    ];

    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      for (const frame of [page.mainFrame(), ...page.frames()]) {
        for (const rowSel of originalRowSelectors) {
          const row = frame.locator(rowSel).first();
          if (!(await row.count())) continue;

          for (const btnSel of downloadButtonSelectors) {
            const btn = row.locator(btnSel).first();
            if (await btn.count()) {
              return btn;
            }
          }
        }
      }

      await page.waitForTimeout(500);
    }

    return null;
  };

  /**
   * 点击原片下载按钮，等待 Playwright 下载对象完成，并将文件保存到指定目录。
   */
  const saveDownloadedOriginalFile = async (downloadButton: Locator, savePath: string) => {
    console.log(`正在下载原片...`);

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: downloadTimeoutSeconds * 1000}),
      downloadButton.click({ timeout: 3000 }),
    ]);

    const failure = await download.failure();
    if (failure) throw new Error(`下载失败: ${failure}`);

    const downloadPath = await download.path();
    if (!downloadPath) throw new Error('下载完成但未获取到下载路径');

    const targetPath = buildSavedFilePath(
      savePath,
      downloadPath,
      download.suggestedFilename()
    );
    await download.saveAs(targetPath);
    return targetPath;
  };

  try {
    savePath = readSavePath();
    console.log(`下载保存目录: ${savePath}`);

    downloadTimeoutSeconds = readDownloadTimeoutSeconds();
    console.log(`每个文件下载超时时间: ${downloadTimeoutSeconds} 秒`);

    if (!(await clickPhotosTab())) {
      throw new Error('已进入 iCloud 首页，但未找到“照片”入口');
    }

    console.log('已点击“照片”标签。');

    const lastDownloadedUrl = await readLastDownloadedUrl();
    let shouldDownloadCurrentPhoto = false;
    let currentPhotoTime = '';

    if (lastDownloadedUrl) {
      await page.goto(lastDownloadedUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      });
      console.log(`已打开上次下载照片链接: ${lastDownloadedUrl}`);
    } else {
      const selectedStartPhoto = await waitForUserSelectedStartPhoto();
      shouldDownloadCurrentPhoto = true;
      currentPhotoTime = selectedStartPhoto.photoTime;
      console.log(`已识别首次下载起点: ${selectedStartPhoto.photoUrl}`);
    }

    while (true) {
      if (shouldDownloadCurrentPhoto) {
        shouldDownloadCurrentPhoto = false;
        console.log('\n首次运行：将从你当前打开的这张照片开始下载。');
      } else {
        const previousPhotoUrl = page.url();
        if (!(await clickNextImageButton())) {
          throw new Error('未找到“下一张图像”按钮');
        }
        console.log('\n已点击“下一张图像”按钮。');

        currentPhotoTime = await waitForNextImagePageReady(previousPhotoUrl);
        if (!currentPhotoTime) {
          throw new Error('点击“下一张图像”后未确认进入下一张页面（地址未变化或顶部时间不可读取）');
        }
      }
      console.log(`页面顶部时间: ${currentPhotoTime}`);

      if (!(await openDownloadOptionsDialog())) {
        throw new Error('未能打开“下载选项”窗口');
      }

      const downloadButton = await findOriginalDownloadButton();
      if (!downloadButton) {
        throw new Error('未找到“未修改的原片”旁边下载按钮');
      }

      const downloadedPath = await saveDownloadedOriginalFile(downloadButton, savePath);
      console.log(`已下载文件位于: ${downloadedPath}`);

      if (/\.zip$/i.test(downloadedPath)) {
        const fs = require('fs');
        const extractedFiles = await extractICloudPhotosDirectoryFromZip(downloadedPath, savePath);

        if (extractedFiles.length) {

          console.log(`已从压缩包中额外移动出 ${extractedFiles.length} 个文件:`);
          extractedFiles.forEach((filePath) => console.log(`  ${filePath}`));
        }

        try {
          fs.unlinkSync(downloadedPath);


          console.log(`已删除压缩包: ${downloadedPath}`);
        } catch (error: any) {
          warnError(`删除压缩包失败: ${error?.message || error}`);

        }

        // ZIP 下载时，把原始时间应用到解压后移动出来的文件
        setFileTimestampsFromPhotoTime(extractedFiles, currentPhotoTime);
      } else {
        // 非 ZIP 下载时，直接修改下载文件时间
        setFileTimestampsFromPhotoTime(downloadedPath, currentPhotoTime);
      }

      const currentPhotoUrl = page.url();
      updateLastDownloadedUrl(currentPhotoUrl);

      // break;
    }
  } catch (error: any) {
    await saveErrorScreenshot(page, error, savePath);
    process.exitCode = 1;
  }
})();

