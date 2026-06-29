// [devkit] 泄露缺失文件补全：CustomSelect 的 Select 组件空实现 + OptionWithDescription 类型占位
// （CustomSelect 组件库泄露缺失；仅 MCP/ManagedSettings 等 dialog 懒加载，主路径不触发）
export type OptionWithDescription<T = any> = any
export const Select: any = null
