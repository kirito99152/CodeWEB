import { useState, useEffect } from 'react'
import './App.css'
import AceEditor from 'react-ace'

// Import các mode ngôn ngữ và theme cho Ace
import 'ace-builds/src-noconflict/mode-c_cpp'
import 'ace-builds/src-noconflict/mode-python'
import 'ace-builds/src-noconflict/theme-monokai'
import 'ace-builds/src-noconflict/ext-language_tools'

const initialCodes = {
  c_cpp: `// Viết mã C++ của bạn ở đây
#include <iostream>

int main() {
    std::cout << "Xin chào, C++!";
    return 0;
}`,
  python: `# Viết mã Python của bạn ở đây
def say_hello():
    print("Xin chào, Python!")

say_hello()`,
}

function App() {
  const [files, setFiles] = useState(() => {
    const savedFiles = localStorage.getItem('code_files')
    if (savedFiles) {
      return JSON.parse(savedFiles)
    }
    // Khởi tạo với file mặc định nếu chưa có gì
    return { 'main.cpp': initialCodes.c_cpp }
  })

  const [activeFile, setActiveFile] = useState(Object.keys(files)[0] || null)
  const [language, setLanguage] = useState('c_cpp') // Sẽ được cập nhật khi chọn file
  const [code, setCode] = useState(activeFile ? files[activeFile] : '')
  const [userInput, setUserInput] = useState('')
  const [compileOutput, setCompileOutput] = useState('')
  const [executionOutput, setExecutionOutput] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  // Lưu vào localStorage mỗi khi `files` thay đổi
  useEffect(() => {
    localStorage.setItem('code_files', JSON.stringify(files))
  }, [files])

  // Cập nhật editor khi `activeFile` thay đổi
  useEffect(() => {
    if (activeFile) {
      setCode(files[activeFile])
      const ext = activeFile.split('.').pop()
      if (ext === 'py') setLanguage('python')
      else if (ext === 'cpp') setLanguage('c_cpp')
    }
  }, [activeFile, files])

  const handleNewFile = () => {
    const fileName = prompt('Nhập tên file (ví dụ: script.py hoặc main.cpp):')
    if (fileName && !files[fileName]) {
      setFiles({ ...files, [fileName]: `// Bắt đầu viết code cho ${fileName}` })
      setActiveFile(fileName)
    } else if (files[fileName]) {
      alert('File đã tồn tại!')
    }
  }

  const handleSaveFile = () => {
    if (activeFile) {
      setFiles({ ...files, [activeFile]: code })
      alert(`Đã lưu file ${activeFile}!`)
    }
  }

  const handleRun = async () => {
    setIsLoading(true)
    setCompileOutput('')
    setExecutionOutput('')
    try {
      const response = await fetch('http://localhost:3000/compile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code, language, userInput }),
      })
      const data = await response.json()
      setCompileOutput(data.compileOutput)
      setExecutionOutput(data.executionOutput)
    } catch (error) {
      setCompileOutput('Lỗi: Không thể kết nối đến server biên dịch.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="app-layout">
      <div className="sidebar">
        <div className="sidebar-header">
          <button onClick={handleNewFile}>Tạo file mới</button>
          <button onClick={handleSaveFile} disabled={!activeFile}>Lưu file</button>
        </div>
        <ul className="file-list">
          {Object.keys(files).map((file) => (
            <li
              key={file}
              className={`file-item ${file === activeFile ? 'active' : ''}`}
              onClick={() => setActiveFile(file)}
            >
              {file}
            </li>
          ))}
        </ul>
      </div>
      <div className="main-content">
        <div className="container">
          <div className="controls">
            <span>Ngôn ngữ: {language === 'c_cpp' ? 'C++' : 'Python'}</span>
            <button onClick={handleRun} disabled={isLoading || language !== 'c_cpp'}>
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
                <p>--- COMPILER ---</p>
                <pre>{compileOutput}</pre>
                <p>--- EXECUTION ---</p>
                <pre>{executionOutput}</pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
