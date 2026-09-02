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
            new SikuliItem('📍 Location Pick', 'sikuliVS.location', 'location'),
            new SikuliItem('🔎 Location Show', 'sikuliVS.showLocation', 'search'),
            new SikuliItem('📐 Region Capture', 'sikuliVS.region', 'screen-full'),
            new SikuliItem('✨ Region Highlight ', 'sikuliVS.highlight', 'sparkle'),
            new SikuliItem('📸 Image Capture', 'sikuliVS.capture', 'device-camera'),
            new SikuliItem('🎯 Image Set Target Offset', 'sikuliVS.offset', 'target'),
            new SikuliItem('🔍 Image Preview Matches', 'sikuliVS.match', 'eye')
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