import { Result, Option } from './func';
import { App, TAbstractFile } from 'obsidian';
import { writeFileSync } from 'fs';
import { join } from 'path';



export type Vault = {
    directory: string;
    getFile: (path: string) => Option<TAbstractFile>;
    modify: (path: string, content: string) => Promise<Result<boolean>>;
    create: (path: string, content: string) => Promise<void>;
    read: (path: string) => Promise<Option<string>>;
    write: (path: string, content: string) => void;
    writeConfig: (path: string, content: string) => Option<boolean>;
}


export function vault(app: App): Vault {

    const directory = (app.vault.adapter as any).basePath as string;

    const getFile = (path: string) => Option.unit(app.vault.getFileByPath(path));

    const write = (path: string, content: string) =>
        writeFileSync(join(directory, path), content, {
            flag: 'w'
        })

    const writeConfig = (path: string, content: string) =>
        Option
            .unit(path.startsWith('.obsidian') ?? null)
            .map(() => writeFileSync(join(directory, path), content, {
                flag: 'w'
            }))
            .map(() => true);

    const modify = (path: string, content: string) =>
        getFile(path)
            .match(
                file => app.vault.process(file, () => content),
                () => Promise.reject(new Error('file not found'))
            )
            .then(() => Result.Ok(true))
            .catch((e) => Result.Err<boolean>(e.message));

    const create = async (path: string, content: string) =>
        getFile(path)
            .match(
                () => app.vault.create(path, content)
                    .then(() => Promise.resolve()),
                () => Promise.resolve()
            );

    const read = (path: string) =>
        getFile(path)
            .match(
                file => app.vault.cachedRead(file),
                () => Promise.resolve<string | null>(null)
            )
            .then(Option.unit);

    return ({
        directory,
        getFile,
        modify,
        create,
        read,
        write,
        writeConfig
    });
}