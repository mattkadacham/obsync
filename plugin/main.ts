import { Plugin } from "obsidian";

interface ObsyncSettings {
    aaa: string;
}

const DEFAULT_SETTINGS: ObsyncSettings = {
    aaa: 'default'
}

export default class ObsyncPlugin extends Plugin {
    settings: ObsyncSettings;

    async onload() {
        await this.load();

        // Configure resources needed by the plugin.
        console.log('loaded plugin!!');
        console.log('aaaa');
        console.log("bbbb");
    }
    async onunload() {
        // Release any resources configured by the plugin.
    }
}