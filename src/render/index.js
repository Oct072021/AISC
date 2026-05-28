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
 * @param {string|null} options.nodeVersion 未复用时使用的 Node 版本
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
