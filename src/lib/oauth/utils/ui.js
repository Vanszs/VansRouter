import ora from "ora";

/**
 * UI Helper Functions
 */

const colors = {
  green: (text) => `\x1b[32m${text}\x1b[0m`,
  red: (text) => `\x1b[31m${text}\x1b[0m`,
  blue: (text) => `\x1b[34m${text}\x1b[0m`,
  yellow: (text) => `\x1b[33m${text}\x1b[0m`,
  gray: (text) => `\x1b[90m${text}\x1b[0m`,
};

export function success(message) {
  console.log(colors.green(`\n✓ ${message}\n`));
}

export function error(message) {
  console.log(colors.red(`\n✗ ${message}\n`));
}

export function info(message) {
  console.log(colors.blue(`\n${message}\n`));
}

export function warn(message) {
  console.log(colors.yellow(`\n⚠ ${message}\n`));
}

export function gray(message) {
  console.log(colors.gray(message));
}

export function spinner(text) {
  return ora(text);
}

export function printSection(title) {
  console.log(colors.blue(`\n${title}\n`));
}

export function printKeyValue(key, value, isSuccess = false) {
  const color = isSuccess ? colors.green : colors.gray;
  console.log(color(`  ${key}: ${value}`));
}

export function printList(items, isSuccess = false) {
  const symbol = isSuccess ? "✓" : "✗";
  const color = isSuccess ? colors.green : colors.gray;
  items.forEach((item) => {
    console.log(color(`  ${symbol} ${item}`));
  });
}

