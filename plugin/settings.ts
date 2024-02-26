import { Repo } from "github";
import ObsyncPlugin, { ObsyncState } from "main";
import { App, Notice, PluginSettingTab, Setting } from "obsidian";

export const isSettingsValid = (state: ObsyncState) => {
    const { settings } = state;
    return settings.owner && settings.repo && settings.rsa;
};

export class ObsyncSettingTab extends PluginSettingTab {
    plugin: ObsyncPlugin;

    constructor(app: App, plugin: ObsyncPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        new Setting(containerEl)
            .setName("repository owner")
            .setDesc("username of the repository owner")
            .addText((text) =>
                text
                    .setPlaceholder("owner")
                    .setValue(this.plugin.state.settings.owner)
                    .onChange(async (value) => {
                        const settings = this.plugin.state.settings;
                        await this.plugin.updateSettings({
                            ...settings,
                            owner: value,
                        });
                    })
            );

        new Setting(containerEl)
            .setName("repository name")
            .setDesc("name of the repository")
            .addText((text) =>
                text
                    .setPlaceholder("repository name")
                    .setValue(this.plugin.state.settings.repo)
                    .onChange(async (value) => {
                        const settings = this.plugin.state.settings;
                        await this.plugin.updateSettings({
                            ...settings,
                            repo: value,
                        });
                    })
            );

        new Setting(containerEl)
            .setName("branch")
            .setDesc("branch to sync with")
            .addText((text) =>
                text
                    .setPlaceholder("branch name")
                    .setValue(this.plugin.state.settings.branch)
                    .onChange(async (value) => {
                        const settings = this.plugin.state.settings;
                        await this.plugin.updateSettings({
                            ...settings,
                            branch: value,
                        });
                    })
            );

        new Setting(containerEl)
            .setName("private key")
            .setDesc("private key generated for the github app")
            .addTextArea((text) =>
                text
                    .setPlaceholder("-----BEGIN RSA")
                    .setValue(this.plugin.state.settings.rsa)
                    .onChange(async (value) => {
                        const settings = this.plugin.state.settings;
                        await this.plugin.updateSettings({
                            ...settings,
                            rsa: value,
                        });
                    })
            );

        new Setting(containerEl)
            .setName("Initialise")
            .setDesc("Initialise the plugin")
            .setDisabled(!isSettingsValid(this.plugin.state))
            .addButton((btn) => {
                btn.setButtonText("Initialise")
                    .onClick(async () => {
                        if (!isSettingsValid(this.plugin.state)) {
                            new Notice("Please fill in all the settings");
                            return;
                        }
                        await this.plugin
                            .initialise()
                            .catch((e) => new Notice(e));
                    })
                    .setTooltip(
                        "Initialise the plugin. This will pull the latest version of the repository and start listening for changes."
                    );
            });

        new Setting(containerEl)
            .setName("Clear state")
            .setDesc("Clear the state of the plugin")
            .addButton((btn) => {
                btn.setButtonText("Clear state")
                    .onClick(async () => {
                        await this.plugin.updateState("", {} as Repo);
                        console.log("reset state", this.plugin.state);
                    })
                    .setTooltip(
                        "Clear the state of the plugin. This will remove all settings and stop listening for changes."
                    );
            });
    }
}
