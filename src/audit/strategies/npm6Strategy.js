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

    // 确保节点存在；漏洞包会有完整信息，中间节点为合成节点（via 为空，仅用于图遍历）
    function ensureNode(name) {
      if (!vulnerabilities[name]) {
        vulnerabilities[name] = { name, severity: 'info', via: [], effects: [], nodes: [] };
      }
    }

    for (const [id, advisory] of Object.entries(auditResult.advisories)) {
      const name = advisory.module_name;
      ensureNode(name);

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

      // 从 findings 中提取 nodes 并重建 effects 图
      // npm 6 path 格式为 "a>b>c"，表示 a 依赖 b，b 依赖 c（c 为漏洞包）
      // 因此 c.effects 应包含 b，b.effects 应包含 a，以此类推
      if (advisory.findings) {
        for (const finding of advisory.findings) {
          for (const p of (finding.paths || [])) {
            // 转换为 node_modules 路径记录到 nodes
            const nodePath = `node_modules/${p.split('>').join('/node_modules/')}`;
            if (!vulnerabilities[name].nodes.includes(nodePath)) {
              vulnerabilities[name].nodes.push(nodePath);
            }

            // 重建 effects：segments[i] 被 segments[i-1] 依赖，故 segments[i].effects 加入 segments[i-1]
            const segments = p.split('>');
            for (let i = 0; i < segments.length; i++) {
              ensureNode(segments[i]);
              if (i > 0) {
                const child = segments[i];
                const parent = segments[i - 1];
                if (!vulnerabilities[child].effects.includes(parent)) {
                  vulnerabilities[child].effects.push(parent);
                }
              }
            }
          }
        }
      }

      // 更新 severity 为最高级别（同一个包可能有多个 advisory）
      vulnerabilities[name].severity = higherSeverity(
        vulnerabilities[name].severity,
        advisory.severity
      );
    }

    return { vulnerabilities };
  },
};
