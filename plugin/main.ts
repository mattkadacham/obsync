import { App, Plugin, PluginSettingTab, Setting, TAbstractFile, Notice } from "obsidian";
import { GFile, Github, GithubClientSettings, github } from './github';
import { ERR, NONE, Result, SOME } from "func";
import { vault, Vault } from "vault";


type ObsyncState = {
    initialised: boolean;
    latestCommit: string;
    modifiedFiles: string[];
    remote: { [path: string]: string };
    settings: GithubClientSettings;
};

const isSettingsValid = (state: ObsyncState) => {
    const { settings } = state;
    return settings.owner && settings.repo && settings.rsa;
}

const DEFAULTS: ObsyncState = {
    initialised: false,
    latestCommit: '',
    modifiedFiles: [],
    remote: {},
    settings: {
        owner: '',
        repo: '',
        rsa: '',
        branch: 'main',
    },
}

const pullEverything = async (g: Github, latestCommit: string) => {
    new Notice('Pulling latest version of the repository');

    if ((await g.rootContent(latestCommit)).type === NONE) {
        return Result.Err<GFile[]>('no files found');
    }

    return g.getAll('');
}

const write = (vault: Vault, path: string, content: string) => {
    if (vault.writeConfig(path, content).type === SOME) return Result.Ok(true);
    return vault.getFile(path).match(
        () => vault.modify(path, content),
        () => vault.create(path, content)
            .then(() => Result.Ok(true))
    );
}

const read = async (path: string, vault: Vault) => {
    const content = await vault.read(path);
    if (content.type === NONE) throw new Error('file not found');
    return content;
}

const remoteFile = async (path: string, g: Github) => {
    const githubContent = await g.getSingle(path);
    if (githubContent.type === ERR) throw new Error(githubContent.err);
    return githubContent.value;
}

type ShaMismatch = { path: string, content: string, sha: string };

const shaMismatch = async (path: string, remote: { [name: string]: string }, vault: Vault, g: Github): Promise<ShaMismatch | null> => {
    const content = await read(path, vault);
    const sha = g.hash(content.value);
    if (remote[path] && sha === remote[path]) return null;
    const githubContent = await remoteFile(path, g);
    if (sha === githubContent.sha) return null;
    return { path, content: content.value, sha: githubContent.sha };
}

const send = async (g: Github, filepaths: string[], remote: { [name: string]: string }, vault: Vault) => {
    let count = 0;
    let updates: { [name: string]: string } = {};
    const modified = await Promise.all(filepaths.map(f => shaMismatch(f, remote, vault, g)));
    const files = modified.filter(i => !!i) as ShaMismatch[];
    for (const f of files) {
        const result = await g.createOrUpdate(f.path, f.content, f.sha);
        if (result.type == ERR) throw new Error('error');
        count++;
        updates[f.path] = result.value;
    }
    if (count > 0) new Notice('Changes saved in github!');
    return updates;
}

export default class ObsyncPlugin extends Plugin {
    state: ObsyncState;
    vault: Vault;
    github: Github;
    timeout: NodeJS.Timeout | null;

    async onload() {
        this.vault = vault(this.app);
        this.addSettingTab(new ObsyncSettingTab(this.app, this));
        this.state = Object.assign({}, DEFAULTS, await this.loadData());
        if (!this.state.initialised || !this.state.latestCommit) {
            console.log('not initialised properly', this.state)
            return;
        }
        this.github = await github(this.state.settings);
        this.subscribe();
    }

    debouncedSend = async () => {
        return new Promise<{ [name: string]: string }>((resolve) => {
            if (this.timeout) clearTimeout(this.timeout);
            this.timeout = setTimeout(async () => {
                this.timeout = null;
                const res = await send(this.github, this.state.modifiedFiles, this.state.remote, this.vault);
                resolve(res);
            }, 3 * 1000);
        })
    }

    async onunload() {
        // Release any resources configured by the plugin.
        this.timeout = null;
        this.unsubscribe();
    }

    async update(f: (state: ObsyncState) => ObsyncState) {
        this.state = f(this.state);
        await this.saveData(this.state);
        return this.state;
    }

    async addModifiedFile(file: TAbstractFile) {
        return this.update(s => ({
            ...s,
            modifiedFiles: s.modifiedFiles.some(i => i == file.path) ? s.modifiedFiles : s.modifiedFiles.concat([file.path])
        }));
    }

    unsubscribe() {
        this.app.vault.off('create', this.onCreate);
        this.app.vault.off('modify', this.onModify);
        this.app.vault.off('delete', this.onDelete);
    }

    subscribe() {
        this.registerEvent(this.app.vault.on('create', this.onCreate));
        this.registerEvent(this.app.vault.on('modify', this.onModify));
        this.registerEvent(this.app.vault.on('delete', this.onDelete));
    }

    onCreate = async (file: TAbstractFile) => {
        if (!this.state.initialised) return;
        await this.addModifiedFile(file);
        const res = await this.debouncedSend();
        const latestCommit = await this.github.latestCommit();
        await this.update(s => ({
            ...s,
            latestCommit,
            modifiedFiles: [],
            remote: { ...s.remote, ...res }
        }));
    }

    onModify = async (file: TAbstractFile) => {
        if (!this.state.initialised) return;
        await this.addModifiedFile(file);
        const res = await this.debouncedSend();
        const latestCommit = await this.github.latestCommit();
        await this.update(s => ({
            ...s,
            latestCommit,
            modifiedFiles: [],
            remote: { ...s.remote, ...res }
        }));

    }

    onDelete = (file: TAbstractFile) => {
        if (!this.state.initialised) return;
    }

    async initialise() {
        this.subscribe();
        await this.update(s => ({
            ...s,
            initialised: false,
            latestCommit: '',
            modifiedFiles: []
        }));;
        this.github = await github(this.state.settings);
        const latestCommit = await this.github.latestCommit();

        await this.update(s => ({
            ...s,
            latestCommit
        }));

        const githubFiles = await pullEverything(this.github, this.state.latestCommit);
        if (githubFiles.type === ERR) {
            new Notice(githubFiles.err);
            return;
        }
        for (const file of githubFiles.value) {
            const result = await write(this.vault, file.path, file.content);
            if (result.type === ERR) {
                new Notice(result.err);
            }
        }

        const remote = githubFiles.value.reduce((acc, file) => {
            acc[file.path] = file.sha;
            return acc;
        }, {} as { [path: string]: string });

        this.update(s => ({ ...s, initialised: true, modifiedFiles: [], remote }))
            .then(() => {
                new Notice('initialised! 🎉');
            });
    }
}

class ObsyncSettingTab extends PluginSettingTab {
    plugin: ObsyncPlugin;

    constructor(app: App, plugin: ObsyncPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        new Setting(containerEl)
            .setName('repository owner')
            .setDesc('username of the repository owner')
            .addText(text => text
                .setPlaceholder('owner')
                .setValue(this.plugin.state.settings.owner)
                .onChange(async (value) => {
                    this.plugin.state.settings.owner = value;
                    await this.plugin.saveData(this.plugin.state);
                }));

        new Setting(containerEl)
            .setName('repository name')
            .setDesc('name of the repository')
            .addText(text => text
                .setPlaceholder('repository name')
                .setValue(this.plugin.state.settings.repo)
                .onChange(async (value) => {
                    this.plugin.state.settings.repo = value;
                    await this.plugin.saveData(this.plugin.state);
                }));

        new Setting(containerEl)
            .setName('branch')
            .setDesc('branch to sync with')
            .addText(text => text
                .setPlaceholder('branch name')
                .setValue(this.plugin.state.settings.branch)
                .onChange(async (value) => {
                    this.plugin.state.settings.branch = value;
                    await this.plugin.saveData(this.plugin.state);
                }));

        new Setting(containerEl)
            .setName('private key')
            .setDesc('private key generated for the github app')
            .addTextArea(text => text
                .setPlaceholder('-----BEGIN RSA')
                .setValue(this.plugin.state.settings.rsa)
                .onChange(async (value) => {
                    this.plugin.state.settings.rsa = value;
                    await this.plugin.saveData(this.plugin.state);
                }));

        new Setting(containerEl)
            .setName('Initialise')
            .setDesc('Initialise the plugin')
            .setDisabled(!isSettingsValid(this.plugin.state))
            .addButton(btn => {
                btn.setButtonText('Initialise')
                    .onClick(async () => {
                        if (!isSettingsValid(this.plugin.state)) {
                            new Notice('Please fill in all the settings');
                            return;
                        }
                        await this.plugin.initialise();
                    })
                    .setTooltip('Initialise the plugin. This will pull the latest version of the repository and start listening for changes.');
            });

        new Setting(containerEl)
            .setName('Clear state')
            .setDesc('Clear the state of the plugin')
            .addButton(btn => {
                btn.setButtonText('Clear state')
                    .onClick(async () => {
                        const newState = { ...DEFAULTS, settings: { ...this.plugin.state.settings } };
                        await this.plugin.saveData(newState);
                        this.plugin.state = Object.assign({}, newState);
                        console.log('reset state', this.plugin.state);
                    })
                    .setTooltip('Clear the state of the plugin. This will remove all settings and stop listening for changes.');
            });

        new Setting(containerEl)
            .setName('compute shas')
            .setDesc('compute shas')
            .addButton(btn => {
                btn.setButtonText('compute shas')
                    .onClick(async () => {
                        const files = await this.plugin.app.vault.getMarkdownFiles();
                        for (const file of files) {
                            const content = await this.plugin.vault.read(file.path);
                            if (content.type === NONE) {
                                continue;
                            }
                            const githubContent = await this.plugin.github.getSingle(file.path);
                            const sha1 = this.plugin.github.hash(content.value);
                            console.log({ file, githubContent, sha1 });
                        }
                    })
                    .setTooltip('compute shas');
            });
    }

}