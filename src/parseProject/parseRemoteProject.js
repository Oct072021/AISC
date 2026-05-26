/**
 * 解析 GitHub 仓库 URL，提取 owner、repo 和后续路径
 * 支持格式：
 *   - https://github.com/owner/repo
 *   - https://github.com/owner/repo/tree/branch
 *   - https://github.com/owner/repo/blame/...
 *   等等
 *
 * @param {string} url - GitHub 仓库 URL
 * @returns {Object} { owner, repo, path }
 * @throws {Error} 如果 URL 格式不合法或无法解析
 */
function parseGithubUrl(url) {
  try {
    const parsedUrl = new URL(url);

    // 确保是 github.com
    if (parsedUrl.hostname !== 'github.com') {
      throw new Error('Only github.com URLs are supported');
    }

    // 获取路径并去除空字符串（如开头的 /）
    const parts = parsedUrl.pathname.split('/').filter(Boolean);

    // 至少需要 owner 和 repo 两段
    if (parts.length < 2) {
      throw new Error(
        'Invalid GitHub repository URL: insufficient path segments'
      );
    }

    const owner = parts[0];
    const repo = parts[1];
    const restPath = parts.slice(2); // 剩余路径，如 ['tree', 'v5.2.2']

    // 构造 path：如果有后续路径，则以 '/' 开头拼接；否则为空字符串
    const path = restPath.length > 0 ? '/' + restPath.join('/') : '';

    return { owner, repo, path };
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('Invalid URL: malformed or missing');
    }
    throw error;
  }
}

async function getRefPath(gitInfo) {
  let { owner, repo, path } = gitInfo;
  if (path.startsWith('/tree/')) {
    const pathParts = path.split('/').filter(Boolean);
    return { owner, repo, ref: `tags/${pathParts[1]}` };
  } else {
    const url = `https://api.github.com/repos/${owner}/${repo}`;
    const info = await fetch(url).then((resp) => resp.json());
    return { owner, repo, ref: `heads/${info.default_branch}` };
  }
}

function getRawUrl(owner, repo, ref, fileName) {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${fileName}`;
}

/**
 * 获取远程仓库中指定文件的内容
 * @param {string} githubUrl GitHub 仓库 URL
 * @param {string} fileName 文件名，如 '.npmrc'、'yarn.lock'
 * @returns {Promise<string|null>} 文件内容，不存在则返回 null
 */
export async function getRemoteFileContent(githubUrl, fileName) {
  const gitInfo = parseGithubUrl(githubUrl);
  const { owner, repo, ref } = await getRefPath(gitInfo);
  const url = getRawUrl(owner, repo, ref, fileName);
  const resp = await fetch(url);
  if (!resp.ok) return null;
  return await resp.text();
}

export async function parseRemoteProject(githubUrl) {
  const gitInfo = parseGithubUrl(githubUrl);
  const { owner, repo, ref } = await getRefPath(gitInfo);
  const url = getRawUrl(owner, repo, ref, 'package.json');
  return await fetch(url).then((resp) => resp.json());
}
