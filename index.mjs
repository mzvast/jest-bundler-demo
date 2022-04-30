import JestHasteMap from 'jest-haste-map';
import {dirname, join, resolve} from 'path';
import {fileURLToPath} from 'url';
import {cpus} from 'os';
import yargs from 'yargs';
import chalk from 'chalk';
import Resolver from 'jest-resolve';
import {DependencyResolver} from 'jest-resolve-dependencies';
import fs from 'fs';
import {Worker} from 'jest-worker';

const root = join(dirname(fileURLToPath(import.meta.url)), 'product');

const hasteMap = new JestHasteMap.default({
    extensions: ['js'],
    name: 'jest-bundler',
    platforms: [],
    rootDir: root,
    roots: [root],
    maxWorkers: cpus().length,
});

const {hasteFS, moduleMap} = await hasteMap.build();

const worker = new Worker(
    join(dirname(fileURLToPath(import.meta.url)), './worker'),
    {
        enableWorkerThreads: true,
    }
);

// console.log(hasteFS.getAllFiles());
const options = yargs(process.argv).argv;
const entryPoint = resolve(process.cwd(), options.entryPoint);
if (!hasteFS.exists(entryPoint)) {
    throw new Error(`Entrypoint ${entryPoint} does not exist`);
}

console.log(chalk.bold(`❯ Building ${chalk.blue(options.entryPoint)}`));
// node "/Users/mzvast/@Projects/jest-bundler/index.mjs" --entry-point product/entry-point.js

const resolver = new Resolver.default(moduleMap, {
    extensions: ['.js'],
    hasCoreModules: false,
    rootDir: root,
});

// const dependencyResolver = new DependencyResolver(resolver, hasteFS);

// console.log(dependencyResolver.resolve(entryPoint));
// ['/path/to/apple.js']

const queue = [entryPoint];
let id = 0;
const modules = new Map();
const seen = new Set();
while (queue.length) {
    const module = queue.shift();
    if (seen.has(module)) continue;
    seen.add(module);

    const dependencyMap = new Map(
        hasteFS
            .getDependencies(module)
            .map((dependencyName) => [
                dependencyName,
                resolver.resolveModule(module, dependencyName),
            ])
    );

    const code = fs.readFileSync(module, 'utf8');

    // const moduleBody = code.match(/module\.exports\s+=\s+(.*)?;/i)?.[1] || '';
    const metadata = {
        id: id++,
        code, //: moduleBody || code,
        dependencyMap,
    };
    modules.set(module, metadata);
    //     console.log(dependencyMap);
    queue.push(...dependencyMap.values());
}
console.log(chalk.bold(`❯ Found ${chalk.blue(seen.size)} files`));
// console.log(Array.from(allFiles));

console.log(chalk.bold(`❯ Serializing bundle`));


const wrapModule = (id, code) =>
    `define(${id},function(module,exports,require){\n ${code}})`;
const results = await Promise.all(
    Array.from(modules)
        .reverse()
        .map(async ([module, metadata]) => {
            let {id, code, dependencyMap} = metadata;
            ({code} = await worker.transformFile(code));
            for (const [dependencyName, dependencyPath] of dependencyMap) {
                const dependency = modules.get(dependencyPath);
                code = code.replace(
                    new RegExp(
                        // Escape `.` and `/`.
                        `require\\(('|")${dependencyName.replace(
                            /[\/.]/g,
                            '\\$&' // $& 代表lastMatch https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/RegExp/lastMatch
                        )}\\1\\)` // \1 匹配第一个group
                    ),
                    `require(${dependency.id})`
                );
            }
            return wrapModule(id, code);
        })
);
const output = [...results];

output.unshift(fs.readFileSync('./require.js', 'utf8'));

output.push('requireModule(0);');
console.log(output.join('\n'));

if (options.output) {
    fs.writeFileSync(options.output, output.join('\n'), 'utf8');
}
