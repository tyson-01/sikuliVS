import * as vscode from 'vscode';

/**
 * Data provider for rendering custom sidebar panel menu.
 * Maps static menu rows straight to registered commands.
 */
export class SikuliVSView implements vscode.TreeDataProvider<SikuliItem> {
    
    getTreeItem(element: SikuliItem): vscode.TreeItem {
        return element;
    }

    async getChildren(): Promise<SikuliItem[]> {
        return [
            new SikuliItem('📐 Create Region', 'sikuliVS.region', 'screen-full'),
            new SikuliItem('📸 Capture Image', 'sikuliVS.capture', 'device-camera'),
            new SikuliItem('🎯 Set Target Offset', 'sikuliVS.offset', 'target'),
            new SikuliItem('🔍 Preview Matches', 'sikuliVS.match', 'eye')
        ];
    }
}

/**
 * Helper class that formats a single row in the sidebar tree.
 * Links a text label and icon to a VS Code command.
 */
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