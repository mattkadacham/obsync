import { App } from "octokit";
import axios from "axios";
import githubAppJwt from "universal-github-app-jwt";
import { createHash, createPrivateKey } from "crypto";
import { Result, Option } from "func";
import { Notice } from "obsidian";

export type GithubClientSettings = {
    owner: string;
    repo: string;
    rsa: string;
    branch: string;
};

export type GFile = { path: string; content: string; sha: string };
export type Modification =
    | { path: string; action: "update" }
    | { path: string; action: "create" }
    | { path: string; action: "delete" }
    | {
          path: string;
          previousPath: string;
          action: "rename";
      };

export type GState = Awaited<ReturnType<typeof githubState>>;
export type Repo = {
    [path: string]: { sha: string; url?: string };
};
export const githubState = async (
    client: GithubClient,
    settings: GithubClientSettings
) => {
    let mods: { [path: string]: Modification } = {};
    let sha = await getRef(client, settings);
    let tree = await getTree(client, settings, sha);

    return {
        sha: () => sha,
        mods: () => mods,
        tree: () => tree,
        create: (path: string) => {
            mods[path] = { path, action: "create" };
        },
        update: (path: string) => {
            mods[path] = { path, action: "update" };
        },
        delete: (path: string) => {
            mods[path] = { path, action: "delete" };
        },
        rename: (path: string, previousPath: string) => {
            mods[path] = { path, action: "create" };
            mods[previousPath] = { path: previousPath, action: "delete" };
        },
        refresh: (sha: string, tree: Repo) => {
            mods = {};
            sha = sha;
            tree = tree;
        },
    };
};

export type Github = {
    state: GState;
    hash: (content: string) => string;
    getFile: (path: string) => Promise<GFile>;
    latestCommit: () => Promise<string>;
    buildTree: (
        getContent: (path: string) => Promise<string>
    ) => Promise<GBlob[]>;
    pull: (prevTree: Repo) => Promise<GFile[]>;
    commit: (tree: GBlob[]) => Promise<{ sha: string; tree: Repo }>;
};

export async function github(
    settings: Readonly<GithubClientSettings>
): Promise<Github> {
    const client = await connect(settings.rsa);
    const state = await githubState(client, settings);
    let q: GBlob[][] = [];

    async function pull(prevTree: Repo) {
        const latest = await getRef(client, settings);
        const tree = await getTree(client, settings, latest);
        const updated = Object.entries(tree).filter(
            ([path, { sha }]) => !prevTree[path] || prevTree[path].sha !== sha
        );
        const res = await Promise.all(
            updated.map(([path]) => getFile(client, settings, path))
        );
        state.refresh(latest, tree);
        return res;
    }

    async function commit(blobs: GBlob[]) {
        if (blobs.length === 0)
            return {
                sha: state.sha(),
                tree: state.tree(),
            };

        if (blobs.length > 0) {
            q.push(blobs);
        }

        const files = q.shift();

        if (!files) {
            return {
                sha: state.sha(),
                tree: state.tree(),
            };
        }

        try {
            const latest = await getRef(client, settings);
            const treeData = await createTree(client, settings, latest, files);
            const newCommit = await createCommit(
                client,
                settings,
                summary(files.map((t) => t.path)),
                treeData.data.sha,
                latest
            );
            await updateRef(client, settings, newCommit.data.sha);
            const tree = await getTree(client, settings, newCommit.data.sha);

            state.refresh(newCommit.data.sha, tree);
            return { sha: newCommit.data.sha, tree };
        } catch (error) {
            // Handle or throw the error appropriately
            throw new Error(`Commit operation failed: ${error.message}`);
        } finally {
            if (q.length > 0) {
                return commit([]);
            }
        }
    }

    return {
        hash: computeSha,
        state,
        getFile: (path: string) => getFile(client, settings, path),
        latestCommit: () => getRef(client, settings),
        commit,
        pull,
        buildTree: (getContent) =>
            buildTree(
                client,
                settings,
                Object.values(state.mods()),
                getContent,
                state.tree()
            ),
    };
}

export function summary(files: string[]): string {
    if (files.length === 0) {
        return "no files";
    }

    if (files.length <= 3) {
        return `updated ${files.join(", ")}`;
    }

    return `updated ${files.slice(0, 3).join(", ")} and ${
        files.length - 3
    } more`;
}

const getInstallation = async (owner: string, repo: string, token: string) => {
    const headers = {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
    };

    try {
        const repoInstallationResponse = await axios.get(
            `https://api.github.com/repos/${owner}/${repo}/installation`,
            { headers }
        );
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
        })
        .toString();
    const { token, appId, expiration } = await githubAppJwt({
        id: 839018,
        privateKey: privateKeyPkcs8,
    });

    const installation = await getInstallation(
        "mattkadacham",
        "test-vault",
        token
    );
    const installationId = installation.id;

    const app = new App({ appId, privateKey: privateKeyPkcs8 });
    const data = await app.octokit.rest.apps.getAuthenticated();
    const octokit = await app.getInstallationOctokit(installationId);

    return octokit;
};

export const getFile = async (
    client: GithubClient,
    settings: GithubClientSettings,
    path: string
): Promise<GFile> => {
    const content = await client.rest.repos.getContent({
        owner: settings.owner,
        repo: settings.repo,
        ref: settings.branch || "main",
        path,
    });

    if (Array.isArray(content.data) || content.data.type !== "file") {
        return Promise.reject(
            `wrong content type! ${(content.data as any).type}`
        );
    }

    return {
        path: content.data.path,
        content: atob(content.data.content),
        sha: content.data.sha,
    };
};

export const getContentRecursive = async (
    client: GithubClient,
    settings: GithubClientSettings,
    path: string
) => {
    const content = await client.rest.repos.getContent({
        owner: settings.owner,
        repo: settings.repo,
        ref: settings.branch || "main",
        path,
        recursive: "true",
    });

    if (!content.data) {
        console.log("no content found", content);
        return [];
    }

    const data = content.data;

    if (Array.isArray(data)) {
        let fileContent: { path: string; content: string; sha: string }[] = [];
        for (const file of data) {
            const c = await getContentRecursive(client, settings, file.path);
            fileContent = fileContent.concat(c);
        }
        return fileContent;
    }

    if (!Array.isArray(content.data) && content.data?.type === "file") {
        return [
            {
                path: content.data.path,
                content: atob(content.data.content),
                sha: content.data.sha,
            },
        ];
    }

    throw new Error("Unknown content type");
};

export const getRef = async (
    client: GithubClient,
    settings: GithubClientSettings
) => {
    const { owner, repo, branch } = settings;
    const {
        data: {
            object: { sha: latestCommitSha },
        },
    } = await client.rest.git.getRef({
        owner,
        repo,
        ref: `heads/${branch}`,
    });

    return latestCommitSha;
};

export const updateRef = async (
    client: GithubClient,
    settings: GithubClientSettings,
    sha: string
) => {
    const { owner, repo, branch } = settings;
    return client.rest.git.updateRef({
        owner,
        repo,
        ref: `heads/${branch}`,
        sha,
    });
};

export const getTree = async (
    client: GithubClient,
    settings: GithubClientSettings,
    latestCommitSha: string
) => {
    const { owner, repo } = settings;
    // Get the tree associated with the latest commit
    const {
        data: { tree: baseTree },
    } = await client.rest.git.getTree({
        owner,
        repo,
        tree_sha: latestCommitSha,
        recursive: "true",
    });

    return baseTree.reduce((accumulated, item) => {
        // Include only items that are not directories ('tree' type in GitHub API)
        if (item.type !== "tree" && item.path && item.sha) {
            accumulated[item.path] = { sha: item.sha, url: item.url };
        }
        return accumulated;
    }, {} as Repo);
};

export const getCommit = async (
    client: GithubClient,
    settings: GithubClientSettings,
    parentSha: string
) => {
    const { owner, repo } = settings;
    const {
        data: { tree: baseTree },
    } = await client.rest.git.getCommit({
        owner,
        repo,
        commit_sha: parentSha,
    });

    return baseTree;
};

export type GBlob = {
    path: string;
    mode: "100644";
    type: "blob";
    sha: string | null;
};

const createTreeItem = (path: string, sha: string | null) => ({
    path,
    mode: "100644" as const,
    type: "blob" as const,
    sha,
});

export const buildTree = async (
    client: GithubClient,
    settings: GithubClientSettings,
    files: Modification[],
    getContent: (path: string) => Promise<string>,
    repo: Repo
): Promise<GBlob[]> => {
    const t = [];

    for (const mod of files) {
        let sha;
        let content;
        switch (mod.action) {
            case "create":
            case "update":
                content = await getContent(mod.path);
                sha = await createBlob(client, settings, content);
                if (computeSha(content) !== repo[mod.path]?.sha) {
                    t.push(createTreeItem(mod.path, sha));
                }
                break;
            case "delete":
                t.push(createTreeItem(mod.path, null));
                break;
            case "rename":
                // should be handled by create and delete
                break;
            default:
                throw new Error(
                    `Unknown modification action: ${(mod as any).action}`
                );
        }
    }

    return t;
};

export const createBlob = async (
    client: GithubClient,
    settings: GithubClientSettings,
    content: string
) => {
    const { owner, repo } = settings;
    const blobData = await client.rest.git.createBlob({
        owner,
        repo,
        content,
        encoding: "utf-8",
    });

    return blobData.data.sha;
};

export const createTree = async (
    client: GithubClient,
    settings: GithubClientSettings,
    baseTree: string,
    fileBlobs: GBlob[]
) => {
    const { owner, repo } = settings;
    return client.rest.git.createTree({
        owner,
        repo,
        base_tree: baseTree,
        tree: fileBlobs,
    });
};

export const createCommit = async (
    client: GithubClient,
    settings: GithubClientSettings,
    message: string,
    baseTree: string,
    parentSha: string
) => {
    const { owner, repo, branch } = settings;
    return client.rest.git.createCommit({
        owner,
        repo,
        message,
        tree: baseTree,
        parents: [parentSha],
    });
};

export function computeSha(content: string): string {
    // Create the Git blob format header
    const header = `blob ${content.length}\0`;

    // Concatenate the header and the original content
    const store = Buffer.concat([
        Buffer.from(header, "utf-8"),
        Buffer.from(content),
    ]);

    // Compute the SHA-1 hash
    const sha1 = createHash("sha1").update(store).digest("hex");

    return sha1;
}
