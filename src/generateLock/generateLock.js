// TODO: 支持 Docker 方案，在指定 Node 版本的容器中执行 npm install 和 npm audit，
//       确保依赖解析结果与项目实际环境一致。
// TODO: 使用策略模式分别解析不同的 lock 文件（package-lock.json / yarn.lock / pnpm-lock.yaml），
//       替代当前统一转换为 package-lock.json 的方式。

import fs from 'fs';
import { join, dirname } from 'path';
import { runCommand } from '../common/utils.js';
import { getRemoteFileContent } from '../parseProject/parseRemoteProject.js';

// lock 文件与包管理器的映射（暂不支持 pnpm）
const LOCK_FILE_MAP = {
  'package-lock.json': 'npm',
  'yarn.lock': 'yarn',
};

// 各包管理器对应的配置文件
const CONFIG_FILES = {
  npm: ['.npmrc'],
  yarn: ['.npmrc', '.yarnrc', '.yarnrc.yml'],
};

// 统一使用 npm 生成 lock 文件，因为审计阶段固定使用 npm audit，只认 package-lock.json
const LOCK_COMMAND = 'npm install --package-lock-only --force';

// lockfileVersion 所需的最低 npm 主版本号（新增版本时只需在此追加）
const MIN_NPM_MAJOR = {
  1: 1,
  2: 7,
  3: 7,
};

/**
 * 判断项目是本地还是远程
 */
function isRemoteProject(projectRoot) {
  return (
    projectRoot.startsWith('http://') || projectRoot.startsWith('https://')
  );
}

/**
 * 检测本地项目存在哪些 lock 文件
 * @returns {string[]} 检测到的包管理器列表，如 ['npm', 'yarn']
 */
function detectLocalLockFiles(projectRoot) {
  const detected = [];
  for (const [lockFile, pm] of Object.entries(LOCK_FILE_MAP)) {
    if (fs.existsSync(join(projectRoot, lockFile))) {
      detected.push(pm);
    }
  }
  return detected;
}

/**
 * 检测远程项目存在哪些 lock 文件
 * @returns {Promise<string[]>} 检测到的包管理器列表
 */
async function detectRemoteLockFiles(projectRoot) {
  const detected = [];
  const checks = Object.entries(LOCK_FILE_MAP).map(
    async ([lockFile, pm]) => {
      const content = await getRemoteFileContent(projectRoot, lockFile);
      if (content !== null) {
        detected.push(pm);
      }
    }
  );
  await Promise.all(checks);
  return detected;
}

/**
 * 从 package.json 的 packageManager 字段解析包管理器名称
 * @returns {string|null} 如 'yarn'、'npm'，或 null
 */
function parsePackageManagerField(packageJson) {
  const field = packageJson.packageManager;
  if (!field || typeof field !== 'string') return null;
  // 格式通常为 "yarn@3.0.0"
  const name = field.split('@')[0].trim().toLowerCase();
  if (['npm', 'yarn'].includes(name)) return name;
  return null;
}

/**
 * 检测应使用的包管理器
 * @param {string} projectRoot 项目根目录或 GitHub URL
 * @param {Object} packageJson 解析后的 package.json
 * @param {string|undefined} specifiedPM 调用方指定的包管理器
 * @returns {Promise<string>} 'npm' | 'yarn'
 * @throws {Error} 多个 lock 文件且无法消歧时抛出错误
 */
async function detectPackageManager(projectRoot, packageJson, specifiedPM) {
  // 1. 调用方明确指定，直接使用
  if (specifiedPM) return specifiedPM;

  // 2. 检查 package.json 的 packageManager 字段
  const fromField = parsePackageManagerField(packageJson);

  // 3. 检测 lock 文件
  const isRemote = isRemoteProject(projectRoot);
  const detected = isRemote
    ? await detectRemoteLockFiles(projectRoot)
    : detectLocalLockFiles(projectRoot);

  // 4. 分析结果
  if (detected.length === 1) {
    return detected[0];
  }

  if (detected.length === 0) {
    // 无 lock 文件，尝试使用 packageManager 字段，否则默认 npm
    return fromField || 'npm';
  }

  // detected.length > 1：多个 lock 文件
  // 如果 packageManager 字段存在且在检测列表中，用它来消歧
  if (fromField && detected.includes(fromField)) {
    return fromField;
  }

  throw new Error(
    `检测到多个 lock 文件：${detected.join('、')}，无法自动确定包管理器。\n` +
      '请在调用时通过 packageManager 参数指定使用的包管理器（npm / yarn）。'
  );
}

/**
 * 复制/获取包管理器配置文件到工作目录
 */
async function copyRegistryConfig(projectRoot, workDir, pm) {
  const isRemote = isRemoteProject(projectRoot);
  const configFiles = CONFIG_FILES[pm] || ['.npmrc'];

  for (const configFile of configFiles) {
    try {
      if (isRemote) {
        const content = await getRemoteFileContent(projectRoot, configFile);
        if (content !== null) {
          await fs.promises.writeFile(join(workDir, configFile), content, 'utf8');
        }
      } else {
        const srcPath = join(projectRoot, configFile);
        if (fs.existsSync(srcPath)) {
          await fs.promises.copyFile(srcPath, join(workDir, configFile));
        }
      }
    } catch {
      // 配置文件不存在或无法读取，静默跳过
    }
  }
}

/**
 * 尝试复用项目已有的 package-lock.json
 * @returns {Promise<boolean>} 是否成功复用
 */
async function copyExistingLockFile(projectRoot, workDir) {
  const isRemote = isRemoteProject(projectRoot);
  const lockFileName = 'package-lock.json';

  try {
    if (isRemote) {
      const content = await getRemoteFileContent(projectRoot, lockFileName);
      if (content !== null) {
        await fs.promises.writeFile(join(workDir, lockFileName), content, 'utf8');
        return true;
      }
    } else {
      const srcPath = join(projectRoot, lockFileName);
      if (fs.existsSync(srcPath)) {
        await fs.promises.copyFile(srcPath, join(workDir, lockFileName));
        return true;
      }
    }
  } catch {
    // 复制失败，退化为生成
  }
  return false;
}

/**
 * 尝试复制 yarn.lock 到工作目录（供 npm install 参考）
 * @returns {Promise<boolean>} 是否成功复制
 */
async function copyYarnLockFile(projectRoot, workDir) {
  const isRemote = isRemoteProject(projectRoot);
  const lockFileName = 'yarn.lock';

  try {
    if (isRemote) {
      const content = await getRemoteFileContent(projectRoot, lockFileName);
      if (content !== null) {
        await fs.promises.writeFile(join(workDir, lockFileName), content, 'utf8');
        return true;
      }
    } else {
      const srcPath = join(projectRoot, lockFileName);
      if (fs.existsSync(srcPath)) {
        await fs.promises.copyFile(srcPath, join(workDir, lockFileName));
        return true;
      }
    }
  } catch {
    // 复制失败
  }
  return false;
}

// 写入 package.json
async function writePackageJson(workDir, packageJson) {
  const packageJsonPath = join(workDir, 'package.json');
  fs.mkdirSync(dirname(packageJsonPath), { recursive: true });
  await fs.promises.writeFile(
    packageJsonPath,
    JSON.stringify(packageJson),
    'utf8'
  );
}

// 创建 lock 文件（统一使用 npm，确保生成 package-lock.json 供 npm audit 使用）
async function createLockFile(workDir) {
  await runCommand(LOCK_COMMAND, workDir);
}

/**
 * 生成 lock 文件
 * @param {string} workDir 工作目录
 * @param {Object} packageJson 解析后的 package.json
 * @param {string} projectRoot 原项目根目录或 GitHub URL
 * @param {string} [packageManager] 可选，指定包管理器
 * @returns {Promise<{reused: boolean, nodeVersion: string, npmVersion: string, incompatible: boolean, lockfileVersion: number|null}>}
 *   reused: 是否复用了项目已有的 lock 文件
 *   nodeVersion: 当前 Node 版本
 *   npmVersion: 当前 npm 版本
 *   incompatible: 复用的 lock 文件是否因 lockfileVersion 不兼容而被丢弃
 *   lockfileVersion: 复用的 lock 文件的 lockfileVersion（不兼容时有值）
 */
export async function generateLock(workDir, packageJson, projectRoot, packageManager) {
  // 1. 将 package.json 写入工作目录
  await writePackageJson(workDir, packageJson);
  // 2. 检测包管理器
  const pm = await detectPackageManager(projectRoot, packageJson, packageManager);
  // 3. 复制包管理器配置文件（如 .npmrc）
  await copyRegistryConfig(projectRoot, workDir, pm);

  // 获取当前环境的 npm 版本（所有场景都需要）
  const npmVersion = (await runCommand('npm -v', workDir)).trim();

  // 4. 尝试直接复用已有的 package-lock.json
  const reused = await copyExistingLockFile(projectRoot, workDir);
  if (reused) {
    // 检查 lockfileVersion 兼容性
    const compat = await checkLockFileCompatibility(workDir, npmVersion);
    if (!compat.compatible) {
      // 不兼容，删除 lock 文件，回退到重新生成
      await fs.promises.unlink(join(workDir, 'package-lock.json'));
      if (pm === 'yarn') {
        await copyYarnLockFile(projectRoot, workDir);
      }
      await createLockFile(workDir);
      return {
        reused: false,
        nodeVersion: process.version,
        npmVersion,
        incompatible: true,
        lockfileVersion: compat.lockfileVersion,
      };
    }
    return { reused: true, nodeVersion: process.version, npmVersion, incompatible: false, lockfileVersion: null };
  }

  // 5. 如果是 yarn 项目，先复制 yarn.lock，npm install 时会参考它来生成 package-lock.json
  if (pm === 'yarn') {
    await copyYarnLockFile(projectRoot, workDir);
  }

  // 6. 使用当前环境的 npm 生成 package-lock.json
  await createLockFile(workDir);
  return { reused: false, nodeVersion: process.version, npmVersion, incompatible: false, lockfileVersion: null };
}

/**
 * 检查已复制的 package-lock.json 的 lockfileVersion 是否与当前 npm 版本兼容
 * - lockfileVersion 1: 兼容所有 npm 版本
 * - lockfileVersion 2/3: 需要 npm 7+
 * @param {string} workDir 工作目录
 * @param {string} npmVersion 当前 npm 版本字符串
 * @returns {Promise<{compatible: boolean, lockfileVersion: number|null}>}
 */
async function checkLockFileCompatibility(workDir, npmVersion) {
  try {
    const lockContent = await fs.promises.readFile(join(workDir, 'package-lock.json'), 'utf8');
    const lockJson = JSON.parse(lockContent);
    const lockfileVersion = lockJson.lockfileVersion || 1;
    const npmMajor = parseInt(npmVersion.split('.')[0], 10);

    // lockfileVersion 2/3 需要 npm 7+
    const minMajor = MIN_NPM_MAJOR[lockfileVersion] ?? 7;
    if (npmMajor < minMajor) {
      return { compatible: false, lockfileVersion };
    }
    return { compatible: true, lockfileVersion };
  } catch {
    // 无法读取或解析，视为兼容（后续 npm audit 会报错）
    return { compatible: true, lockfileVersion: null };
  }
}
