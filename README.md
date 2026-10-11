# printing-kb-mcp

Примеры запросов [requests.md](requests.md)
Логи пишутся в [logs/](logs/mcp-server.log) (включены в репозиторий намеренно)
Отчет в [report.md](report.md)

---

MCP-сервер на Node.js с двумя тулами:

| Тул | Назначение |
|---|---|
| `docs_context` | Контекст из базы знаний по 3D-печати в [docs/](docs/README.md): поиск, оглавление, чтение документа или секции |
| `project_helper` | Навигация по кодовой базе самого сервера: обзор, дерево, чтение файлов, поиск по коду, описание тулов |

## Запуск

```bash
npm install
npm start          # stdio-транспорт
npm test           # тесты (node:test)
npm run inspect    # MCP Inspector в браузере
```

Подключение в Claude Code — файл [.mcp.json](.mcp.json) в корне уже настроен.
Для других клиентов:

```json
{
  "mcpServers": {
    "printing-kb": { "command": "node", "args": ["<путь к проекту>/src/index.js"] }
  }
}
```

## Тулы

### `docs_context`

| Параметр | Тип | Описание |
|---|---|---|
| `action` | `list` \| `search` \| `read` | обязателен |
| `query` | string | для `search`, напр. `"PETG P1S адгезия"` |
| `scope` | `all` \| `printers` \| `filaments` \| `guides` | фильтр для `list`/`search`, по умолчанию `all` |
| `path` | string | для `read`, относительно `docs/`, напр. `filaments/pla.md` |
| `section` | string | для `read`: подстрока заголовка; возвращается секция с подсекциями |
| `maxResults` | 1–50 | лимит результатов поиска, по умолчанию 5 |

Поиск — по секциям markdown, без учёта регистра, с упрощённым стеммингом
(«сушка нейлона» находит «сушить», «нейлон»). Секции, совпавшие по всем
словам запроса, идут первыми.

### `project_helper`

| Параметр | Тип | Описание |
|---|---|---|
| `action` | `overview` \| `tree` \| `read_file` \| `search_code` \| `list_tools` | обязателен |
| `path` | string | для `tree` / `read_file`, относительно корня проекта |
| `depth` | 1–6 | глубина `tree`, по умолчанию 3 |
| `startLine`, `endLine` | int | диапазон строк для `read_file` |
| `query` | string | подстрока для `search_code` (без учёта регистра) |
| `maxResults` | 1–50 | лимит совпадений, по умолчанию 20 |

## Формат ответа

Все тулы — включая ошибки валидации и вызов несуществующего тула —
возвращают один и тот же конверт. Он передаётся как `structuredContent`
и дублируется JSON-текстом в `content[0].text`; у каждого тула объявлен
одинаковый `outputSchema`.

```json
{
  "schemaVersion": "1.0",
  "tool": "docs_context",
  "requestId": "d9b760cd-fc2b-4667-96d0-5f151c6c94d1",
  "status": "success",
  "data": { "action": "search", "results": [ ... ] },
  "error": null,
  "meta": { "timestamp": "2026-10-10T16:26:19.196Z", "durationMs": 25 }
}
```

- `status: "success"` ⇒ `data` — объект, `error` — `null`.
- `status: "error"` ⇒ `data` — `null`, `error` — `{ code, message, details? }`, `isError: true`.
- Перед отправкой конверт проверяется по схеме ([src/core/response.js](src/core/response.js));
  несоответствие превращается в `INTERNAL_ERROR`, а не уходит клиенту.

Коды ошибок: `VALIDATION_ERROR`, `UNKNOWN_TOOL`, `ACCESS_DENIED`, `NOT_FOUND`,
`FILE_TOO_LARGE`, `UNSUPPORTED_FILE`, `INTERNAL_ERROR`.

## Ограничение доступа к файлам

- Корень вычисляется из расположения исходников и не настраивается извне.
- `docs_context` читает только `docs/` и только `.md`.
- `project_helper` читает только корень проекта, кроме `node_modules`, `.git`,
  `logs`, `docs`, `.claude`, `.env*`, `*.pem|key|p12|pfx`.
- Принимаются только относительные пути. Путь проверяется дважды: после
  нормализации (`..`) и после `realpath` — симлинки и junction, ведущие
  наружу, отклоняются (`ACCESS_DENIED`). Обход директорий за ссылками не следует.
- Лимиты: файл до 256 КБ, бинарные файлы отклоняются, контент обрезается
  до 20 000 символов с флагом `truncated`.

## Логирование

JSON Lines в **stderr** (stdout занят протоколом) и в `logs/mcp-server.log`.
На каждый вызов — одна запись `tool_call`:

```json
{"ts":"…","level":"info","event":"tool_call","tool":"docs_context","requestId":"…",
 "status":"success","durationMs":25,"input":{…},"output":{…}}
```

`output` — это `data` при успехе и `error` при ошибке; ошибки пишутся с
уровнем `warn`, исключения — дополнительно `tool_exception` со стеком.
Длинные строки в логе обрезаются до 2000 символов.

| Переменная | Значение |
|---|---|
| `MCP_LOG_LEVEL` | `debug` \| `info` (по умолчанию) \| `warn` \| `error` |
| `MCP_LOG_FILE` | путь к файлу лога или `off` |

## Структура

```
src/
  index.js               — точка входа, stdio-транспорт
  server.js              — регистрация тулов, единый раннер: валидация → вызов → конверт → лог
  config.js              — корень проекта, лимиты, denylist
  core/
    response.js          — схема и сборка конверта ответа
    logger.js            — JSON-логгер
    pathGuard.js         — проверка путей
    fsUtils.js           — обход директорий, безопасное чтение
    errors.js            — коды ошибок, ToolError
  docs/markdown.js       — разбор markdown на секции, токенизация
  tools/
    docsContext.js       — тул docs_context
    projectHelper.js     — тул project_helper
test/                    — тесты на node:test
docs/                    — база знаний
```
