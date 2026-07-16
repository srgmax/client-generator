import * as path from "path";
import * as vscode from "vscode";

export type SettingsKey = "collectionsPath" | "outputPath";

const DEFAULTS: Record<SettingsKey, string> = {
  collectionsPath: "utils/generate_clients/collections",
  outputPath: "utils/generate_clients/clients",
};

const LABELS: Record<SettingsKey, string> = {
  collectionsPath: "Папка коллекций",
  outputPath: "Папка вывода",
};

export function getConfigValue(key: SettingsKey): string {
  return vscode.workspace.getConfiguration("clientGen").get<string>(key, DEFAULTS[key]);
}

export async function setConfigValue(key: SettingsKey, value: string): Promise<void> {
  await vscode.workspace
    .getConfiguration("clientGen")
    .update(key, value, vscode.ConfigurationTarget.Workspace);
}

export function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export function resolveConfigPath(key: SettingsKey): string {
  const root = workspaceRoot();
  if (!root) {
    throw new Error("Откройте workspace (папку проекта)");
  }
  const relative = getConfigValue(key);
  return path.isAbsolute(relative) ? relative : path.join(root, relative);
}

export class SettingsItem extends vscode.TreeItem {
  constructor(public readonly settingsKey: SettingsKey) {
    const value = getConfigValue(settingsKey);
    super(LABELS[settingsKey], vscode.TreeItemCollapsibleState.None);
    this.description = value;
    this.tooltip = value;
    this.contextValue = "setting";
    this.iconPath = new vscode.ThemeIcon(settingsKey === "collectionsPath" ? "folder-library" : "folder-active");
    this.command = {
      command: "clientGen.editSetting",
      title: "Изменить",
      arguments: [settingsKey],
    };
  }
}

export class SettingsTreeProvider implements vscode.TreeDataProvider<SettingsItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<SettingsItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SettingsItem): vscode.TreeItem {
    return element;
  }

  getChildren(): SettingsItem[] {
    return (Object.keys(DEFAULTS) as SettingsKey[]).map((key) => new SettingsItem(key));
  }
}

export async function editSetting(key: SettingsKey): Promise<void> {
  const current = getConfigValue(key);
  const root = workspaceRoot();

  const pickFolder = "Выбрать папку…";
  const enterPath = "Ввести путь…";
  const action = await vscode.window.showQuickPick(
    [
      { label: pickFolder, description: "Диалог выбора папки" },
      { label: enterPath, description: current },
    ],
    { title: LABELS[key], placeHolder: "Как изменить значение?" }
  );

  if (!action) {
    return;
  }

  if (action.label === pickFolder) {
    const defaultUri = root
      ? vscode.Uri.file(path.isAbsolute(current) ? current : path.join(root, current))
      : undefined;
    const folders = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      defaultUri,
      openLabel: "Выбрать",
      title: LABELS[key],
    });
    if (!folders?.[0]) {
      return;
    }
    const selected = folders[0].fsPath;
    const value = root && selected.startsWith(root + path.sep)
      ? path.relative(root, selected)
      : selected;
    await setConfigValue(key, value || ".");
    return;
  }

  const value = await vscode.window.showInputBox({
    title: LABELS[key],
    value: current,
    prompt: "Относительный путь от корня workspace или абсолютный путь",
    ignoreFocusOut: true,
  });
  if (value === undefined) {
    return;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    void vscode.window.showWarningMessage("Путь не может быть пустым");
    return;
  }
  await setConfigValue(key, trimmed);
}
