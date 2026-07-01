import * as vscode from 'vscode';

class SikuliItem extends vscode.TreeItem {
    constructor(label: string, commandId: string, iconId: string) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.command = {
            command: commandId,
            title: label
        };
        this.iconPath = new vscode.ThemeIcon(iconId);
    }
}

export class sikuliVSView implements vscode.TreeDataProvider<SikuliItem> {
    getTreeItem(element: SikuliItem): vscode.TreeItem {
        return element;
    }

    getChildren(): Thenable<SikuliItem[]> {
        return Promise.resolve([
            new SikuliItem('📐 Create Region', 'sikuliVS.region', 'screen-full'),
            new SikuliItem('📸 Capture Image', 'sikuliVS.capture', 'device-camera'),
            new SikuliItem('🎯 Set Target Offset', 'sikuliVS.offset', 'target'),
            new SikuliItem('🔍 Preview Matches', 'sikuliVS.match', 'eye')
        ]);
    }
}