const modules = new Map(); // moduleFactory注册表 number=> object
const define = (name, moduleFactory) => {
    modules.set(name, moduleFactory);
};

const moduleCache = new Map(); // module实例缓存

const requireModule = (name) => {
    if (moduleCache.has(name)) return moduleCache.get(name).exports;

    if (!modules.has(name)) throw new Error(`Module ${name} not exist`);

    const moduleFactory = modules.get(name);

    const module = {
        exports: {},
    };

    moduleCache.set(name, module);

    moduleFactory(module, module.exports, requireModule);

    return module.exports;
};

// define('tomato', function (module, exports, require) {
//     module.exports = 'tomato';
// });
