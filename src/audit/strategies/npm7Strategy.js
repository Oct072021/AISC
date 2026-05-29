/**
 * npm 7+ 审计结果解析策略
 * 适用于 npm 7、8、9、10 等版本的 `npm audit --json` 输出
 * 顶层字段为 vulnerabilities，key 为包名
 */
export const npm7Strategy = {
  /**
   * 检测是否为 npm 7+ 格式
   */
  detect(auditResult) {
    return !!auditResult.vulnerabilities;
  },

  /**
   * npm 7+ 格式本身就是统一格式，直接返回
   */
  parse(auditResult) {
    return auditResult;
  },
};
