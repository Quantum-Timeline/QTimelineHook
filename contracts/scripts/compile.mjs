import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';

const root = path.resolve('contracts');
const sources = {};
function collect(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full);
    else if (entry.name.endsWith('.sol')) sources[path.relative(root, full).replaceAll('\\', '/')] = { content: fs.readFileSync(full, 'utf8') };
  }
}
collect(path.join(root, 'src'));
const input = {
  language: 'Solidity', sources,
  settings: { optimizer: { enabled: true, runs: 10000 }, viaIR: true, evmVersion: 'osaka', metadata: { bytecodeHash: 'none' }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
};
function findImports(importPath) {
  const file = importPath.startsWith('@mldsa/')
    ? path.resolve(root, 'lib/evm-ml-dsa-verifier/src', importPath.slice('@mldsa/'.length))
    : (importPath.startsWith('@openzeppelin/') || importPath.startsWith('@uniswap/'))
    ? path.resolve('node_modules', importPath)
    : path.resolve(root, importPath);
  try { return { contents: fs.readFileSync(file, 'utf8') }; }
  catch { return { error: `Import not found: ${importPath}` }; }
}
const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
const errors = (output.errors ?? []).filter(item => item.severity === 'error');
for (const item of output.errors ?? []) console.log(item.formattedMessage);
if (errors.length) process.exit(1);
console.log(`Compiled ${Object.keys(output.contracts ?? {}).length} Solidity source units with solc ${solc.version()}.`);
