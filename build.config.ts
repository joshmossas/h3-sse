import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
    entries: ['./src/index'],
    outDir: 'dist',
    rootDir: '.',
    declaration: true,
    failOnWarn: false,
    rollup: {
        emitCJS: true,
        dts: {
            respectExternal: true,
        },
    },
});
