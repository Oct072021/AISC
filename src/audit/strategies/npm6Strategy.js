/**
 * npm 6 审计结果解析策略
 * 适用于 npm 6（Node 10 ~ 14）的 `npm audit --json` 输出
 * 顶层字段为 advisories，key 为 advisory ID
 */

const SEVERITY_LEVELS = {
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};

/**
 * 比较两个 severity，返回更高的那个
 */
function higherSeverity(a, b) {
  return (SEVERITY_LEVELS[a] || 0) >= (SEVERITY_LEVELS[b] || 0) ? a : b;
}

export const npm6Strategy = {
  /**
   * 检测是否为 npm 6 格式
   */
  detect(auditResult) {
    return !!auditResult.advisories;
  },

  /**
   * 将 npm 6 的 advisories 格式转换为 npm 7+ 的 vulnerabilities 统一格式
   */
  parse(auditResult) {
    const vulnerabilities = {};

    for (const [id, advisory] of Object.entries(auditResult.advisories)) {
      const name = advisory.module_name;

      // 同一个包可能有多个 advisory，合并到同一个 vulnerability 中
      if (!vulnerabilities[name]) {
        vulnerabilities[name] = {
          name,
          severity: advisory.severity,
          via: [],
          effects: [],
          nodes: [],
        };
      }

      // 将 advisory 转为 npm 7+ 的 via 对象格式
      vulnerabilities[name].via.push({
        source: advisory.id,
        name: advisory.module_name,
        dependency: advisory.module_name,
        title: advisory.title,
        url: advisory.url,
        severity: advisory.severity,
        cwe: advisory.cwe,
        cvss: advisory.cvss,
        range: advisory.vulnerable_versions,
      });

      // 从 findings 中提取 nodes（依赖路径）
      if (advisory.findings) {
        for (const finding of advisory.findings) {
          const paths = finding.paths || [];
          for (const p of paths) {
            // npm 6 的 path 格式为 "a>b>c"，转换为 "node_modules/a/node_modules/b/node_modules/c"
            const nodePath = `node_modules/${p.split('>').join('/node_modules/')}`;
            if (!vulnerabilities[name].nodes.includes(nodePath)) {
              vulnerabilities[name].nodes.push(nodePath);
            }
          }
        }
      }

      // 更新 severity 为最高级别
      vulnerabilities[name].severity = higherSeverity(
        vulnerabilities[name].severity,
        advisory.severity
      );
    }

    return { vulnerabilities };
  },
};
