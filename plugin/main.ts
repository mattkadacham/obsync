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
    statusIndicator: HTMLElement;

    async onload() {
        this.vault = vault(this.app);
        const data = await this.loadState();
        this.state = data ? { ...DEFAULTS, ...data } : { ...DEFAULTS };
        this.createIndicator();
        this.addSettingTab(new ObsyncSettingTab(this.app, this));
        if (this.isInitialised(data)) {
            console.log("not initialised properly", data);
            return;
        }

        this.github = await github(this.state.settings);
        this.pull(this.state.tree);
        this.subscribe();

        this.addCommand({
            id: "obsync-pull",
            name: "Pull from github",
            callback: async () => await this.pull(this.state.tree),
        });
    }

    createIndicator() {
        this.statusIndicator = this.addStatusBarItem();
        this.statusIndicator.hide();
        this.statusIndicator.createEl("span", {
            text: "Hello from the status bar 👋",
        });
    }

    showIndicator(text: string) {
        this.statusIndicator.show();
        this.statusIndicator.setText(text);
    }

    showFor(text: string, time: number) {
        this.showIndicator(text);
        setTimeout(() => this.hideIndicator(), time);
    }

    hideIndicator() {
        this.statusIndicator.hide();
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

    pull = async (tree: Repo) => {
        this.showIndicator("Pulling from github");
        const updatedFiles = await this.github.pull(tree);

        for (const file of updatedFiles) {
            const result = await write(this.vault, file.path, file.content);
            if (result.type === ERR) {
                console.error(result.err);
                this.showFor("Error pulling from github", 3000);
            }
        }
        this.showFor(`Updated ${updatedFiles.length} files`, 3000);
        this.updateState(this.github.state.sha(), this.github.state.tree());
        this.hideIndicator();
    };

    push = async () => {
        const tree = await this.github.buildTree((path: string) =>
            read(path, this.vault)
        );
        this.github.stage(tree);

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
        this.showIndicator("Pushing to github");
        try {
            const res = await this.github.commit();
            await this.updateState(res.sha, res.tree);
            this.hideIndicator();
        } catch (e) {
            console.error(e.message);
            this.showFor("Error pushing to github", 3000);
        }
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
        await this.push();
    };

    onModify = async (file: TAbstractFile) => {
        this.github.state.update(file.path);
        await this.push();
    };

    onDelete = async (file: TAbstractFile) => {
        this.github.state.delete(file.path);
        await this.push();
    };

    onRename = async (file: TAbstractFile, prev: string) => {
        this.github.state.rename(file.path, prev);
        await this.push();
    };

    async initialise() {
        this.github = await github(this.state.settings);
        this.showIndicator("Pulling latest version of the repository");
        await this.pull({});
        await this.setInitialised(
            this.github.state.sha(),
            this.github.state.tree()
        );

        this.showIndicator("initialised! 🎉");
        setTimeout(() => this.hideIndicator(), 2000);

        this.subscribe();
    }
}
