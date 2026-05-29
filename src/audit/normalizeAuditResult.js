import { getDepChains } from './getDepChain.js';
import { npm7Strategy } from './strategies/npm7Strategy.js';
import { npm6Strategy } from './strategies/npm6Strategy.js';

// 策略列表，按优先级排列
// 如果日后出现新的 audit JSON 格式，只需新增策略文件并在此注册
const strategies = [npm7Strategy, npm6Strategy];

/**
 * 根据 audit 原始数据自动选择解析策略
 * @param {Object} auditResult npm audit --json 的原始输出
 * @returns {Object} 匹配的策略对象（包含 detect 和 parse 方法）
 * @throws {Error} 无法识别格式时抛出错误
 */
function selectStrategy(auditResult) {
  const strategy = strategies.find((s) => s.detect(auditResult));
  if (!strategy) {
    throw new Error(
      '无法识别 npm audit 输出格式，可能是不支持的 npm 版本。\n' +
        '当前支持的格式：npm 6（advisories）、npm 7+（vulnerabilities）。'
    );
  }
  return strategy;
}

function _normalizeVulnerabilities(unifiedResult) {
  const result = {
    critical: [],
    high: [],
    moderate: [],
    low: [],
  };
  for (const key in unifiedResult.vulnerabilities) {
    const packageInfo = unifiedResult.vulnerabilities[key];
    const normalizedPackage = _normalizePackage(packageInfo, unifiedResult);
    if (normalizedPackage) {
      result[normalizedPackage.severity].push(normalizedPackage);
    }
  }
  return result;

  function _normalizePackage(packageInfo, unifiedResult) {
    const { via = [] } = packageInfo;
    const validVia = via.filter((it) => typeof it === 'object');
    if (validVia.length === 0) {
      return null;
    }
    const info = {
      name: packageInfo.name,
      severity: packageInfo.severity,
      problems: validVia,
      nodes: packageInfo.nodes || [],
    };
    info.depChains = getDepChains(packageInfo, unifiedResult.vulnerabilities);
    return info;
  }
}

/**
 * 规范化审计结果
 * 自动识别 npm audit 输出格式（npm 6 / npm 7+），转换为统一的内部结构
 * @param {Object} auditResult npm audit --json 的原始输出
 * @returns {Object} 规范化后的审计结果
 */
export function normalizeAuditResult(auditResult) {
  // 1. 自动选择解析策略
  const strategy = selectStrategy(auditResult);
  // 2. 将原始数据转换为统一格式
  const unifiedResult = strategy.parse(auditResult);
  // 3. 规范化为最终输出
  return {
    vulnerabilities: _normalizeVulnerabilities(unifiedResult),
  };
}
