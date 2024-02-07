/**
 * @type {import('eslint').ESLint.ConfigData}
 */
module.exports = {
    ignorePatterns: ['**/*.js', '**/*.json', 'dist'],
    env: {
        es2021: true,
        node: true,
    },
    extends: ['standard-with-typescript', 'prettier'],
    overrides: [
        {
            env: {
                node: true,
            },
            files: ['.eslintrc.{js,cjs}'],
            parserOptions: {
                sourceType: 'script',
            },
        },
    ],
    parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
    },
    rules: {
        '@typescript-eslint/strict-boolean-expressions': 0,
    },
};
