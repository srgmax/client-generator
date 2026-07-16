import * as path from "path";
import * as vscode from "vscode";
import { generateSelected } from "./generator";
import {
  editSetting,
  resolveConfigPath,
  SettingsKey,
  SettingsTreeProvider,
} from "./settings";
import { CollectionsTreeProvider, TreeNode } from "./treeProvider";

export function activate(context: vscode.ExtensionContext): void {
  const collectionsProvider = new CollectionsTreeProvider(() => resolveConfigPath("collectionsPath"));
  const settingsProvider = new SettingsTreeProvider();

  const collectionsView = vscode.window.createTreeView("clientGen.collections", {
    treeDataProvider: collectionsProvider,
    showCollapseAll: true,
    manageCheckboxStateManually: true,
  });

  const settingsView = vscode.window.createTreeView("clientGen.settings", {
    treeDataProvider: settingsProvider,
  });

  context.subscriptions.push(
    collectionsView,
    settingsView,
    collectionsView.onDidChangeCheckboxState((event) => {
      collectionsProvider.onCheckboxStateChange(
        event.items as readonly [TreeNode, vscode.TreeItemCheckboxState][]
      );
    }),
    vscode.commands.registerCommand("clientGen.refresh", () => {
      try {
        collectionsProvider.refresh();
        settingsProvider.refresh();
      } catch (error) {
        void vscode.window.showErrorMessage(String(error));
      }
    }),
    vscode.commands.registerCommand("clientGen.generate", async () => {
      try {
        const selected = collectionsProvider.getSelectedEndpoints();
        if (selected.length === 0) {
          void vscode.window.showWarningMessage("Не выбрано ни одной ручки");
          return;
        }

        const outputDir = resolveConfigPath("outputPath");
        const result = generateSelected(selected, outputDir);

        const open = "Открыть папку";
        const choice = await vscode.window.showInformationMessage(
          `Сгенерировано ${result.endpointCount} методов в ${result.writtenFiles.length} файлах → ${outputDir}`,
          open
        );
        if (choice === open && result.writtenFiles[0]) {
          const folderUri = vscode.Uri.file(path.dirname(path.dirname(result.writtenFiles[0])));
          await vscode.commands.executeCommand("revealFileInOS", folderUri);
        }
      } catch (error) {
        void vscode.window.showErrorMessage(String(error));
      }
    }),
    vscode.commands.registerCommand("clientGen.selectAll", (node?: TreeNode) => {
      if (node?.kind === "collection" && node.collection) {
        collectionsProvider.setCollectionSelection(node.collection, true);
      }
    }),
    vscode.commands.registerCommand("clientGen.deselectAll", (node?: TreeNode) => {
      if (node?.kind === "collection" && node.collection) {
        collectionsProvider.setCollectionSelection(node.collection, false);
      }
    }),
    vscode.commands.registerCommand("clientGen.editSetting", async (arg?: SettingsKey | { settingsKey?: SettingsKey }) => {
      const key = typeof arg === "string" ? arg : arg?.settingsKey;
      if (!key) {
        return;
      }
      try {
        await editSetting(key);
      } catch (error) {
        void vscode.window.showErrorMessage(String(error));
      }
    }),
    vscode.commands.registerCommand("clientGen.openSettings", async () => {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "@ext:qa.client-gen"
      );
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("clientGen")) {
        settingsProvider.refresh();
        if (event.affectsConfiguration("clientGen.collectionsPath")) {
          collectionsProvider.refresh();
        }
      }
    })
  );

  try {
    collectionsProvider.refresh();
  } catch {
    // Workspace may be empty on activate — refresh later via command
  }
}

export function deactivate(): void {}
