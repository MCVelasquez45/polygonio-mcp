import { useState, useEffect } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { AgentChatPanel } from '../dashboard/AgentChatPanel';

type FileNode = {
  id: string;
  name: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  content?: string;
  language?: string;
  isOpen?: boolean;
};

type StrategyParams = {
  [key: string]: number | string | boolean;
};

type Props = {
  strategyId?: string;
  onRunBacktest?: () => void;
  onSave?: (content: string) => void;
};

const MOCK_FILES: FileNode[] = [
  {
    id: 'root',
    name: 'strategies',
    type: 'folder',
    isOpen: true,
    children: [
      {
        id: '1',
        name: 'VolArbitrage_v2.py',
        type: 'file',
        language: 'python',
        content: `
class VolArbitrageStrategy(Strategy):
    """
    Volatility Arbitrage Strategy v2.1
    """
    def __init__(self):
        self.lookback = 20
        self.threshold = 0.05
        self.position_size = 0.02
        
    def on_bar(self, bar):
        # Calculate volatility term structure
        vix = self.data['VIX'].close
        vxx = self.data['VXX'].close
        
        # Check for contango
        if self.is_contango(vix, vxx) > self.threshold:
            self.short('VXX', size=self.position_size)
            
    def is_contango(self, vix, vxx):
        return (vxx - vix) / vix
`.trim()
      },
      {
        id: '2',
        name: 'utils.py',
        type: 'file',
        language: 'python',
        content: `
def calculate_atr(high, low, close, period=14):
    tr_list = []
    # ... implementation details
    return atr
`.trim()
      }
    ]
  },
  {
    id: 'tests',
    name: 'tests',
    type: 'folder',
    isOpen: true,
    children: [
      {
        id: '3',
        name: 'test_vol_arb.py',
        type: 'file',
        language: 'python',
        content: 'def test_contango_signal():\n    pass'
      }
    ]
  }
];

export function StrategyEditorPanel({ strategyId, onRunBacktest, onSave }: Props) {
  const [activeFile, setActiveFile] = useState<FileNode | null>(MOCK_FILES[0].children![0]);
  const [fileTree, setFileTree] = useState<FileNode[]>(MOCK_FILES);
  const [code, setCode] = useState<string>(activeFile?.content || '');
  const [params, setParams] = useState<StrategyParams>({
    lookback: 20,
    threshold: 0.05,
    position_size: 0.02,
    stop_loss: 0.03
  });
  const [showAgentChat, setShowAgentChat] = useState(true);
  const [agentMessage, setAgentMessage] = useState('');

  const handleEditorMount: OnMount = (editor, monaco) => {
    // Configure editor if needed
    // monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({...})
  };

  const handleFileClick = (file: FileNode) => {
    if (file.type === 'file') {
      setActiveFile(file);
      setCode(file.content || '');
    } else {
      // Toggle folder
      const toggleNode = (nodes: FileNode[]): FileNode[] => {
        return nodes.map(node => {
          if (node.id === file.id) {
            return { ...node, isOpen: !node.isOpen };
          }
          if (node.children) {
            return { ...node, children: toggleNode(node.children) };
          }
          return node;
        });
      };
      setFileTree(toggleNode(fileTree));
    }
  };

  const renderFileTree = (nodes: FileNode[], level = 0) => {
    return nodes.map(node => (
      <div key={node.id}>
        <div
          className={`file-node ${activeFile?.id === node.id ? 'active' : ''}`}
          style={{ paddingLeft: `${level * 12 + 12}px` }}
          onClick={() => handleFileClick(node)}
        >
          <span className="file-icon">
            {node.type === 'folder' ? (node.isOpen ? '📂' : '📁') : '📄'}
          </span>
          <span className="file-name">{node.name}</span>
        </div>
        {node.type === 'folder' && node.isOpen && node.children && (
          <div className="file-children">
            {renderFileTree(node.children, level + 1)}
          </div>
        )}
      </div>
    ));
  };

  return (
    <div className="strategy-editor-panel">
      {/* Top Bar */}
      <div className="editor-toolbar">
        <div className="toolbar-left">
          <span className="strategy-name">VolArbitrage_v2</span>
          <span className="save-status">All changes saved</span>
        </div>
        <div className="toolbar-right">
          <button className="btn-secondary" onClick={() => onSave?.(code)}>
            💾 Save
          </button>
          <button className="btn-primary" onClick={onRunBacktest}>
            ▶ Run Backtest
          </button>
          <button
            className={`btn-icon ${showAgentChat ? 'active' : ''}`}
            onClick={() => setShowAgentChat(!showAgentChat)}
          >
            🤖
          </button>
        </div>
      </div>

      <div className="editor-layout">
        {/* Left Sidebar: File Explorer */}
        <div className="sidebar-left">
          <div className="sidebar-header">EXPLORER</div>
          <div className="file-tree">
            {renderFileTree(fileTree)}
          </div>

          <div className="sidebar-header mt-4">PARAMETERS</div>
          <div className="params-list">
            {Object.entries(params).map(([key, value]) => (
              <div key={key} className="param-item">
                <label>{key}</label>
                <input
                  type={typeof value === 'number' ? 'number' : 'text'}
                  value={value.toString()}
                  onChange={(e) => setParams({ ...params, [key]: e.target.value })}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Center: Monaco Editor */}
        <div className="main-editor">
          {activeFile ? (
            <div className="editor-container">
              <div className="current-file-tab">
                <span className="file-icon">📄</span>
                {activeFile.name}
              </div>
              <Editor
                height="100%"
                defaultLanguage={activeFile.language || 'python'}
                value={code}
                onChange={(value) => setCode(value || '')}
                theme="vs-dark"
                onMount={handleEditorMount}
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  padding: { top: 16 },
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                }}
              />
            </div>
          ) : (
            <div className="empty-state">Select a file to edit</div>
          )}
        </div>

        {/* Right Sidebar: Agent Chat */}
        {showAgentChat && (
          <div className="sidebar-right">
            <AgentChatPanel
              embedded={true}
              context={{
                activeFile: activeFile?.name,
                code: code,
                params: params
              }}
              onClose={() => setShowAgentChat(false)}
            />
          </div>
        )}
      </div>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .strategy-editor-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #1e1e1e;
    color: #e5e5e5;
    border-radius: 0.5rem;
    overflow: hidden;
  }

  .editor-toolbar {
    height: 48px;
    background: #252526;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 1rem;
    border-bottom: 1px solid #333;
  }

  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .strategy-name {
    font-weight: 600;
    font-size: 0.95rem;
  }

  .save-status {
    font-size: 0.8rem;
    color: #6b7280;
  }

  .toolbar-right {
    display: flex;
    gap: 0.5rem;
  }

  .editor-layout {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .sidebar-left {
    width: 250px;
    background: #252526;
    border-right: 1px solid #333;
    display: flex;
    flex-direction: column;
  }

  .sidebar-right {
    width: 300px;
    background: #252526;
    border-left: 1px solid #333;
    display: flex;
    flex-direction: column;
  }

  .sidebar-header {
    padding: 0.75rem 1rem;
    font-size: 0.7rem;
    font-weight: 600;
    color: #9ca3af;
    letter-spacing: 0.05em;
    background: #2d2d2d;
  }

  .mt-4 { margin-top: 1rem; }

  .file-tree {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem 0;
  }

  .file-node {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 1rem;
    cursor: pointer;
    font-size: 0.9rem;
    color: #cccccc;
  }

  .file-node:hover {
    background: #2a2d2e;
  }

  .file-node.active {
    background: #37373d;
    color: white;
  }

  .file-icon {
    width: 16px;
    text-align: center;
    font-size: 1rem;
  }

  .params-list {
    padding: 1rem;
    border-top: 1px solid #333;
  }

  .param-item {
    margin-bottom: 1rem;
  }

  .param-item label {
    display: block;
    font-size: 0.8rem;
    color: #9ca3af;
    margin-bottom: 0.25rem;
  }

  .param-item input {
    width: 100%;
    background: #3c3c3c;
    border: 1px solid #333;
    color: #e5e5e5;
    padding: 0.25rem 0.5rem;
    border-radius: 2px;
  }

  .main-editor {
    flex: 1;
    display: flex;
    flex-direction: column;
    background: #1e1e1e;
  }

  .editor-container {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .current-file-tab {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: #1e1e1e;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid #333;
    font-size: 0.9rem;
    color: #e5e5e5;
  }

  .chat-messages {
    flex: 1;
    padding: 1rem;
    overflow-y: auto;
  }

  .message {
    margin-bottom: 1rem;
    padding: 0.75rem;
    border-radius: 0.5rem;
    font-size: 0.9rem;
    line-height: 1.5;
  }

  .message.agent {
    background: rgba(16, 185, 129, 0.1);
    border: 1px solid rgba(16, 185, 129, 0.2);
    color: #e5e5e5;
  }

  .chat-input-area {
    padding: 1rem;
    border-top: 1px solid #333;
  }

  .chat-input-area textarea {
    width: 100%;
    height: 80px;
    background: #3c3c3c;
    border: 1px solid #333;
    color: #e5e5e5;
    padding: 0.5rem;
    border-radius: 4px;
    resize: none;
    margin-bottom: 0.5rem;
  }

  .send-btn {
    width: 100%;
    padding: 0.5rem;
    background: #10b981;
    border: none;
    border-radius: 4px;
    color: white;
    font-weight: 500;
    cursor: pointer;
  }

  .btn-primary, .btn-secondary {
    padding: 0.35rem 0.75rem;
    border-radius: 3px;
    font-size: 0.85rem;
    cursor: pointer;
  }

  .btn-primary {
    background: #0e639c;
    border: none;
    color: white;
  }
  
  .btn-primary:hover { background: #1177bb; }

  .btn-secondary {
    background: transparent;
    border: 1px solid #454545;
    color: #cccccc;
  }

  .btn-secondary:hover { background: #454545; }

  .btn-icon {
    background: transparent;
    border: 1px solid transparent;
    color: #cccccc;
    padding: 0.35rem;
    border-radius: 3px;
    cursor: pointer;
  }

  .btn-icon:hover { background: #454545; }
  .btn-icon.active { background: #37373d; border-color: #454545; }
`;

export default StrategyEditorPanel;
