---
name: office-spreadsheet-skill
description: 基于 1300+ 公共办公资产和版本化业务标准，选择、改造或生成可直接使用的办公表格，并执行质量门禁。
---

# 办公表格 Skill

## 适用场景

当用户要求查找、制作、改造或补充办公表格时使用。本 Skill 不是自由发挥的表格 Agent；所有交付都必须来自公共资产或已版本化的公共业务标准。

## 固定决策顺序

1. 读取用户需求中的业务对象、行业、使用角色、必需字段和监管属性。
2. 调用同一核心引擎：`pnpm --silent skill:resolve -- --request <request.json> [--output <result.xlsx>]`。
3. 按 `decision` 执行：
   - `direct_asset`：使用 `next_action.public_id` 下载公共成品；不要重新生成。
   - `adapt_asset`：交付引擎基于最相近且适用资产改造的 XLSX。
   - `generate_from_standard`：交付引擎基于版本化业务标准生成且质量门禁通过的 XLSX。
   - `clarify`：原样向用户询问 `clarification.question`；不得猜测。
   - `draft`：只能在用户允许草案时交付，并保留工作簿中的草案边界说明。
   - `refuse`：说明缺少可靠依据或质量门禁未通过；不得绕过。
4. 交付时说明来源模式、公共资产 ID（如有）、标准版本和质量门禁结果。

## 请求文件

```json
{
  "query": "做一份项目风险登记表",
  "industry": "通用项目管理",
  "required_fields": ["风险事项", "责任人", "整改期限"],
  "roles": ["项目经理"],
  "regulated": false,
  "allow_draft": false
}
```

只允许上述字段。不能把数据库连接、SecretKey、API Key、兑换码或其他秘密写入请求文件、提示词、Skill 文件、日志或 Git。

## 质量边界

- 改造和生成必须通过结构、必填字段、流程、公式安全、打印设置和 Excel/WPS/LibreOffice 兼容性基础检查。
- 受监管需求没有可核验的现行标准时必须澄清或拒绝。
- 新资产只能先形成标准升级候选；未经人工批准、回归通过和回滚版本绑定，不得自动替换现行标准。
- 企业私有资产、企业字段和企业审批规则不属于公共 Skill 范围。
