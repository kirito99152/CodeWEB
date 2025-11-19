import React, { useState, useEffect, useRef } from 'react';
import { HubConnectionBuilder, HubConnectionState } from '@microsoft/signalr';
import './App.css'
import AceEditor from 'react-ace'

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
    const [files, setFiles] = useState(() => {
        const savedFiles = localStorage.getItem('code_files');
        return savedFiles ? JSON.parse(savedFiles) : { 'main.cpp': initialCodes.c_cpp };
    });
    const [activeFile, setActiveFile] = useState(Object.keys(files)[0] || null);
    const [code, setCode] = useState(activeFile ? files[activeFile] : '');
    const [language, setLanguage] = useState('c_cpp'); // Phải khớp với server.js
    const [userInput, setUserInput] = useState('');
    const [result, setResult] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState('Disconnected');

    const connectionRef = useRef(null);

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
            console.log("Received execution result:", executionResult);
            setResult(executionResult);
            setIsLoading(false); // Dừng trạng thái loading
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

    // Cập nhật editor khi `activeFile` thay đổi
    useEffect(() => {
        if (activeFile && files[activeFile]) {
            setCode(files[activeFile]);
            const ext = activeFile.split('.').pop();
            if (ext === 'py') setLanguage('python');
            else if (ext === 'cpp' || ext === 'c') setLanguage('c_cpp');
        }
    }, [activeFile, files]);

    // Tự động lưu vào state `files` mỗi khi `code` thay đổi (với độ trễ)
    useEffect(() => {
        if (activeFile) {
            const handler = setTimeout(() => {
                setFiles(prevFiles => ({ ...prevFiles, [activeFile]: code }));
            }, 500); // Đợi 500ms sau khi người dùng ngừng gõ rồi mới lưu

            return () => clearTimeout(handler); // Hủy timeout nếu người dùng gõ tiếp
        }
    }, [code, activeFile]); // Chạy lại effect này khi code hoặc file đang mở thay đổi

    const handleRunCode = async () => {
        if (connectionRef.current?.state !== HubConnectionState.Connected) {
            alert("Server not connected. Please wait.");
            return;
        }

        setIsLoading(true);
        setResult({ status: 'Queued...' }); // Cập nhật UI ngay lập tức

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
            setResult({ status: 'ClientError', error: error.message });
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
            setFiles({ ...files, [fileName]: cppTemplate });
            setActiveFile(fileName);
        } else if (extension === 'py') {
            setFiles({ ...files, [fileName]: `# Bắt đầu viết code Python cho ${fileName}` });
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

  return (
    <div className="app-layout">
      <div className="sidebar">
        <div className="sidebar-header">
          <button onClick={handleNewFile}>Tạo file mới</button>
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
              >✖</button>
            </li>
          ))}
        </ul>
        <div style={{padding: '0.5rem', marginTop: 'auto', fontSize: '0.8em'}}>
            SignalR: <strong>{connectionStatus}</strong>
        </div>
      </div>
      <div className="main-content">
        <div className="container">
          <div className="controls">
            <span>Ngôn ngữ: {language === 'c_cpp' ? 'C++' : 'Python'}</span>
            <button onClick={handleRunCode} disabled={isLoading || connectionStatus !== 'Connected' || language !== 'c_cpp'}>
              {isLoading ? 'Đang chạy...' : 'Run Code'}
            </button>
          </div>
          <div className="editor-container">
            <AceEditor
              mode={language}
              theme="monokai"
              onChange={(newCode) => setCode(newCode)}
              value={code}
              name="ace-editor"
              showPrintMargin={false}
              editorProps={{ $blockScrolling: true }}
              setOptions={{ enableBasicAutocompletion: true, enableLiveAutocompletion: true }}
              width="100%"
              height="100%"
              fontSize={14}
            />
          </div>
          <div className="io-layout">
            <div className="io-pane">
              <h3>Input</h3>
              <textarea
                className="io-box"
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                placeholder="Nhập dữ liệu đầu vào cho chương trình..."
              />
            </div>
            <div className="io-pane">
              <h3>Output</h3>
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
                            <br />
                            Bộ nhớ: {result.memoryUsageMB ?? 'N/A'} MB
                        </pre>
                    </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
