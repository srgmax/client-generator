# Client Generator

Генерация Python API-клиентов из JSON-коллекций (дерево запросов или OpenAPI 3.x / Swagger) прямо в VS Code / Cursor.

## Возможности

- Просмотр JSON-коллекций из заданной папки (`item[]` или OpenAPI `paths`)
- Дерево ручек: коллекция → группа (3-й сегмент URL) → метод и имя
- Выбор нужных эндпоинтов чекбоксами (коллекция / группа / ручка)
- Генерация выбранных методов в структуру:

```text
{outputPath}/
  {имя коллекции}/
    {группа}_api.py
```

## Настройки

| Параметр | Описание | По умолчанию |
| --- | --- | --- |
| `clientGen.collectionsPath` | Папка с JSON-коллекциями | `utils/generate_clients/collections` |
| `clientGen.outputPath` | Папка для сгенерированных клиентов | `utils/generate_clients/clients` |

Пути относительно корня workspace (или абсолютные). Изменить можно в панели **Настройки** сайдбара плагина или в Settings VS Code (`Client Generator`).

## Использование

1. Укажите папку коллекций и папку вывода
2. В **Коллекции** отметьте нужные ручки
3. Нажмите ▶ **Сгенерировать выбранные**

## Разработка

Из корня репозитория (рекомендуется) или из папки `vscode-extension`:

```bash
cd vscode-extension && npm install && npm run compile
```

Затем **Run and Debug → Run Extension** (F5). Откроется Extension Development Host с этим плагином.

## Сборка VSIX

```bash
cd vscode-extension
npm install
npm run package
```

Результат: `postman_client_generator.vsix` (совпадает с текущим `out/` и `README.md`).
