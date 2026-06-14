import chalk from "chalk";
import ora from "ora";

/**
 * UI Helper Functions
 */

function success(message) {
  console.log(chalk.green(`\n✓ ${message}\n`));
}

function error(message) {
  console.log(chalk.red(`\n✗ ${message}\n`));
}

function info(message) {
  console.log(chalk.blue(`\n${message}\n`));
}

function warn(message) {
  console.log(chalk.yellow(`\n⚠ ${message}\n`));
}

function gray(message) {
  console.log(chalk.gray(message));
}

function spinner(text) {
  return ora(text);
}

function printSection(title) {
  console.log(chalk.blue(`\n${title}\n`));
}

function printKeyValue(key, value, isSuccess = false) {
  const color = isSuccess ? chalk.green : chalk.gray;
  console.log(color(`  ${key}: ${value}`));
}

function printList(items, isSuccess = false) {
  const symbol = isSuccess ? "✓" : "✗";
  const color = isSuccess ? chalk.green : chalk.gray;
  items.forEach((item) => {
    console.log(color(`  ${symbol} ${item}`));
  });
}

