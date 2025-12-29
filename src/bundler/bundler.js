'use strict';

const { resolveFilePath, readFileSync } = require('../utils/file-utils');
const {
  parseAndRecordImport,
  generateImportStatements,
} = require('../transforms/imports');
const { transformExports } = require('../transforms/exports');
const { generateBundleHeader, wrapInRegion } = require('./regions');

class Bundler {
  constructor(config, packageJson, license) {
    this.config = config;
    this.packageJson = packageJson;
    this.license = license;
    this.importRegistry = new Map();
  }

  processFile(filename) {
    const filePath = resolveFilePath(
      this.config.cwd,
      this.config.libDir,
      filename,
    );
    let content = readFileSync(filePath, `processing ${filename}`);

    content = content.replace(`'use strict';\n\n`, '');

    const lines = content.split('\n');
    const filteredLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const { keepLine } = parseAndRecordImport(
        filename,
        i + 1,
        line,
        this.importRegistry,
      );
      if (!keepLine) continue;
      filteredLines.push(line);
    }

    content = filteredLines.join('\n');
    content = transformExports(content, this.config.mode);

    return content;
  }

  generateBundle() {
    const header = generateBundleHeader(
      this.packageJson,
      this.license.licenseName,
      this.license.copyrightLine,
    );

    const chunks = this.config.order.map((filename) => {
      const content = this.processFile(filename);
      return wrapInRegion(filename, content);
    });

    const importsBlock = generateImportStatements(this.importRegistry);
    const bundleContent = chunks.join('\n').replaceAll('\n\n\n', '\n\n');

    return {
      header,
      importsBlock,
      bundleContent,
      importRegistry: this.importRegistry,
    };
  }
}

module.exports = { Bundler };
