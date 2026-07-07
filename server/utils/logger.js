// Voicible — Branded console logger
// "Every voice, made visible."
//
// Thin wrapper around chalk so every log line across the server carries
// consistent Voicible branding and severity coloring.

import chalk from 'chalk';

const prefix = chalk.hex('#2D6BE4').bold('[Voicible]');

function timestamp() {
  return chalk.gray(new Date().toISOString());
}

export const logger = {
  info: (...args) => console.log(prefix, timestamp(), chalk.white(...args)),
  success: (...args) => console.log(prefix, timestamp(), chalk.hex('#00D4AA')(...args)),
  warn: (...args) => console.warn(prefix, timestamp(), chalk.yellow('WARN'), ...args),
  error: (...args) => console.error(prefix, timestamp(), chalk.red('ERROR'), ...args),
  gloss: (original, gloss) =>
    console.log(
      prefix,
      chalk.gray('gloss:'),
      chalk.white(original),
      chalk.hex('#2D6BE4')('→'),
      chalk.hex('#00D4AA').bold(gloss)
    ),
  transcript: (text, isFinal) =>
    console.log(
      prefix,
      isFinal ? chalk.hex('#00D4AA')('transcript (final):') : chalk.gray('transcript (partial):'),
      isFinal ? chalk.white.bold(text) : chalk.gray(text)
    ),
  lookup: (word, result) => {
    if (result.found && !result.isFingerspelled) {
      console.log(prefix, chalk.hex('#00D4AA')(`  ✓ ${word}`), chalk.gray(`(dictionary sign, v=${result.dateVersion || 'undated'})`));
    } else if (result.found && result.isFingerspelled) {
      console.log(prefix, chalk.yellow(`  ~ ${word}`), chalk.gray('(fingerspelled fallback)'));
    } else {
      console.log(prefix, chalk.red(`  ✗ ${word}`), chalk.gray('(NOT FOUND — displayed as text only)'));
    }
  },
};

export default logger;
