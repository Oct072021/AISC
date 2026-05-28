import { createWorkDir, deleteWorkDir } from '../workDir/index.js';
import { parseProject } from '../parseProject/index.js';
import { generateLock } from '../generateLock/index.js';
import { audit } from '../audit/index.js';
import { render } from '../render/index.js';
import fs from 'fs';

/**
 * 根据项目根目录，审计项目中所有的包（含项目本身）
 * @param {string} projectRoot 项目根目录，可以是本地目录的绝对路径，也可以是远程仓库的URL
 * @param {string} savePath 保存审计结果的文件名，审计结果是一个标准格式的markdown字符串
 * @param {string} [packageManager] 可选，指定包管理器（npm / yarn）
 */
export async function auditPackage(projectRoot, savePath, packageManager) {
  const start = Date.now();
  const log = (msg) => console.error(`[audit] ${msg} (+${Date.now() - start}ms)`);

  log('步骤1: 创建工作目录 - 开始');
  const workDir = await createWorkDir();
  log('步骤1: 创建工作目录 - 完成');

  log('步骤2: 解析项目 - 开始');
  const packageJson = await parseProject(projectRoot);
  log('步骤2: 解析项目 - 完成');

  log('步骤3: 生成lock文件 - 开始');
  const { reused, nodeVersion } = await generateLock(workDir, packageJson, projectRoot, packageManager);
  log(`步骤3: 生成lock文件 - 完成 (reused=${reused})`);

  log('步骤4: 执行审计 - 开始');
  const auditResult = await audit(workDir, packageJson);
  log('步骤4: 执行审计 - 完成');

  log('步骤5: 渲染结果 - 开始');
  const renderedResult = await render(auditResult, packageJson, { reused, nodeVersion });
  log('步骤5: 渲染结果 - 完成');

  log('步骤6: 清理工作目录 - 开始');
  await deleteWorkDir(workDir);
  log('步骤6: 清理工作目录 - 完成');

  await fs.promises.writeFile(savePath, renderedResult);
  log('全部完成');
}
