import * as vscode from "vscode";
import { CollectionInfo, Endpoint } from "./types";
import { listCollections } from "./generator";

type NodeKind = "collection" | "group" | "endpoint";

export class TreeNode extends vscode.TreeItem {
  constructor(
    public readonly kind: NodeKind,
    label: string,
    public readonly collection?: CollectionInfo,
    public readonly group?: string,
    public readonly endpoint?: Endpoint,
    collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
  ) {
    super(label, collapsibleState);
  }
}

export class CollectionsTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private collections: CollectionInfo[] = [];
  private readonly selected = new Set<string>();

  constructor(private readonly getCollectionsDir: () => string) {}

  refresh(): void {
    this.load();
    this._onDidChangeTreeData.fire();
  }

  getSelectedEndpoints(): Endpoint[] {
    const result: Endpoint[] = [];
    for (const collection of this.collections) {
      for (const ep of collection.endpoints) {
        if (this.selected.has(ep.id)) {
          result.push(ep);
        }
      }
    }
    return result;
  }

  setCollectionSelection(collection: CollectionInfo, selected: boolean): void {
    for (const ep of collection.endpoints) {
      if (selected) {
        this.selected.add(ep.id);
      } else {
        this.selected.delete(ep.id);
      }
    }
    this._onDidChangeTreeData.fire();
  }

  setGroupSelection(collection: CollectionInfo, group: string, selected: boolean): void {
    for (const ep of collection.endpoints.filter((item) => item.group === group)) {
      if (selected) {
        this.selected.add(ep.id);
      } else {
        this.selected.delete(ep.id);
      }
    }
    this._onDidChangeTreeData.fire();
  }

  onCheckboxStateChange(items: readonly [TreeNode, vscode.TreeItemCheckboxState][]): void {
    for (const [node, state] of items) {
      const checked = state === vscode.TreeItemCheckboxState.Checked;
      if (node.kind === "endpoint" && node.endpoint) {
        if (checked) {
          this.selected.add(node.endpoint.id);
        } else {
          this.selected.delete(node.endpoint.id);
        }
      } else if (node.kind === "group" && node.collection && node.group) {
        this.setGroupSelection(node.collection, node.group, checked);
        continue;
      } else if (node.kind === "collection" && node.collection) {
        this.setCollectionSelection(node.collection, checked);
        continue;
      }
    }
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      if (this.collections.length === 0) {
        this.load();
      }
      return this.collections.map((collection) => this.createCollectionNode(collection));
    }

    if (element.kind === "collection" && element.collection) {
      const groups = this.uniqueGroups(element.collection);
      return groups.map((group) => this.createGroupNode(element.collection!, group));
    }

    if (element.kind === "group" && element.collection && element.group) {
      return element.collection.endpoints
        .filter((ep) => ep.group === element.group)
        .map((ep) => this.createEndpointNode(ep));
    }

    return [];
  }

  private load(): void {
    const dir = this.getCollectionsDir();
    this.collections = listCollections(dir);
    const validIds = new Set(this.collections.flatMap((c) => c.endpoints.map((ep) => ep.id)));
    for (const id of [...this.selected]) {
      if (!validIds.has(id)) {
        this.selected.delete(id);
      }
    }
  }

  private uniqueGroups(collection: CollectionInfo): string[] {
    return [...new Set(collection.endpoints.map((ep) => ep.group))].sort();
  }

  private createCollectionNode(collection: CollectionInfo): TreeNode {
    const selectedCount = collection.endpoints.filter((ep) => this.selected.has(ep.id)).length;
    const allSelected = selectedCount === collection.endpoints.length && collection.endpoints.length > 0;
    const noneSelected = selectedCount === 0;

    const node = new TreeNode(
      "collection",
      `${collection.name} (${collection.endpoints.length})`,
      collection,
      undefined,
      undefined,
      vscode.TreeItemCollapsibleState.Collapsed
    );
    node.contextValue = "collection";
    node.iconPath = new vscode.ThemeIcon("json");
    node.description = selectedCount > 0 ? `выбрано ${selectedCount}` : undefined;
    node.checkboxState = allSelected
      ? vscode.TreeItemCheckboxState.Checked
      : noneSelected
        ? vscode.TreeItemCheckboxState.Unchecked
        : vscode.TreeItemCheckboxState.Unchecked;
    // VS Code doesn't have indeterminate — leave unchecked when partial
    if (!allSelected && selectedCount > 0) {
      node.description = `выбрано ${selectedCount}/${collection.endpoints.length}`;
    }
    node.tooltip = collection.sourceFile;
    return node;
  }

  private createGroupNode(collection: CollectionInfo, group: string): TreeNode {
    const endpoints = collection.endpoints.filter((ep) => ep.group === group);
    const selectedCount = endpoints.filter((ep) => this.selected.has(ep.id)).length;
    const allSelected = selectedCount === endpoints.length && endpoints.length > 0;

    const node = new TreeNode(
      "group",
      `${group} (${endpoints.length})`,
      collection,
      group,
      undefined,
      vscode.TreeItemCollapsibleState.Collapsed
    );
    node.contextValue = "group";
    node.iconPath = new vscode.ThemeIcon("folder");
    node.description = selectedCount > 0 ? `выбрано ${selectedCount}` : undefined;
    node.checkboxState = allSelected
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
    return node;
  }

  private createEndpointNode(endpoint: Endpoint): TreeNode {
    const method = endpoint.method.toUpperCase();
    const node = new TreeNode(
      "endpoint",
      endpoint.name,
      undefined,
      endpoint.group,
      endpoint,
      vscode.TreeItemCollapsibleState.None
    );
    node.contextValue = "endpoint";
    node.description = method;
    node.iconPath = new vscode.ThemeIcon(this.methodIcon(endpoint.method));
    node.tooltip = `${method} /api/${endpoint.path.join("/")}`;
    node.checkboxState = this.selected.has(endpoint.id)
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
    return node;
  }

  private methodIcon(method: string): string {
    switch (method) {
      case "get":
        return "arrow-down";
      case "post":
        return "add";
      case "put":
      case "patch":
        return "edit";
      case "delete":
        return "trash";
      default:
        return "symbol-method";
    }
  }
}
