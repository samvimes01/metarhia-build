'use strict';

const {
  writeFileSync,
  readFileSync,
  resolveFilePath,
} = require('../utils/file-utils');
const logger = require('../utils/logger');
const { Bundler } = require('../bundler/bundler');
const { transformExports } = require('../transforms/exports');
const { wrapInRegion } = require('../bundler/regions');

const loadDependencies = (importRegistry, config) => {
  const uniqueDeps = Array.from(new Set(importRegistry.keys()));
  const depContents = uniqueDeps.map((lib) => {
    const fileName = resolveFilePath(
      config.cwd,
      config.nodeModulesPath,
      lib,
      `${lib}.mjs`,
    );
    const source = readFileSync(fileName, `dependency ${lib}`);
    return wrapInRegion(lib, source);
  });
  return depContents.join('\n');
};

const wrapInIIFE = (packageName, content) => {
  const iifeVarName = packageName.replace(/-/g, '');
  return (
    `var ${iifeVarName}IIFE = (function (exports) {\n` +
    content +
    'return exports; })({});'
  );
};

const executeIIFEMode = (config, packageJson, license) => {
  const bundler = new Bundler(config, packageJson, license);
  const { header, bundleContent, importRegistry } = bundler.generateBundle();

  const packageName = packageJson.name.split('/').pop();

  let depsContent = '';
  if (importRegistry.size > 0) {
    depsContent = loadDependencies(importRegistry, config);
    depsContent = transformExports(depsContent, 'iife');
  }

  const combinedContent = depsContent + bundleContent;
  const iifeContent = combinedContent.replaceAll('\n\n\n', '\n\n');
  const wrapped = wrapInIIFE(packageName, iifeContent);

  const content = header + wrapped;
  const outputFile = resolveFilePath(config.outputDir, `${packageName}.mjs`);

  writeFileSync(outputFile, content, 'IIFE bundle output');
  logger.success(`IIFE bundle created: ${outputFile}`);
};

module.exports = { executeIIFEMode };
