import * as vscode from 'vscode';

class Item extends vscode.TreeItem {
    constructor(label: string, commandId: string) {
        super(label, vscode.TreeItemCollapsibleState.None);

        this.command = {
            command: commandId,
            title: label
        };
    }
}

export class sikuliVSView implements vscode.TreeDataProvider<Item> {

    getTreeItem(element: Item): vscode.TreeItem {
        return element;
    }

    getChildren(): Thenable<Item[]> {
        return Promise.resolve([
            new Item('📐 Region', 'sikuliVS.region')
        ]);
    }
}