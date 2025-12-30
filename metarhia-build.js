#!/usr/bin/env node
'use strict';

const { parseArgs } = require('node:util');
const {
  loadConfig,
  loadPackageJson,
  loadLicense,
  validateSourceFiles,
} = require('./src/config/loader');
const { executeLibMode } = require('./src/modes/lib-mode');
const { executeIIFEMode } = require('./src/modes/iife-mode');
const { executeAppMode } = require('./src/modes/app-mode');
const logger = require('./src/utils/logger');

const main = async () => {
  const { values: args } = parseArgs({
    options: {
      config: { type: 'string', short: 'c' },
      mode: { type: 'string', short: 'm' },
    },
    allowPositionals: true,
  });

  const cwd = process.cwd();
  const configPath = args.config || 'build.json';
  const configOverride = { mode: args.mode };

  const config = loadConfig(configPath, cwd, configOverride);
  const packageJson = loadPackageJson(cwd);
  const license = loadLicense(cwd, config.licensePath);

  if (['lib', 'iife'].includes(config.mode)) {
    validateSourceFiles(config.order, config.libDir, cwd);
  }

  const modeExecutors = {
    lib: () => executeLibMode(config, packageJson, license),
    iife: () => executeIIFEMode(config, packageJson, license),
    app: () => executeAppMode(config),
  };

  const executor = modeExecutors[config.mode];
  if (!executor) {
    logger.error(`Unknown mode: ${config.mode}`);
    process.exit(1);
  }

  await executor();
};

main().catch((error) => {
  logger.error(`Build failed: ${error.message}`);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
