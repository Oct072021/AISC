import fs from 'fs';
import { join, dirname } from 'path';
import { runCommand } from '../common/utils.js';
import { getRemoteFileContent } from '../parseProject/parseRemoteProject.js';

// lock 文件与包管理器的映射
const LOCK_FILE_MAP = {
  'package-lock.json': 'npm',
  'yarn.lock': 'yarn',
  'pnpm-lock.yaml': 'pnpm',
};

// 各包管理器对应的配置文件
const CONFIG_FILES = {
  npm: ['.npmrc'],
  pnpm: ['.npmrc'],
  yarn: ['.npmrc', '.yarnrc', '.yarnrc.yml'],
};

// 统一使用 npm 生成 lock 文件，因为审计阶段固定使用 npm audit，只认 package-lock.json
const LOCK_COMMAND = 'npm install --package-lock-only --force';

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
 * @returns {string|null} 如 'pnpm'、'yarn'、'npm'，或 null
 */
function parsePackageManagerField(packageJson) {
  const field = packageJson.packageManager;
  if (!field || typeof field !== 'string') return null;
  // 格式通常为 "pnpm@8.0.0"
  const name = field.split('@')[0].trim().toLowerCase();
  if (['npm', 'yarn', 'pnpm'].includes(name)) return name;
  return null;
}

/**
 * 检测应使用的包管理器
 * @param {string} projectRoot 项目根目录或 GitHub URL
 * @param {Object} packageJson 解析后的 package.json
 * @param {string|undefined} specifiedPM 调用方指定的包管理器
 * @returns {Promise<string>} 'npm' | 'yarn' | 'pnpm'
 * @throws {Error} 无法确定时抛出描述性错误
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
    // 唯一 lock 文件，直接使用（如果 packageManager 字段也存在且不同，以 lock 文件为准）
    return detected[0];
  }

  if (detected.length === 0) {
    // 无 lock 文件，尝试使用 packageManager 字段
    if (fromField) return fromField;
    // 都没有，抛出错误
    throw new Error(
      '未检测到 lock 文件（package-lock.json / yarn.lock / pnpm-lock.yaml），' +
        '也未在 package.json 中找到 packageManager 字段。\n' +
        '请在调用时通过 packageManager 参数指定使用的包管理器（npm / yarn / pnpm）。'
    );
  }

  // detected.length > 1：多个 lock 文件
  // 如果 packageManager 字段存在且在检测列表中，用它来消歧
  if (fromField && detected.includes(fromField)) {
    return fromField;
  }

  throw new Error(
    `检测到多个 lock 文件：${detected.join('、')}，无法自动确定包管理器。\n` +
      '请在调用时通过 packageManager 参数指定使用的包管理器（npm / yarn / pnpm）。'
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
 */
export async function generateLock(workDir, packageJson, projectRoot, packageManager) {
  // 1. 将 package.json 写入工作目录
  await writePackageJson(workDir, packageJson);
  // 2. 检测包管理器
  const pm = await detectPackageManager(projectRoot, packageJson, packageManager);
  // 3. 复制包管理器配置文件（如 .npmrc）
  await copyRegistryConfig(projectRoot, workDir, pm);
  // 4. 生成 lock 文件（统一用 npm 生成 package-lock.json）
  await createLockFile(workDir);
}
