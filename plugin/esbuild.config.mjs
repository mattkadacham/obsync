import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import fs from 'fs';
import path from 'path';
import args from 'command-line-args';


const banner =
    `/*
THIS IS A GENERATED/BUNDLED FILE BY ESBUILD
if you want to view the source, please visit the github repository of this plugin
*/
`;

const optionDefinitions = [
    {
        name: 'production',
        alias: 'p',
        type: Boolean,
        defaultValue: false,
    },
    {
        name: 'vault',
        alias: 'v',
        type: String,
    },
    {
        name: 'watch',
        alias: 'w',
        type: Boolean,
        defaultValue: false,
    }
];

const options = args(optionDefinitions);
const prod = options.production;

const copyPlugin = {
    name: 'copy-plugin',
    setup(build) {
        build.onEnd(result => {
            if (!fs.existsSync(options.vault)) {
                throw new Error("Vault path does not exist");
            }

            const filepath = path.join(options.vault, ".obsidian", "plugins", "obsync")
            if (!fs.existsSync(filepath)) {
                fs.mkdirSync(filepath, { recursive: true });
            }


            const handleErr = err => err && console.error(err);
            fs.copyFile('main.js', path.join(filepath, 'main.js'), handleErr);
            fs.copyFile('manifest.json', path.join(filepath, 'manifest.json'), handleErr);
            fs.copyFile('styles.css', path.join(filepath, 'styles.css'), handleErr);
            fs.copyFile('obsync.pem', path.join(filepath, 'obsync.pem'), handleErr);
        });
    }
}

const context = await esbuild.context({
    banner: {
        js: banner,
    },
    entryPoints: ["main.ts"],
    bundle: true,
    external: [
        "obsidian",
        "electron",
        "@codemirror/autocomplete",
        "@codemirror/collab",
        "@codemirror/commands",
        "@codemirror/language",
        "@codemirror/lint",
        "@codemirror/search",
        "@codemirror/state",
        "@codemirror/view",
        "@lezer/common",
        "@lezer/highlight",
        "@lezer/lr",
        ...builtins],
    format: "cjs",
    target: "es2018",
    logLevel: "info",
    sourcemap: prod ? false : "inline",
    treeShaking: true,
    outfile: "main.js",
    plugins: !!options.vault ? [copyPlugin] : []
});

if (prod) {
    await context.rebuild();
    process.exit(0);
} else {
    await context.watch();
}