'use strict';

const { builtinModules } = require('node:module');
const logger = require('../utils/logger');

const NODE_BUILTINS = new Set(
  builtinModules
    .map((name) => (name.startsWith('node:') ? name.slice(5) : name))
    .filter(Boolean),
);

const IMPORT_PATTERNS = {
  REQUIRE_DESTRUCTURING: new RegExp(
    '^\\s*(?:const|let|var)\\s*\\{\\s*([^}]+)\\s*\\}\\s*=\\s*' +
      'require\\(\\s*[\'"]([^\'"]+)[\'"]\\s*\\)\\s*;?\\s*$',
  ),
  REQUIRE_ASSIGNMENT: new RegExp(
    '^\\s*(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*' +
      'require\\(\\s*[\'"]([^\'"]+)[\'"]\\s*\\)\\s*;?\\s*$',
  ),
  REQUIRE_SIDE_EFFECT: /^\s*require\(\s*['"]([^'"]+)['"]\s*\)\s*;?\s*$/,
  IMPORT_DESTRUCTURING: new RegExp(
    '^\\s*import\\s*\\{\\s*([^}]+)\\s*\\}\\s*from\\s*' +
      '[\'"]([^\'"]+)[\'"]\\s*;?\\s*$',
  ),
  IMPORT_ASSIGNMENT: new RegExp(
    '^\\s*import\\s+([A-Za-z_$][\\w$]*)\\s*from\\s*' +
      '[\'"]([^\'"]+)[\'"]\\s*;?\\s*$',
  ),
};

const parseDestructuringBindings = (bindings) => {
  const parts = bindings
    .split(',')
    .map((p) => p.trim())
    .map((part) => {
      const localName = part.split('=')[0].trim();
      if (localName === '') return part;

      const colonIndex = localName.indexOf(':');
      if (colonIndex !== -1) {
        return localName.slice(0, colonIndex).trim();
      }

      if (localName.startsWith('...')) return '';

      return localName;
    })
    .filter(Boolean);

  return parts;
};

const ensureImportEntry = (importRegistry, specifier) => {
  let entry = importRegistry.get(specifier);
  if (!entry) {
    entry = {
      defaultNames: new Set(),
      named: new Set(),
      sideEffect: false,
    };
    importRegistry.set(specifier, entry);
  }
  return entry;
};

const addDefaultImport = (importRegistry, specifier, localName) => {
  const entry = ensureImportEntry(importRegistry, specifier);
  entry.defaultNames.add(localName);
};

const addNamedImport = (importRegistry, specifier, localName) => {
  const entry = ensureImportEntry(importRegistry, specifier);
  entry.named.add(localName);
};

const addSideEffectImport = (importRegistry, specifier) => {
  const entry = ensureImportEntry(importRegistry, specifier);
  entry.sideEffect = true;
};

const isRelativePath = (specifier) =>
  specifier.startsWith('./') ||
  specifier.startsWith('../') ||
  specifier.startsWith('../../');

const validateSpecifier = (specifier, filename, lineNumber, line) => {
  if (specifier.startsWith('node:')) {
    const msg =
      `Node built-in require is not allowed in bundle sources: ` +
      `${filename}:${lineNumber}: ${line.trim()}`;
    logger.error(msg);
    return { valid: false, shouldKeep: false, isExternal: false };
  }

  if (isRelativePath(specifier)) {
    return { valid: true, shouldKeep: false, isExternal: false };
  }

  if (NODE_BUILTINS.has(specifier)) {
    const msg =
      `Node built-in module imported from bundle source: ` +
      `${filename}:${lineNumber}: ${specifier}`;
    logger.warn(msg);
    return { valid: true, shouldKeep: false, isExternal: false };
  }

  return { valid: true, shouldKeep: false, isExternal: true };
};

const matchImportPattern = (line) => {
  for (const [patternName, pattern] of Object.entries(IMPORT_PATTERNS)) {
    const match = line.match(pattern);
    if (match) {
      return { patternName, match };
    }
  }
  return null;
};

const parseAndRecordImport = (filename, lineNumber, line, importRegistry) => {
  const hasDeps = line.includes('require(') || line.includes('import ');
  if (!hasDeps) return { keepLine: true };

  const result = matchImportPattern(line);

  if (!result) {
    const msg =
      `Unsupported require() usage in ${filename}:${lineNumber}: ` +
      `${line.trim()}`;
    logger.warn(msg);
    return { keepLine: true };
  }

  const { patternName, match } = result;

  let specifier;
  let bindings;
  let localName;

  switch (patternName) {
    case 'REQUIRE_DESTRUCTURING':
      bindings = match[1];
      specifier = match[2];
      break;
    case 'REQUIRE_ASSIGNMENT':
      localName = match[1];
      specifier = match[2];
      break;
    case 'REQUIRE_SIDE_EFFECT':
      specifier = match[1];
      break;
    case 'IMPORT_DESTRUCTURING':
      bindings = match[1];
      specifier = match[2];
      break;
    case 'IMPORT_ASSIGNMENT':
      localName = match[1];
      specifier = match[2];
      break;
  }

  const validation = validateSpecifier(specifier, filename, lineNumber, line);
  if (!validation.valid) return { keepLine: validation.shouldKeep };

  if (isRelativePath(specifier)) {
    return { keepLine: false };
  }

  if (!validation.isExternal) {
    return { keepLine: false };
  }

  if (
    patternName === 'REQUIRE_DESTRUCTURING' ||
    patternName === 'IMPORT_DESTRUCTURING'
  ) {
    const parsedBindings = parseDestructuringBindings(bindings);
    if (parsedBindings.length === 0) return { keepLine: false };
    for (const name of parsedBindings) {
      addNamedImport(importRegistry, specifier, name);
    }
    return { keepLine: false };
  }

  if (
    patternName === 'REQUIRE_ASSIGNMENT' ||
    patternName === 'IMPORT_ASSIGNMENT'
  ) {
    addDefaultImport(importRegistry, specifier, localName);
    return { keepLine: false };
  }

  if (patternName === 'REQUIRE_SIDE_EFFECT') {
    addSideEffectImport(importRegistry, specifier);
    return { keepLine: false };
  }

  const msg =
    `Unsupported require() usage in ${filename}:${lineNumber}: ` +
    `${line.trim()}`;
  logger.warn(msg);

  return { keepLine: false };
};

const generateImportStatements = (importRegistry) => {
  if (importRegistry.size === 0) return '';
  const lines = [];

  for (const [specifier, entry] of importRegistry.entries()) {
    if (entry.sideEffect) lines.push(`import '${specifier}';`);

    const namedParts = Array.from(entry.named);

    if (entry.defaultNames.size === 0 && namedParts.length === 0) continue;

    if (entry.defaultNames.size <= 1) {
      const defaultName =
        entry.defaultNames.size === 1 ? [...entry.defaultNames][0] : null;
      if (defaultName && namedParts.length > 0) {
        const stmt =
          `import ${defaultName}, { ${namedParts.join(', ')} } ` +
          `from '${specifier}';`;
        lines.push(stmt);
      } else if (defaultName) {
        lines.push(`import ${defaultName} from '${specifier}';`);
      } else {
        lines.push(`import { ${namedParts.join(', ')} } from '${specifier}';`);
      }
      continue;
    }

    for (const defaultName of entry.defaultNames) {
      lines.push(`import ${defaultName} from '${specifier}';`);
    }
    if (namedParts.length > 0) {
      lines.push(`import { ${namedParts.join(', ')} } from '${specifier}';`);
    }
  }

  return lines.join('\n') + '\n\n';
};

module.exports = {
  parseAndRecordImport,
  generateImportStatements,
};
