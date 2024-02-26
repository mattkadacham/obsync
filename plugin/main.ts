import { Plugin, TAbstractFile, Notice } from "obsidian";
import { Github, GithubClientSettings, Repo, github } from "./github";
import { ERR, NONE, Result, SOME } from "func";
import { vault, Vault } from "vault";
import { ObsyncSettingTab } from "settings";

const write = (vault: Vault, path: string, content: string) => {
    if (vault.writeConfig(path, content).type === SOME) return Result.Ok(true);
    return vault.getFile(path).match(
        () => vault.modify(path, content),
        () => vault.create(path, content).then(() => Result.Ok(true))
    );
};

const read = async (path: string, vault: Vault) => {
    const content = await vault.read(path);
    if (content.type === NONE) throw new Error("file not found");
    return content.value;
};

export const DEFAULTS: ObsyncState = {
    initialised: false,
    sha: "",
    tree: {},
    settings: {
        owner: "",
        repo: "",
        rsa: "",
        branch: "main",
    },
};

export type ObsyncState = {
    initialised: boolean;
    sha: string;
    tree: Repo;
    settings: GithubClientSettings;
};

export type ObsyncStateUpdater = {
    state: () => ObsyncState;
    update: (f: (state: ObsyncState) => ObsyncState) => void;
};

export default class ObsyncPlugin extends Plugin {
    vault: Vault;
    github: Github;
    timeout: NodeJS.Timeout | null;
    state: ObsyncState;

    async onload() {
        this.vault = vault(this.app);
        const data = await this.loadState();
        this.state = data ? { ...DEFAULTS, ...data } : { ...DEFAULTS };
        this.addSettingTab(new ObsyncSettingTab(this.app, this));
        if (this.isInitialised(data)) {
            console.log("not initialised properly", data);
            return;
        }
        this.github = await github(data.settings);
        await this.github.pull(data.tree);
        this.updateState(data.sha, data.tree);
        this.subscribe();
    }

    async onunload() {}

    isInitialised = (state?: ObsyncState) =>
        !state ||
        !state.initialised ||
        !state.sha ||
        !state.settings.owner ||
        !state.settings.repo ||
        !state.settings.rsa;

    async loadState() {
        return (await this.loadData()) as ObsyncState;
    }

    process = async () => {
        return new Promise<void>((resolve) => {
            if (this.timeout) clearTimeout(this.timeout);
            this.timeout = setTimeout(async () => {
                this.timeout = null;
                await this.sendCommit();
                resolve();
            }, 3 * 1000);
        });
    };

    async sendCommit() {
        const tree = await this.github.buildTree((path: string) =>
            read(path, this.vault)
        );
        if (tree.length === 0) {
            return;
        }
        new Notice("Sending changes to github");
        const res = await this.github.commit(tree);
        await this.updateState(res.sha, res.tree);

        new Notice("Changes saved in github!");
    }

    async setInitialised(sha: string, tree: Repo) {
        this.state = { ...this.state, sha, tree, initialised: true };
        await this.saveData(this.state);
    }

    async updateState(sha: string, tree: Repo) {
        this.state = { ...this.state, sha, tree };
        await this.saveData(this.state);
    }

    async updateSettings(settings: GithubClientSettings) {
        this.state = { ...this.state, settings };
        await this.saveData(this.state);
    }

    subscribe() {
        this.registerEvent(this.app.vault.on("create", this.onCreate));
        this.registerEvent(this.app.vault.on("modify", this.onModify));
        this.registerEvent(this.app.vault.on("delete", this.onDelete));
        this.registerEvent(this.app.vault.on("rename", this.onRename));
        console.log("subscribed to changes");
    }

    onCreate = async (file: TAbstractFile) => {
        this.github.state.create(file.path);
        await this.process();
    };

    onModify = async (file: TAbstractFile) => {
        this.github.state.update(file.path);
        await this.process();
    };

    onDelete = async (file: TAbstractFile) => {
        this.github.state.delete(file.path);
        await this.process();
    };

    onRename = async (file: TAbstractFile, prev: string) => {
        this.github.state.rename(file.path, prev);
        await this.process();
    };

    async initialise() {
        this.github = await github(this.state.settings);
        new Notice("Pulling latest version of the repository");
        const githubFiles = await this.github.pull({});

        for (const file of githubFiles) {
            const result = await write(this.vault, file.path, file.content);
            if (result.type === ERR) {
                new Notice(result.err);
            }
        }

        const sha = this.github.state.sha();
        const tree = this.github.state.tree();
        await this.setInitialised(sha, tree);

        new Notice("initialised! 🎉");

        this.subscribe();
    }
}
