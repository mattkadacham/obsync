import { App } from "octokit";
import axios from "axios";
import githubAppJwt from "universal-github-app-jwt";
import { createHash, createPrivateKey } from 'crypto';
import { ERR, Result, Option } from "func";

export type GithubClientSettings = {
    owner: string;
    repo: string;
    rsa: string;
    branch: string;
}


export type GFile = { path: string, content: string, sha: string };
export type Github = {
    // client: GithubClient;
    hash: (content: string) => string;
    getSingle: (path: string) => Promise<Result<GFile>>;
    getAll: (path: string) => Promise<Result<GFile[]>>;
    rootContent: (commit: string) => Promise<Option<GFile[]>>;
    latestCommit: () => Promise<string>;
    createOrUpdate: (path: string, content: string, sha: string) => Promise<Result<string>>;
}

export async function github(settings: Readonly<GithubClientSettings>): Promise<Github> {
    const client = await connect(settings.rsa);


    const getSingle: Github['getSingle'] = async (path: string) => {
        const files = await client.rest.repos.getContent({
            owner: settings.owner,
            repo: settings.repo,
            ref: settings.branch || 'main',
            path
        });

        if (Array.isArray(files.data) || files.data.type !== 'file') {
            return Result.Err<GFile>(`file not found at ${path}`);
        }

        return Result.Ok({ path: files.data.path, content: atob(files.data.content), sha: files.data.sha });
    }

    const getAll: Github['getAll'] = async (path: string) => {
        return getContent(client, settings, path)
            .then(Result.Ok)
            .catch(e => Result.Err<GFile[]>(e.message));
    }

    const rootContent: Github['rootContent'] = async (commit: string) => {
        const files = await client.rest.repos.getContent({
            owner: settings.owner,
            repo: settings.repo,
            ref: commit,
            path: ''
        });

        if (Array.isArray(files.data)) {
            return Option.Some<GFile[]>(files.data.map(f => ({ path: f.path, content: atob(f.content ?? ""), sha: f.sha })));
        }

        return Option.None<GFile[]>();
    }

    const latestCommit = async () => {
        const branch = await client.rest.repos.getBranch({
            owner: settings.owner,
            repo: settings.repo,
            branch: settings.branch || 'main'
        });

        return branch.data.commit.sha;
    }

    const createOrUpdate = async (path: string, content: string, sha: string) => {
        return client.rest.repos.createOrUpdateFileContents({
            owner: settings.owner,
            repo: settings.repo,
            path,
            message: `updated ${path}`,
            content: Buffer.from(content).toString('base64'),
            branch: settings.branch || 'main',
            sha: sha || undefined
        })
            .then((i) => Result.Ok(i.data.content?.sha || ''))
            .catch(e => Result.Err<string>(e.message));
    }

    return {
        hash: computeGitSha1,
        getSingle,
        getAll,
        rootContent,
        latestCommit,
        createOrUpdate
    }
}

const getInstallation = async (owner: string, repo: string, token: string) => {
    const headers = {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
    };

    try {
        const repoInstallationResponse = await axios.get(`https://api.github.com/repos/${owner}/${repo}/installation`, { headers });
        return repoInstallationResponse.data;
    } catch (error) {
        console.error(`Error: ${error}`);
    }
};

export type GithubClient = Awaited<ReturnType<typeof connect>>;

export const connect = async (rsa: string) => {
    const privateKeyPkcs8 = createPrivateKey(rsa)
        .export({
            type: "pkcs8",
            format: "pem",
        }).toString();
    const { token, appId, expiration } = await githubAppJwt({
        id: 839018,
        privateKey: privateKeyPkcs8,
    });

    const installation = await getInstallation('mattkadacham', 'test-vault', token);
    const installationId = installation.id;

    const app = new App({ appId, privateKey: privateKeyPkcs8 });
    const data = await app.octokit.rest.apps.getAuthenticated();
    const octokit = await app.getInstallationOctokit(installationId);


    return octokit;
}

export const getRootContent = async (client: GithubClient, settings: GithubClientSettings, latestCommit: string) => {
    const files = await client.rest.repos.getContent({
        owner: settings.owner,
        repo: settings.repo,
        ref: latestCommit,
        path: ''
    });

    const data = files.data;

    if (!Array.isArray(data)) {
        console.log('no files found', data);
        return [];
    }

    return data;
}


function computeGitSha1(content: string): string {

    // Create the Git blob format header
    const header = `blob ${content.length}\0`;

    // Concatenate the header and the original content
    const store = Buffer.concat([
        Buffer.from(header, 'utf-8'),
        Buffer.from(content)
    ]);

    // Compute the SHA-1 hash
    const sha1 = createHash('sha1').update(store).digest('hex');

    return sha1;
}

export const getContent = async (client: GithubClient, settings: GithubClientSettings, path: string) => {
    const content = await client.rest.repos.getContent({
        owner: settings.owner,
        repo: settings.repo,
        ref: settings.branch || 'main',
        path
    });

    if (!content.data) {
        console.log('no content found', content);
        return [];
    }

    const data = content.data;

    if (Array.isArray(data)) {
        let fileContent: { path: string, content: string, sha: string }[] = [];
        for (const file of data) {
            const c = await getContent(client, settings, file.path);
            fileContent = fileContent.concat(c);
        }
        return fileContent;
    }

    if (!Array.isArray(content.data) && content.data?.type === 'file') {
        return [{ path: content.data.path, content: atob(content.data.content), sha: content.data.sha }];
    }

    throw new Error('Unknown content type')
}
