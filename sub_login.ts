import { chromium } from 'playwright';
import { logUserAction } from './sub_log';


export const launchAndEnterICloudHome = async (email: string) => {
  const browser = await chromium.launch({ headless: false, slowMo: 150 });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://www.icloud.com.cn', {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });

  const signInSelectors = [
    'text=/^Sign In$/i',
    'text=/^Sign in to iCloud$/i',
    'text=/^登录$/',
    'button:has-text("Sign In")',
    'a:has-text("Sign In")',
  ];

  let clicked = false;
  for (const sel of signInSelectors) {
    const loc = page.locator(sel).first();
    if (await loc.count()) {
      try {
        await loc.click({ timeout: 4000 });
        clicked = true;
        break;
      } catch {}
    }
  }

  if (!clicked) {
    throw new Error('未找到 Sign In/登录 按钮');
  }

  const emailSelectors = [
    'input[type="email"]',
    '#account_name_text_field',
    'input[name="accountName"]',
    'input[name="appleId"]',
    'input[id*="account_name"]',
  ];

  const findEmailInput = async () => {
    const deadline = Date.now() + 30000;

    while (Date.now() < deadline) {
      for (const frame of [page.mainFrame(), ...page.frames()]) {
        for (const sel of emailSelectors) {
          const input = frame.locator(sel).first();
          try {
            if ((await input.count()) && (await input.isVisible())) {
              return { frame, sel };
            }
          } catch {}
        }
      }

      await page.waitForTimeout(500);
    }

    return null;
  };

  const typeEmailIntoInput = async (
    frame: ReturnType<typeof page.mainFrame>,
    sel: string,
  ) => {
    const input = frame.locator(sel).first();

    await input.click({ timeout: 2000 });
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('Backspace');
    await input.pressSequentially(email, { delay: 80 });

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if ((await input.inputValue()) === email) {
        return true;
      }
      await page.waitForTimeout(100);
    }

    return false;
  };

  const locatedEmailInput = await findEmailInput();
  if (!locatedEmailInput) {
    throw new Error('未找到邮箱输入框');
  }

  const filledFrame = locatedEmailInput.frame;
  const filled = await typeEmailIntoInput(locatedEmailInput.frame, locatedEmailInput.sel);
  if (!filled) {
    console.log('第一次邮箱输入失败，再次尝试');
    const secondFilled = await typeEmailIntoInput(locatedEmailInput.frame, locatedEmailInput.sel);
    if (!secondFilled) {
      throw new Error('第二次邮箱输入未完成');
    }
  }
  console.log('邮箱输入成功');

  const continueSelectors = [
    '#sign-in',
    'button#sign-in',
    'button[type="submit"]',
    'button:has-text("Continue")',
    'button:has-text("继续")',
    'text=/^Continue$/i',
    'text=/^继续$/',
  ];

  const clickContinueInFrame = async (frame: ReturnType<typeof page.mainFrame>) => {
    for (const sel of continueSelectors) {
      const btn = frame.locator(sel).first();
      if (await btn.count()) {
        try {
          await btn.click({ timeout: 3000 });
          return true;
        } catch {}
      }
    }
    return false;
  };

  let continued = await clickContinueInFrame(filledFrame);
  if (!continued) {
    for (const frame of [page.mainFrame(), ...page.frames()]) {
      if (await clickContinueInFrame(frame)) {
        continued = true;
        break;
      }
    }
  }

  if (!continued) {
    throw new Error('已填邮箱，但未找到继续按钮');
  }

  const passwordSelectors = [
    'input[type="password"]',
    '#password_text_field',
    'input[name="password"]',
    'input[id*="password"]',
  ];

  const hasPasswordInput = async () => {
    for (const frame of [page.mainFrame(), ...page.frames()]) {
      for (const sel of passwordSelectors) {
        const input = frame.locator(sel).first();
        if (await input.count()) {
          return true;
        }
      }
    }
    return false;
  };

  const isICloudHome = async () => {
    const frames = [page.mainFrame(), ...page.frames()];
    const homeMarkers = [
      'text=/^照片$/',
      'text=/^邮件$/',
      'text=/^云盘$/',
      'text=/^备忘录$/',
      'text=/^通讯录$/',
      'text=/^日历$/',
      'text=/^查找$/',
      'text=/^提醒事项$/',
    ];

    let hit = 0;
    for (const sel of homeMarkers) {
      for (const frame of frames) {
        if (await frame.locator(sel).first().count()) {
          hit += 1;
          break;
        }
      }
      if (hit >= 2) return true;
    }

    return false;
  };

  logUserAction('请在网页中手动输入密码并点击登录。');


  const submitDeadline = Date.now() + 180000;
  let submitDetected = false;

  while (Date.now() < submitDeadline && !submitDetected) {
    const frames = [page.mainFrame(), ...page.frames()];
    const allUrls = [page.url(), ...frames.map((f) => f.url())].join('\n').toLowerCase();
    const movedToNextStep =
      /two-factor|verify|verification|challenge|trusted|security|captcha|account/.test(allUrls) &&
      !allUrls.includes('signin');
    const passwordGone = !(await hasPasswordInput());

    if (movedToNextStep || passwordGone) {
      submitDetected = true;
      break;
    }

    await page.waitForTimeout(500);
  }

  if (!submitDetected) {
    throw new Error('等待用户点击登录超时（3分钟）');
  }

  logUserAction('检测到你已提交登录，后续流程请继续在网页完成（如双重验证）。');


  const takeoverDeadline = Date.now() + 180000;
  let tookOver = false;

  while (Date.now() < takeoverDeadline && !tookOver) {
    const frames = [page.mainFrame(), ...page.frames()];
    const allUrls = [page.url(), ...frames.map((f) => f.url())].join('\n').toLowerCase();
    const movedToNextStep =
      /two-factor|verify|verification|challenge|trusted|security|captcha|account/.test(allUrls) &&
      !allUrls.includes('signin');
    const enteredICloudApp =
      /icloud\.com\.cn\/(photos|mail|drive|notes|contacts|calendar|find|reminders)(\/|$)/.test(allUrls);

    if (movedToNextStep || enteredICloudApp || (await isICloudHome())) {
      tookOver = true;
      break;
    }

    await page.waitForTimeout(1000);
  }

  if (!tookOver) {
    throw new Error('已检测到提交登录，但等待进入 iCloud 页面超时（3分钟）');
  }

  console.log('检测到你已进入 iCloud 首页。');

  return { browser, context, page };
};
