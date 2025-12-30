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
const { BUNDLE_EXT } = require('../utils/file-utils');

const loadDependencies = (importRegistry, config) => {
  const uniqueDeps = Array.from(new Set(importRegistry.keys()));
  const depContents = uniqueDeps.map((lib) => {
    const fileName = resolveFilePath(
      config.cwd,
      config.nodeModulesPath,
      lib,
      `${lib}${BUNDLE_EXT.lib}`,
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
    '\nreturn exports;\n})({});\n'
  );
};

const generateExportsBlock = (exportNames) => {
  if (exportNames.length === 0) return '';
  const exportsLines = exportNames.map((name) => `exports.${name} = ${name};`);
  return exportsLines.join('\n');
};

const executeIIFEMode = (config, packageJson, license) => {
  const bundler = new Bundler(config, packageJson, license);
  const { header, bundleContent, importRegistry, exportNames } =
    bundler.generateBundle();

  const packageName = packageJson.name.split('/').pop();

  let depsContent = '';
  if (importRegistry.size > 0) {
    depsContent = loadDependencies(importRegistry, config);
    depsContent = transformExports(depsContent, 'iife');
  }

  const exportsBlock = generateExportsBlock(exportNames);
  const combinedContent = depsContent + bundleContent + '\n' + exportsBlock;
  const iifeContent = combinedContent.replaceAll('\n\n\n', '\n\n');
  const wrapped = wrapInIIFE(packageName, iifeContent);

  const content = header + wrapped;
  const outputFile = resolveFilePath(
    config.outputDir,
    `${packageName}${BUNDLE_EXT.iife}`,
  );

  writeFileSync(outputFile, content, 'IIFE bundle output');
  logger.success(`IIFE bundle created: ${outputFile}`);
};

module.exports = { executeIIFEMode };
