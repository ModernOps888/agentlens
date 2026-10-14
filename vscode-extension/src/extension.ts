/**
 * AgentLens VS Code Extension
 *
 * Provides a sidebar panel for viewing AI agent traces directly in VS Code.
 * Connects to the AgentLens server via SSE for real-time streaming.
 */

import * as vscode from 'vscode';

let statusBarItem: vscode.StatusBarItem;
let isCapturing = false;

export function activate(context: vscode.ExtensionContext) {
  console.log('AgentLens extension activated');

  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.text = '$(debug-alt) AgentLens';
  statusBarItem.tooltip = 'Click to open AgentLens panel';
  statusBarItem.command = 'agentlens.openPanel';
  statusBarItem.show();

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('agentlens.openPanel', () => openPanel(context)),
    vscode.commands.registerCommand('agentlens.startCapture', () => startCapture()),
    vscode.commands.registerCommand('agentlens.stopCapture', () => stopCapture()),
    vscode.commands.registerCommand('agentlens.exportTrace', () => exportTrace()),
    vscode.commands.registerCommand('agentlens.connectServer', () => connectServer()),
  );

  // Register tree data providers
  const sessionsProvider = new SessionsTreeProvider();
  const timelineProvider = new TimelineTreeProvider();
  const agentsProvider = new AgentsTreeProvider();

  vscode.window.registerTreeDataProvider('agentlens.sessions', sessionsProvider);
  vscode.window.registerTreeDataProvider('agentlens.timeline', timelineProvider);
  vscode.window.registerTreeDataProvider('agentlens.agents', agentsProvider);

  // Auto-connect if configured
  const config = vscode.workspace.getConfiguration('agentlens');
  if (config.get('autoConnect')) {
    connectToServer(config.get('serverUrl') || 'http://localhost:3000');
  }
}

function openPanel(context: vscode.ExtensionContext) {
  const panel = vscode.window.createWebviewPanel(
    'agentlens',
    'AgentLens Debugger',
    vscode.ViewColumn.Two,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    }
  );

  const serverUrl = vscode.workspace.getConfiguration('agentlens').get('serverUrl') || 'http://localhost:3000';

  panel.webview.onDidReceiveMessage(
    (msg: { command?: string; url?: string }) => {
      if (msg.command === 'openExternal' && msg.url) {
        vscode.env.openExternal(vscode.Uri.parse(msg.url));
      }
    },
    undefined,
    context.subscriptions
  );

  panel.webview.html = getWebviewContent(serverUrl as string);
}

function getWebviewContent(serverUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AgentLens</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      margin: 0;
      padding: 16px;
    }
    .header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--vscode-widget-border);
    }
    .header h2 { margin: 0; font-size: 16px; }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
    }
    .status.connected {
      background: rgba(16, 185, 129, 0.15);
      color: #10b981;
    }
    .status.disconnected {
      background: rgba(239, 68, 68, 0.15);
      color: #ef4444;
    }
    .sessions-list { margin-top: 8px; }
    .session-item {
      padding: 8px 12px;
      margin-bottom: 4px;
      border: 1px solid var(--vscode-widget-border);
      border-radius: 6px;
      cursor: pointer;
    }
    .session-item:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .session-name { font-weight: 600; font-size: 13px; }
    .session-meta { font-size: 11px; opacity: 0.7; margin-top: 2px; }
    .step-item {
      padding: 6px 12px;
      margin: 2px 0;
      border-left: 3px solid var(--vscode-widget-border);
      font-size: 12px;
    }
    .step-agent { font-weight: 600; }
    .step-type { opacity: 0.6; font-size: 11px; }
    iframe {
      width: 100%;
      height: calc(100vh - 80px);
      border: none;
      border-radius: 8px;
    }
    .btn {
      padding: 6px 14px;
      border: 1px solid var(--vscode-button-border);
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    }
    .btn:hover { background: var(--vscode-button-hoverBackground); }
    .controls { display: flex; gap: 8px; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="header">
    <h2>🔍 AgentLens</h2>
    <span class="status connected" id="status">● Connected</span>
  </div>
  <div class="controls">
    <button class="btn" onclick="openInBrowser()">Open Full UI ↗</button>
    <button class="btn" onclick="refreshSessions()">Refresh Sessions</button>
  </div>
  <iframe id="agentlens-frame" src="${serverUrl}"></iframe>
  <script>
    const vscode = acquireVsCodeApi();
    const serverUrl = '${serverUrl}';

    function openInBrowser() {
      vscode.postMessage({ command: 'openExternal', url: serverUrl });
    }

    function refreshSessions() {
      document.getElementById('agentlens-frame').src = serverUrl + '?t=' + Date.now();
    }

    // Listen for SSE events
    try {
      const es = new EventSource(serverUrl + '/api/stream');
      es.addEventListener('step:new', (e) => {
        const data = JSON.parse(e.data);
        vscode.postMessage({ command: 'newStep', data });
      });
      es.addEventListener('session:new', (e) => {
        const data = JSON.parse(e.data);
        vscode.postMessage({ command: 'newSession', data });
      });
      es.onerror = () => {
        document.getElementById('status').className = 'status disconnected';
        document.getElementById('status').textContent = '● Disconnected';
      };
    } catch (e) {
      console.warn('SSE connection failed:', e);
    }
  </script>
</body>
</html>`;
}

async function connectToServer(url: string) {
  try {
    const response = await fetch(`${url}/api/sessions`);
    if (response.ok) {
      statusBarItem.text = '$(debug-alt) AgentLens ●';
      statusBarItem.color = '#10b981';
      vscode.window.showInformationMessage(`AgentLens: Connected to ${url}`);
    }
  } catch {
    statusBarItem.text = '$(debug-alt) AgentLens ○';
    statusBarItem.color = '#ef4444';
  }
}

function startCapture() {
  isCapturing = true;
  statusBarItem.text = '$(record) AgentLens Recording...';
  statusBarItem.color = '#ef4444';
  vscode.window.showInformationMessage('AgentLens: Trace capture started. Run your agent code now.');
}

function stopCapture() {
  isCapturing = false;
  statusBarItem.text = '$(debug-alt) AgentLens ●';
  statusBarItem.color = '#10b981';
  vscode.window.showInformationMessage('AgentLens: Trace capture stopped.');
}

async function exportTrace() {
  const config = vscode.workspace.getConfiguration('agentlens');
  const serverUrl = config.get('serverUrl') || 'http://localhost:3000';

  try {
    const response = await fetch(`${serverUrl}/api/sessions`);
    const sessions = await response.json();

    if (Array.isArray(sessions) && sessions.length > 0) {
      const content = JSON.stringify(sessions, null, 2);
      const doc = await vscode.workspace.openTextDocument({
        content,
        language: 'json',
      });
      await vscode.window.showTextDocument(doc);
    }
  } catch {
    vscode.window.showErrorMessage('AgentLens: Failed to export traces');
  }
}

async function connectServer() {
  const url = await vscode.window.showInputBox({
    prompt: 'Enter AgentLens server URL',
    value: 'http://localhost:3000',
    placeHolder: 'http://localhost:3000',
  });

  if (url) {
    const config = vscode.workspace.getConfiguration('agentlens');
    await config.update('serverUrl', url, vscode.ConfigurationTarget.Global);
    connectToServer(url);
  }
}

// ─── Tree Data Providers (Sidebar Panels) ───────────────────────────────────

class SessionsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }

  async getChildren(): Promise<vscode.TreeItem[]> {
    try {
      const config = vscode.workspace.getConfiguration('agentlens');
      const serverUrl = config.get('serverUrl') || 'http://localhost:3000';
      const response = await fetch(`${serverUrl}/api/sessions`);
      const sessions = await response.json() as Array<Record<string, unknown>>;

      return sessions.map((s) => {
        const item = new vscode.TreeItem(
          `${s.name}`,
          vscode.TreeItemCollapsibleState.None
        );
        item.description = `${s.total_steps} steps · $${(s.total_cost as number)?.toFixed(4)}`;
        item.tooltip = `Status: ${s.status}\nTokens: ${s.total_tokens}`;
        item.iconPath = new vscode.ThemeIcon(
          s.status === 'failed' ? 'error' : s.status === 'running' ? 'sync~spin' : 'pass'
        );
        return item;
      });
    } catch {
      return [new vscode.TreeItem('Connect to server to see sessions')];
    }
  }
}

class TimelineTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }
  getChildren(): vscode.TreeItem[] {
    return [new vscode.TreeItem('Select a session to view timeline')];
  }
}

class AgentsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }
  getChildren(): vscode.TreeItem[] {
    return [new vscode.TreeItem('Select a session to view agents')];
  }
}

export function deactivate() {
  statusBarItem?.dispose();
}
