import express from 'express';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import bodyParser from 'body-parser';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const app = express();
const port = 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(bodyParser.json());

// Phục vụ các file tĩnh từ thư mục 'dist' của React
app.use(express.static(path.join(__dirname, 'dist')));

// API route
app.post('/compile', (req, res) => {
  const { code, language, userInput } = req.body;
  console.log(`[${new Date().toISOString()}] Nhận được yêu cầu POST đến /compile`);
  processCode(code, language, userInput, res);
});

// Hàm xử lý biên dịch code
function processCode(code, language, userInput, res) {
  console.log(`[${new Date().toISOString()}] Bắt đầu xử lý code...`);
  console.log(`> Ngôn ngữ: ${language}`);
  console.log(`> Input: "${userInput.slice(0, 50)}${userInput.length > 50 ? '...' : ''}"`);

  if (language !== 'c_cpp') {
    console.log('[LỖI] Ngôn ngữ không được hỗ trợ.');
    return res.status(400).json({ compileOutput: 'Chỉ hỗ trợ chạy code C++.', executionOutput: '' });
  }

  // Tạo một thư mục tạm duy nhất cho mỗi yêu cầu
  const uniqueDir = path.join(__dirname, 'temp', crypto.randomBytes(16).toString('hex'));
  fs.mkdirSync(uniqueDir, { recursive: true });

  // Hàm dọn dẹp thư mục tạm
  const cleanup = () => {
    fs.rm(uniqueDir, { recursive: true, force: true }, (rmErr) => {
      if (rmErr) {
        console.error(`[LỖI] Không thể xóa thư mục tạm ${uniqueDir}:`, rmErr);
      } else {
        console.log(`Đã dọn dẹp thư mục tạm: ${uniqueDir}`);
      }
    });
  };

  const filePath = path.join(uniqueDir, 'source.cpp');
  const outputPath = path.join(uniqueDir, 'source.out');

  console.log(`Ghi code vào file: ${filePath}`);
  fs.writeFile(filePath, code, (err) => {
    if (err) {
      console.error(`[LỖI] Ghi file tạm thất bại tại ${uniqueDir}:`, err);
      cleanup();
      return res.status(500).json({ compileOutput: 'Lỗi khi ghi file tạm.', executionOutput: '' });
    }

    const compileCommand = `g++ ${filePath} -o ${outputPath} -std=c++17 -Wall`;
    console.log(`Thực thi lệnh biên dịch: ${compileCommand}`);
    // Sử dụng g++ để biên dịch
    exec(compileCommand, (compileError, compileStdout, compileStderr) => {
      if (compileError) {
        console.error('[LỖI BIÊN DỊCH]', compileStderr);
        cleanup();
        // Nếu có lỗi biên dịch, gửi stderr về client
        return res.json({ compileOutput: compileStderr, executionOutput: '' });
      }

      const compileOutputMessage = compileStderr || 'Biên dịch thành công!';
      console.log('[BIÊN DỊCH] Thành công.');
      console.log(`Thực thi file output: ${outputPath}`);
      // Nếu biên dịch thành công, thực thi file
      const executionProcess = exec(outputPath, { timeout: 5000 }, (execError, execStdout, execStderr) => { // Thêm timeout 5 giây
        if (execError) {
          // Kiểm tra nếu lỗi là do timeout
          if (execError.signal === 'SIGTERM') {
            console.error('[LỖI THỰC THI] Quá thời gian thực thi (timeout).');
            cleanup();
            return res.json({ compileOutput: compileOutputMessage, executionOutput: 'Lỗi: Chương trình chạy quá thời gian.\nCó thể do đang chờ nhập liệu (cin) hoặc bị kẹt trong vòng lặp vô tận.' });
          }
          // Các lỗi thực thi khác (runtime error)
          console.error('[LỖI THỰC THI]', execStderr || execError.message);
          cleanup();
          return res.json({ compileOutput: compileOutputMessage, executionOutput: execStderr || execError.message });
        }
        // Cắt bớt output nếu quá dài để tránh treo trình duyệt
        const finalOutput = execStdout.length > 50000 ? execStdout.slice(0, 50000) + '\n... (output quá dài đã được cắt bớt)' : execStdout;
        console.log('[THỰC THI] Hoàn tất.');
        cleanup();
        // Trả về kết quả thực thi
        res.json({ compileOutput: compileOutputMessage, executionOutput: finalOutput });
      });

      // Cung cấp input cho chương trình
      if (userInput) {
        console.log('Cung cấp input cho chương trình...');
        executionProcess.stdin.write(userInput);
        executionProcess.stdin.end();
      }
    });
  });
}

// Route bắt tất cả các yêu cầu khác và trả về index.html của React
app.get('/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(port, () => {
  console.log(`Server đang chạy tại http://localhost:${port}`);
});