const ANSI_RESET = '\x1b[0m';
const ANSI_RED = '\x1b[31m';
const ANSI_YELLOW = '\x1b[33m';

const colorize = (colorCode: string, message: string) => `${colorCode}${message}${ANSI_RESET}`;

export const red = (message: string) => colorize(ANSI_RED, message);
export const yellow = (message: string) => colorize(ANSI_YELLOW, message);

export const logError = (message: string) => {
  console.error(red(message));
};

export const logUserAction = (message: string) => {
  console.log(yellow(message));
};

export const warnError = (message: string) => {
  console.warn(red(message));
};
