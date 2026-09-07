#!/usr/bin/env node
/** Minimal Streamline-style build script for this repository. */
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');
const outDir = path.join(__dirname, 'providers');
const EXTERNAL = ['cheerio-without-node-native', 'react-native-cheerio', 'cheerio', 'crypto-js', 'axios'];

async function buildProvider(name) {
    const entry = path.join(srcDir, name, 'index.js');
    const out = path.join(outDir, name + '.js');
    if (!fs.existsSync(entry)) return;
    await esbuild.build({
        entryPoints: [entry],
        bundle: true,
        outfile: out,
        format: 'cjs',
        platform: 'neutral',
        target: 'es2016',
        minify: false,
        sourcemap: false,
        external: EXTERNAL,
        banner: { js: `/** ${name} - built from src/${name}/index.js */` },
        logLevel: 'warning'
    });
    console.log('Built providers/' + name + '.js');
}

async function main() {
    if (!fs.existsSync(srcDir)) throw new Error('src/ not found');
    fs.mkdirSync(outDir, { recursive: true });
    const only = process.argv.slice(2).filter(x => !x.startsWith('-'));
    const names = only.length ? only : fs.readdirSync(srcDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && d.name !== '_shared')
        .map(d => d.name);
    for (const name of names) await buildProvider(name);
}

main().catch(err => { console.error(err); process.exit(1); });
