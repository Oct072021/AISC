import { renderMarkdown } from './markdown.js';

const desc = {
  severityLevels: {
    low: '低危',
    moderate: '中危',
    high: '高危',
    critical: '严重',
  },
};

/**
 * 将auditResult渲染为markdown格式的字符串
 * @param {object} auditResult 规范化的审计结果
 * @param {object} packageJson 包的package.json内容
 * @param {object} options 额外选项
 * @param {boolean} options.reused 是否复用了项目已有的 lock 文件
 * @param {string} options.nodeVersion 当前 Node 版本
 * @param {string} options.npmVersion 当前 npm 版本
 * @param {boolean} options.incompatible 复用的 lock 文件是否因 lockfileVersion 不兼容而被丢弃
 * @param {number|null} options.lockfileVersion 不兼容时的 lockfileVersion
 */
export async function render(auditResult, packageJson, options = {}) {
  const data = {
    audit: auditResult,
    desc,
    packageJson,
    options,
  };
  return await renderMarkdown(data);
}
