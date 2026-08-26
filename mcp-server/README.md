# dialogue-editor MCP Server

让 AI Agent 通过 MCP 操作对话工程文件（`.dialogue.json`）：增删改节点、连线、
校验图结构、批量构建对话子图、导出引擎用 GML。

与编辑器共享同一套核心逻辑（`projectFile` / `graphOps` / `editorLogic`），
Agent 的产物与手工操作完全一致；黄金文件回归测试保证生成器行为不漂移。

## 构建

```powershell
cd mcp-server
npm install
npm run build        # 产出 dist/index.js（单文件 bundle）
npm test             # 回归测试（含真实工程黄金文件逐字节对比）
```

## 接入 Claude Code

```powershell
claude mcp add dialogue-editor -- node C:\Project\Website\Dialogue-Editor\mcp-server\dist\index.js
```

其他 MCP 客户端：stdio transport，命令 `node`，参数为上面的 `dist/index.js` 绝对路径。

## 工具一览

| 工具 | 说明 |
|---|---|
| `project_info` | 元数据、节点统计、变量、角色与结构校验摘要 |
| `list_nodes` | 全部节点与连线明细 |
| `upsert_node` | 新建/更新节点；自动布局，未知角色常量自动登记 |
| `remove_node` | 删除节点并级联清理连线 |
| `connect` / `disconnect` | 连线/断线；与画布同一套规则（结束节点不能外连等） |
| `validate_graph` | 悬空边、多 start、不可达、条件缺分支、空文本、死路 |
| `build_dialogue` | 一次性构建对话子图（声明式节点表+边表），自动分配 id 与布局 |
| `export_gml` | 由工程生成 .gml，默认写到工程文件旁同名文件 |

## 约定

- 所有工具都显式传 `path`（无会话状态）。
- 修改类工具只写 `.dialogue.json`；旧版 `.gml` 工程只读，需先在编辑器里另存为新格式。
- GML 导出是显式动作，不会随修改自动发生。
- 编辑器已内置冲突检测：打开某工程时若文件被外部（Agent/文本编辑器）改动，
  干净状态自动重载；有未保存修改时弹窗让用户选择「重新加载」或「保留本地」。

## 测试夹具

`testdata/dlgEveningHaming.gml` 提取自 Nature Edition 游戏仓库 HEAD 版本
（含旧版 EDITOR_DATA），用于验证「迁移→序列化→导出」全链路输出与编辑器实际导出逐字节一致。
