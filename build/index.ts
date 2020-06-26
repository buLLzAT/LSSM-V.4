import fs from 'fs';
import path from 'path';
import lodash from 'lodash';
import { version } from '../package.json';
import config from '../src/config';
import webpackConfig from '../webpack.config';
import webpack, { ChunkData, Configuration } from 'webpack';
import moment from 'moment';
import { Module } from '../typings/Module';

console.time('build');

const dir = process.argv[2] === 'production' ? 'stable/' : 'beta/';

console.info(`Let's build that stuff in Version ${version}`);

const moduleDirs = fs.readdirSync(`./src/modules/`);

const moduleEntries = [] as Configuration[];

const entries = Object.entries(config.games)
    .filter(
        game => game[0] === 'de_DE' && fs.existsSync(`./src/i18n/${game[0]}.ts`)
    )
    .map(game => {
        const [locale, { locale_fallback }] = game;
        const entry = {
            mode: process.argv[2] || 'development',
            entry: {
                [`${locale}_core`]: path.resolve(__dirname, '../src/core.ts'),
            },
            output: {
                path: path.resolve(__dirname, `../dist/${dir}${locale}`),
                filename: (chunkData: ChunkData) =>
                    `${chunkData.chunk.name.replace(
                        /^[a-z]{2}_[A-Z]{2}_/,
                        ''
                    )}.js`,
            },
            ...lodash.cloneDeep(webpackConfig),
        } as Configuration;
        const fallbackLocales = [] as string[];
        if (locale_fallback) {
            fallbackLocales.push(locale_fallback);
            let nextFallback = config.games[locale_fallback].locale_fallback;
            while (nextFallback) {
                fallbackLocales.push(nextFallback);
                nextFallback = config.games[nextFallback].locale_fallback;
            }
        }

        const modules = moduleDirs.filter(module => {
            if (
                config.modules['core-modules'].includes(module) ||
                module === 'template'
            )
                return;
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const registration = require(`../src/modules/${module}/register`) as Module;
            return (
                !registration.locales || registration.locales?.includes(locale)
            );
        });

        entry.plugins?.unshift(
            new webpack.DefinePlugin({
                PREFIX: JSON.stringify(config.prefix),
                BUILD_LANG: JSON.stringify(locale),
                VERSION: JSON.stringify(version),
                MODE: process.argv[2] === 'production' ? '"stable"' : '"beta"',
                FALLBACK_LOCALES: JSON.stringify(fallbackLocales),
                MODULE_REGISTER_FILES: new RegExp(
                    `modules\\/(${modules.join('|')})\\/register\\.js(on)?`
                ),
                MODULE_ROOT_I18N_FILES: new RegExp(
                    `modules\\/(${[
                        ...modules,
                        ...config.modules['core-modules'],
                    ].join('|')})\\/i18n\\/${locale}.root(\\/index)?\\.js(on)?$`
                ),
            }),
            new webpack.ContextReplacementPlugin(
                /moment\/locale$/,
                new RegExp(
                    `${
                        locale !== 'en_US'
                            ? // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                              // @ts-ignore
                              moment.localeData(locale)._abbr
                            : 'en-gb'
                    }$`
                )
            ),
            new webpack.ContextReplacementPlugin(
                /i18n$/,
                new RegExp(`${[locale, ...fallbackLocales].join('|')}$`)
            )
        );

        const modulesEntry = {
            ...lodash.cloneDeep(entry),
            output: {
                path: path.resolve(
                    __dirname,
                    `../dist/${dir}${locale}/modules`
                ),
                filename: (chunkData: ChunkData) =>
                    `${chunkData.chunk.name.replace(
                        /^[a-z]{2}_[A-Z]{2}_/,
                        ''
                    )}/main.js`,
            },
        } as Configuration;
        modulesEntry.module?.rules.push({
            test: /\.(ts|vue)$/g,
            loader: 'string-replace-loader',
            query: {
                multiple: [
                    {
                        search: /require\((['"])vue(['"])\)/g,
                        replace: '(window.lssmv4 as Vue).$vue',
                    },
                    {
                        search: /import Vue from ['"]vue['"]/g,
                        replace: 'const Vue = (window.lssmv4 as Vue).$vue',
                    },
                ],
            },
        });
        modulesEntry.entry = {
            ...Object.fromEntries(
                modules
                    .filter(module =>
                        fs.existsSync(`./src/modules/${module}/main.ts`)
                    )
                    .map(module => {
                        modulesEntry.module?.rules.unshift({
                            test: new RegExp(`modules/${module}/main.ts$`),
                            use: [
                                {
                                    loader: 'webpack-loader-append-prepend',
                                    options: {
                                        prepend: [locale, ...fallbackLocales]
                                            .filter(loca => {
                                                try {
                                                    require(`../src/modules/${module}/i18n/${loca}`);
                                                    return true;
                                                } catch {
                                                    return false;
                                                }
                                            })
                                            .map(
                                                loca =>
                                                    `window[${JSON.stringify(
                                                        config.prefix
                                                    )}].$i18n.mergeLocaleMessage(${JSON.stringify(
                                                        loca
                                                    )},{modules:{${module}: require(\`${path.resolve(
                                                        __dirname,
                                                        `../src/modules/${module}/i18n/${loca}`
                                                    )}\`),},});`
                                            )
                                            .join('\n'),
                                    },
                                },
                            ],
                        });
                        modulesEntry.module?.rules.push({
                            test: new RegExp(
                                `modules/${module}/.*\\.(ts|vue)$`
                            ),
                            loader: 'string-replace-loader',
                            query: {
                                multiple: [
                                    {
                                        search: /MODULE_ID/g,
                                        replace: JSON.stringify(module),
                                    },
                                ],
                            },
                        });
                        return [
                            `${locale}_${module}`,
                            path.resolve(
                                __dirname,
                                `../src/modules/${module}/main.ts`
                            ),
                        ];
                    })
            ),
        };

        moduleEntries.push(modulesEntry);

        return entry;
    })
    .filter(entry => entry);

console.log('Generated configurations. Building…');
webpack([...entries, ...moduleEntries], (err, stats) => {
    if (err) {
        console.error(err.stack || err);
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        if (err.details) {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            console.error(err.details);
        }
    }

    console.log('Stats:');
    console.log(stats.toString({ colors: true }));
    console.timeEnd('build');
    console.log(`Build finished at ${new Date().toLocaleTimeString()}`);
    if (stats.hasErrors()) process.exit(-1);
});