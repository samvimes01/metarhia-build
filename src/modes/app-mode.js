'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const logger = require('../utils/logger');

const executeAppMode = async (config) => {
  const dependencies = config.order;
  const targetDir = config.appStaticDir;

  try {
    await fs.mkdir(targetDir, { recursive: true });

    for (const dep of dependencies) {
      if (typeof dep !== 'string' || !dep.trim()) continue;

      const sourcePath = path.join(config.nodeModulesPath, dep, `${dep}.mjs`);
      const linkPath = path.join(targetDir, `${dep}.mjs`);

      try {
        await fs.rm(linkPath, { force: true });

        await fs.symlink(
          path.relative(path.dirname(linkPath), sourcePath),
          linkPath,
          'file',
        );

        logger.info(`Linked: ${sourcePath} -> ${linkPath}`);
      } catch (error) {
        logger.error(`Error linking ${dep}: ${error.message}`);
      }
    }
  } catch (error) {
    logger.error(`Error in processLinks: ${error.message}`);
    throw error;
  }
};

module.exports = { executeAppMode };
