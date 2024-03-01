import { Result, Option } from "./func";
import { App, TAbstractFile, normalizePath } from "obsidian";

export type Vault = {
    directory: string;
    getFile: (path: string) => Option<TAbstractFile>;
    modify: (path: string, content: string) => Promise<Result<boolean>>;
    create: (path: string, content: string) => Promise<void>;
    read: (path: string) => Promise<Option<string>>;
    write: (path: string, content: string) => void;
    writeConfig: (path: string, content: string) => Promise<boolean>;
};

export function vault(app: App): Vault {
    const directory = (app.vault.adapter as any).basePath as string;

    const getFile = (path: string) => {
        const res = app.vault.getFileByPath(path);
        return Option.unit(res);
    };

    const write = async (path: string, content: string) => {
        await app.vault.adapter.write(normalizePath(path), content);
    };

    const writeConfig = async (path: string, content: string) => {
        if (path.startsWith(".obsidian")) {
            await write(path, content);
            return true;
        }
        return false;
    };

    const modify = async (path: string, content: string) => {
        const res = await getFile(path)
            .match(
                (file) => app.vault.process(file, () => content),
                () => Promise.reject(new Error("file not found"))
            )
            .then(() => Result.Ok(true))
            .catch((e) => Result.Err<boolean>(e.message));
        return res;
    };

    const create = async (path: string, content: string) => {
        await app.vault.create(path, content);
    };

    const read = (path: string) =>
        getFile(path)
            .match(
                (file) => app.vault.cachedRead(file),
                () => Promise.resolve<string | null>(null)
            )
            .then(Option.unit);

    return {
        directory,
        getFile,
        modify,
        create,
        read,
        write,
        writeConfig,
    };
}
