import React, { useState, useEffect, useRef } from 'react';
import { HubConnectionBuilder, HubConnectionState } from '@microsoft/signalr';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import './App.css'
import AceEditor from 'react-ace';
import { VscFileCode, VscCheck } from 'react-icons/vsc'; // Giữ lại icon cho tab và status bar

// Import các mode ngôn ngữ và theme cho Ace
import 'ace-builds/src-noconflict/mode-c_cpp'
import 'ace-builds/src-noconflict/mode-python'
import 'ace-builds/src-noconflict/theme-monokai'
import 'ace-builds/src-noconflict/ext-language_tools'

// Lấy URL từ biến môi trường của Vite
const SIGNALR_HUB_URL = import.meta.env.VITE_SIGNALR_HUB_URL || "https://localhost:5001/judgehub";
const PROXY_COMPILE_URL = import.meta.env.VITE_PROXY_COMPILE_URL || "http://localhost:3000/compile";

const initialCodes = {
  c_cpp: `// Viết mã C++ của bạn ở đây
#include <iostream>

int main() {
    std::cout << "Xin chào, C++!";
    return 0;
}`,
};

function App() {
    // Cấu trúc lại state `files` để mỗi file có code, userInput, và result riêng
    const [files, setFiles] = useState(() => {
        const savedFiles = localStorage.getItem('code_files');
        if (savedFiles) {
            const parsedFiles = JSON.parse(savedFiles);
            // माइग्रेशन logic: Nếu dữ liệu cũ chỉ là string, chuyển nó sang object
            Object.keys(parsedFiles).forEach(key => {
                if (typeof parsedFiles[key] === 'string') {
                    parsedFiles[key] = { code: parsedFiles[key], userInput: '', result: null };
                }
            });
            return parsedFiles;
        }
        return { 'main.cpp': { code: initialCodes.c_cpp, userInput: '', result: null } };
    });

    const [activeFile, setActiveFile] = useState(Object.keys(files)[0] || null);
    
    // Các state cục bộ, giá trị của chúng được lấy từ file đang active
    const code = files[activeFile]?.code ?? '';
    const userInput = files[activeFile]?.userInput ?? '';
    const result = files[activeFile]?.result ?? null;
    const language = activeFile?.endsWith('.py') ? 'python' : 'c_cpp';

    const [isLoading, setIsLoading] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState('Disconnected');
    
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
    const [isIoVisible, setIsIoVisible] = useState(true);
    const [activeView, setActiveView] = useState('explorer'); // 'explorer', 'search', 'run', 'settings'

    const connectionRef = useRef(null);
    const sidebarPanelRef = useRef(null);
    const executingFileRef = useRef(null); // Sử dụng ref để tránh stale closure
    
    useEffect(() => {
        // 1. Khởi tạo và kết nối đến JudgeHub qua backend ASP.NET
        const connection = new HubConnectionBuilder()
            .withUrl(SIGNALR_HUB_URL)
            .withAutomaticReconnect()
            .build();

        connectionRef.current = connection;

        const startConnection = async () => {
            try {
                await connection.start();
                console.log("SignalR Connected.");
                setConnectionStatus('Connected');
            } catch (err) {
                console.error("SignalR Connection Error: ", err);
                setConnectionStatus('Error');
                setTimeout(startConnection, 5000); // Thử kết nối lại sau 5 giây
            }
        };

        startConnection();

        // 2. Lắng nghe sự kiện "DisplayExecutionResult" từ Hub để nhận kết quả
        connection.on("DisplayExecutionResult", (executionResult) => {
            const fileToUpdate = executingFileRef.current;
            console.log("Received execution result for:", fileToUpdate, executionResult);
            if (fileToUpdate) {
                setFiles(prev => ({
                    ...prev,
                    [fileToUpdate]: { ...prev[fileToUpdate], result: executionResult }
                }));
                setIsLoading(false); // Dừng trạng thái loading
            }
        });

        // Xử lý các trạng thái kết nối của SignalR
        connection.onreconnecting(() => setConnectionStatus('Reconnecting...'));
        connection.onreconnected(() => setConnectionStatus('Connected'));
        connection.onclose(() => setConnectionStatus('Disconnected'));

        // Cleanup: Đóng kết nối khi component bị unmount
        return () => {
            if (connectionRef.current && connectionRef.current.state === HubConnectionState.Connected) {
                connectionRef.current.stop();
            }
        };
    }, []);

    // Lưu vào localStorage mỗi khi `files` thay đổi
    useEffect(() => {
        localStorage.setItem('code_files', JSON.stringify(files));
    }, [files]);

    // Hàm cập nhật code cho file đang active
    const setCode = (newCode) => {
        if (activeFile) {
            setFiles(prev => ({ ...prev, [activeFile]: { ...prev[activeFile], code: newCode } }));
        }
    };

    // Hàm cập nhật userInput cho file đang active
    const setUserInput = (newInput) => {
        if (activeFile) {
            setFiles(prev => ({ ...prev, [activeFile]: { ...prev[activeFile], userInput: newInput } }));
        }
    };

    const handleRunCode = async () => {
        if (connectionRef.current?.state !== HubConnectionState.Connected) {
            alert("Server not connected. Please wait.");
            return;
        }

        setIsLoading(true);
        executingFileRef.current = activeFile; // Đánh dấu file đang được chạy bằng ref

        // Cập nhật UI ngay lập tức với trạng thái "Queued..."
        if (activeFile) {
            setFiles(prev => ({ ...prev, [activeFile]: { ...prev[activeFile], result: { status: 'Queued...' } } }));
        }

        const payload = {
            code: code,
            language: language,
            userInput: userInput,
            userConnectionId: connectionRef.current.connectionId // ID quan trọng để Hub biết gửi kết quả về đâu
        };

        try {
            // 3. Gửi yêu cầu đến proxy server.js
            const response = await fetch(PROXY_COMPILE_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            if (!response.ok) {
                // Nếu proxy hoặc API nội bộ trả về lỗi
                throw new Error(data.message || 'Failed to queue execution.');
            }

            // Proxy chỉ xác nhận đã nhận yêu cầu, kết quả thực thi sẽ đến qua SignalR
            console.log('Execution request sent successfully:', data.message);

        } catch (error) {
            console.error('Error sending execution request:', error);
            if (activeFile) {
                setFiles(prev => ({ ...prev, [activeFile]: { ...prev[activeFile], result: { status: 'ClientError', error: error.message } } }));
            }
            setIsLoading(false);
        }
    };

    const handleNewFile = () => {
        const fileName = prompt('Nhập tên file (phải có đuôi .cpp hoặc .py):');

        if (!fileName) {
            return; // Người dùng đã hủy
        }

        if (files[fileName]) {
            alert('File đã tồn tại!');
            return;
        }

        const extension = fileName.split('.').pop();

        if (extension === 'cpp') {
            const cppTemplate = `#include <bits/stdc++.h>
using namespace std;

int main() {
    
    return 0;
}`;
            setFiles({ ...files, [fileName]: { code: cppTemplate, userInput: '', result: null } });
            setActiveFile(fileName);
        } else if (extension === 'py') {
            setFiles({ ...files, [fileName]: { code: `# Bắt đầu viết code Python cho ${fileName}`, userInput: '', result: null } });
            setActiveFile(fileName);
        } else {
            alert('Tên file không hợp lệ. Chỉ chấp nhận file có đuôi .cpp hoặc .py.');
        }
    };

    const handleDeleteFile = (fileNameToDelete, event) => {
        // Ngăn sự kiện click vào thẻ li cha bị kích hoạt
        event.stopPropagation();

        if (window.confirm(`Bạn có chắc chắn muốn xóa file "${fileNameToDelete}" không?`)) {
            // Tạo một bản sao của state `files` và xóa file được chỉ định
            const newFiles = { ...files };
            delete newFiles[fileNameToDelete];
            setFiles(newFiles);

            // Nếu file bị xóa đang được mở, hãy chuyển sang file khác hoặc xóa nội dung editor
            if (activeFile === fileNameToDelete) {
                const remainingFiles = Object.keys(newFiles);
                // Chuyển sang file đầu tiên trong danh sách còn lại, hoặc null nếu không còn file nào
                const nextActiveFile = remainingFiles.length > 0 ? remainingFiles[0] : null;
                setActiveFile(nextActiveFile);
            }
        }
    };

    const toggleSidebar = () => {
        const panel = sidebarPanelRef.current;
        if (panel) {
            if (panel.isCollapsed()) {
                panel.expand();
            } else {
                panel.collapse();
            }
        }
    };

    const handleActivityBarClick = (view) => {
        // Nếu sidebar đang đóng và người dùng click vào view đang active, hãy mở sidebar
        if (isSidebarCollapsed && view === activeView) {
            toggleSidebar();
        } 
        // Nếu người dùng click vào một view khác, hãy mở sidebar (nếu nó đang đóng)
        else if (isSidebarCollapsed) {
            setActiveView(view);
            toggleSidebar();
        } else {
            setActiveView(view);
        }
    };

  return (
    <div className="app-root">
      {/* Title bar kiểu VSCode */}
      <div className="titlebar">
        <div className="titlebar-left">
          <span className="app-title">CodeWEB</span>
        </div>
        <div className="titlebar-center">
          <span className="titlebar-filename">
            {activeFile || 'No file'}
          </span>
        </div>
        <div className="titlebar-right">
          <span className="titlebar-status">
            {language === 'c_cpp' ? 'C++' : 'Python'}
          </span>
        </div>
      </div>

      {/* Thanh lệnh (command bar) – tái sử dụng app-header */}
      <div className="app-header">
        <button onClick={toggleSidebar}>
          {isSidebarCollapsed ? 'Hiện Explorer' : 'Ẩn Explorer'}
        </button>
        <button onClick={() => setIsIoVisible(!isIoVisible)}>
          {isIoVisible ? 'Ẩn Terminal' : 'Hiện Terminal'}
        </button>
        <div className="connection-status">
          SignalR: <strong>{connectionStatus}</strong>
        </div>
      </div>

      <div className="app-main">
        {/* Activity bar */}
        <div className="activity-bar">
          <button 
            className={`activity-item ${activeView === 'explorer' ? 'active' : ''}`} 
            title="Explorer"
            onClick={() => handleActivityBarClick('explorer')}
          >
            📁
          </button>
          <button 
            className={`activity-item ${activeView === 'search' ? 'active' : ''}`} 
            title="Search"
            onClick={() => handleActivityBarClick('search')}
          >
            🔍
          </button>
          <button 
            className={`activity-item ${activeView === 'run' ? 'active' : ''}`} 
            title="Run"
            onClick={() => handleActivityBarClick('run')}
          >
            ▶️
          </button>
        </div>

        {/* Phần còn lại vẫn dùng PanelGroup như bạn đang có */}
        <PanelGroup direction="horizontal" className="app-layout">
          <Panel
            ref={sidebarPanelRef}
            defaultSize={20}
            minSize={15}
            collapsible={true}
            onCollapse={setIsSidebarCollapsed}
            collapsed={isSidebarCollapsed}
          >
            <div className="sidebar">
              {activeView === 'explorer' && (
                <>
                  <div className="sidebar-title">EXPLORER</div>
                  <div className="sidebar-header">
                    <button onClick={handleNewFile}>New File</button>
                  </div>
                  <ul className="file-list">
                    {Object.keys(files).map((file) => (
                      <li
                        key={file}
                        className={`file-item ${file === activeFile ? 'active' : ''}`}
                        onClick={() => setActiveFile(file)}
                      >
                        <span className="file-name">{file}</span>
                        <button
                          className="delete-file-btn"
                          onClick={(e) => handleDeleteFile(file, e)}
                        >
                          ✖
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {activeView === 'search' && (
                <>
                  <div className="sidebar-title">SEARCH</div>
                  <div style={{ padding: '1rem', color: '#ccc' }}>Chức năng tìm kiếm chưa được cài đặt.</div>
                </>
              )}
              {activeView === 'run' && (
                <>
                  <div className="sidebar-title">RUN</div>
                  <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <button
                      onClick={handleRunCode}
                      disabled={isLoading || connectionStatus !== 'Connected'}
                      className="run-button-sidebar"
                    >
                      {isLoading ? 'Đang chạy...' : 'Run Code'}
                    </button>
                    <p style={{color: '#ccc', fontSize: '12px'}}>Ngôn ngữ: {language === 'c_cpp' ? 'C++' : 'Python'}</p>
                  </div>
                </>
              )}
            </div>
          </Panel>

          <PanelResizeHandle className="resize-handle" />

          <Panel>
            <PanelGroup direction="vertical">
              <Panel minSize={30}>
                <div className="main-content">
                  {/* Tabs giống VSCode */}
                  <div className="tab-bar">
                    {Object.keys(files).map((file) => (
                      <div
                        key={file}
                        className={`tab ${file === activeFile ? 'active' : ''}`}
                        onClick={() => setActiveFile(file)}
                      >
                        <VscFileCode className="tab-icon" />
                        <span className="tab-name">{file}</span>
                        <button
                          className="tab-close"
                          onClick={(e) => handleDeleteFile(file, e)}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Thanh controls đã được dọn dẹp, nút Run chuyển sang sidebar */}
                  <div className="controls" />

                  <div className="editor-container">
                    <AceEditor
                      mode={language}
                      theme="monokai"
                      onChange={(newCode) => setCode(newCode)}
                      value={code}
                      name="ace-editor"
                      showPrintMargin={false}
                      editorProps={{ $blockScrolling: true }}
                      setOptions={{
                        enableBasicAutocompletion: true,
                        enableLiveAutocompletion: true,
                      }}
                      width="100%"
                      height="100%"
                      fontSize={14}
                    />
                  </div>
                </div>
              </Panel>

              {isIoVisible && <PanelResizeHandle className="resize-handle" />}

              {isIoVisible && (
                <Panel defaultSize={30} minSize={10} collapsible>
                  <PanelGroup direction="horizontal" className="io-layout">
                    <Panel minSize={20}>
                      <div className="io-pane">
                        <div className="io-header">
                          <span className="io-title">TERMINAL INPUT</span>
                        </div>
                        <textarea
                          className="io-box"
                          value={userInput}
                          onChange={(e) => setUserInput(e.target.value) }
                          placeholder="Nhập dữ liệu đầu vào cho chương trình..."
                        />
                      </div>
                    </Panel>
                    <PanelResizeHandle className="resize-handle" />
                    <Panel minSize={20}>
                      <div className="io-pane">
                        <div className="io-header">
                          <span className="io-title">TERMINAL OUTPUT</span>
                        </div>
                        <div className="io-box output-box">
                          {isLoading && !result && <p>Đang chờ kết quả...</p>}
                          {result && (
                            <>
                              <p>--- STATUS: {result.status} ---</p>
                              {result.error && (
                                <>
                                  <p>--- ERROR ---</p>
                                  <pre>{result.error}</pre>
                                </>
                              )}
                              {result.output && (
                                <>
                                  <p>--- OUTPUT ---</p>
                                  <pre>{result.output}</pre>
                                </>
                              )}
                              <p>--- METRICS ---</p>
                              <pre>
                                Thời gian: {result.executionTimeSeconds?.toFixed(3) ?? 'N/A'} s
                                {'\n'}
                                Bộ nhớ: {result.memoryUsageMB ?? 'N/A'} MB
                              </pre>
                            </>
                          )}
                        </div>
                      </div>
                    </Panel>
                  </PanelGroup>
                </Panel>
              )}
            </PanelGroup>
          </Panel>
        </PanelGroup>
      </div>

      {/* Status bar giống VSCode */}
      <div className="status-bar">
        <div className="status-left">
          <VscCheck style={{ marginRight: 4 }} />
          <span>Ready</span>
        </div>
        <div className="status-right">
          <span>{language === 'c_cpp' ? 'C++' : 'Python'}</span>
          <span>UTF-8</span>
          <span>LF</span>
        </div>
      </div>
    </div>
  )
}

export default App
