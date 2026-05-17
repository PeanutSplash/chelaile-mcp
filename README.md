# 车来了 MCP

一个基于 MCP 的车来了实时公交服务器，让大语言模型可以查询国内的公交、地铁实时数据 —— 包括线路时刻表、车辆实时位置、附近站点、关键词搜索、以及公交+地铁的换乘路线规划。

回答 "我的公交还有多久到站" 这类问题。**无需登录、无需任何账号配置**，开箱即用。

[![npm version](https://img.shields.io/npm/v/chelaile-mcp-server?color=cb3837&logo=npm)](https://www.npmjs.com/package/chelaile-mcp-server)
[![Install in Cursor](https://img.shields.io/badge/Cursor-一键安装-000000?style=flat-square&logo=cursor&logoColor=white)](cursor://anysphere.cursor-deeplink/mcp/install?name=chelaile&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImNoZWxhaWxlLW1jcC1zZXJ2ZXIiXX0=)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-一键安装-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](vscode:mcp/install?%7B%22name%22%3A%22chelaile%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22chelaile-mcp-server%22%5D%7D)
[![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-一键安装-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](vscode-insiders:mcp/install?%7B%22name%22%3A%22chelaile%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22chelaile-mcp-server%22%5D%7D)

## 安装

### 一键安装

点击上面的徽章即可在 Cursor / VS Code / VS Code Insiders 中一键安装。

### 在 Claude Code 中使用

```bash
claude mcp add chelaile -- npx -y chelaile-mcp-server
```

或者手动编辑 `~/.claude/mcp_servers.json`（或项目级的 `.mcp.json`）：

```json
{
  "mcpServers": {
    "chelaile": {
      "command": "npx",
      "args": ["-y", "chelaile-mcp-server"]
    }
  }
}
```

### 在 Claude Desktop 中使用

编辑 `~/Library/Application Support/Claude/claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "chelaile": {
      "command": "npx",
      "args": ["-y", "chelaile-mcp-server"]
    }
  }
}
```

重启对应客户端后，工具会以 `chelaile` 为前缀出现。

## 工具一览

| 工具                    | 用途                                    |
| ----------------------- | --------------------------------------- |
| `bus_list_cities`       | 列出支持的城市及其 ID                   |
| `bus_get_city_config`   | 某城市的刷新间隔限制与展示策略          |
| `bus_get_my_location`   | 基于调用方 IP 估算位置（精度到城市级）  |
| `bus_reverse_geocode`   | WGS-84 经纬度 → 中文地址                |
| `bus_search`            | 按关键词混合搜索：线路 + 站点 + POI     |
| `bus_search_more`       | 按某一分类分页"查看更多"                |
| `bus_get_nearby_stops`  | 某 GPS 坐标附近的站点及到站预计时间     |
| `bus_get_stop_detail`   | 某站点经过的所有线路 + 附近的地铁       |
| `bus_get_line_detail`   | 某线路的完整站点列表 + 当前车辆         |
| `bus_get_line_route`    | 某线路的地图轨迹坐标                    |
| `bus_get_line_realtime` | 某线路即将到达某站点的车辆实时信息      |
| `bus_list_line_buses`   | 某线路上所有车辆的位置与载客率          |
| `bus_get_timetable`     | 首末班、发车间隔或完整时刻表            |
| `bus_refresh_lines`     | 一次性批量刷新多个 (线路, 站点) 对      |
| `bus_plan_transit`      | 两个 GCJ-02 坐标之间的公交+地铁换乘规划 |

每个工具都支持 `response_format: "markdown" | "json"`（默认 `markdown`），返回 JSON 时同时附带 `structuredContent`。

## License

MIT
