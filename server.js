import express from 'express';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import bodyParser from 'body-parser';
import crypto from 'crypto';
import axios from 'axios';
import { fileURLToPath } from 'url';

const app = express();
const port = 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(bodyParser.json({ limit: '20mb' }));

// Phục vụ các file tĩnh từ thư mục 'dist' của React
app.use(express.static(path.join(__dirname, 'dist')));

// API route
app.post('/compile', (req, res) => {
  const { code, language, userInput, userConnectionId } = req.body;
  console.log(`[${new Date().toISOString()}] Nhận được yêu cầu POST đến /compile`);
  processCode(code, language, userInput, userConnectionId, res);
});

// Cấu hình cho API chấm code nội bộ
const EXECUTION_API_URL = process.env.EXECUTION_API_URL || "http://localhost:5041/api/Execution/execute";
const EXECUTION_API_KEY = process.env.EXECUTION_API_KEY || "day-la-mot-chuoi-api-key-rat-dai-va-bi-mat-hay-thay-the-no";

// Hàm xử lý biên dịch code
async function processCode(code, language, userInput, userConnectionId, res) {
  console.log(`[${new Date().toISOString()}] Bắt đầu xử lý code...`);
  console.log(`> Ngôn ngữ: ${language}`);
  console.log(`> Input: "${userInput.slice(0, 50)}${userInput.length > 50 ? '...' : ''}"`);

  if (language !== 'c_cpp') {
    console.log('[LỖI] Ngôn ngữ không được hỗ trợ.');
    return res.status(400).json({ output: 'Chỉ hỗ trợ chạy code C++.', error: '' });
  }

  if (!userConnectionId) {
    console.log('[LỖI] Thiếu userConnectionId.');
    return res.status(400).json({ message: 'Thiếu userConnectionId. Không thể gửi yêu cầu chấm bài.' });
  }

  const payload = {
    sourceCode: code,
    language: 'cpp', // API nội bộ yêu cầu 'cpp'
    input: userInput,
    userConnectionId: userConnectionId // Sử dụng connection ID từ client
  };

  try {
    console.log(`Gửi yêu cầu đến API chấm code: ${EXECUTION_API_URL}`);
    const apiResponse = await axios.post(EXECUTION_API_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': EXECUTION_API_KEY
      },
      // Nếu API của bạn dùng chứng chỉ tự ký (self-signed), bạn cần thêm dòng sau.
      // Nếu không, hãy xóa nó đi.
      httpsAgent: new (await import('https')).Agent({ rejectUnauthorized: false })
    });

    console.log('[API] Yêu cầu thành công.');
    // Chuyển tiếp phản hồi từ API nội bộ (thường là một thông báo xác nhận) về cho client
    res.status(apiResponse.status).json(apiResponse.data);
  } catch (error) {
    console.error('[LỖI API]', error.message);
    const status = error.response?.status || 500;
    const data = error.response?.data || { message: 'Lỗi khi gọi đến dịch vụ chấm code.', details: error.message };
    res.status(status).json(data);
  }
}

// Route bắt tất cả các yêu cầu khác và trả về index.html của React
app.get('/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(port, () => {
  console.log(`Server đang chạy tại http://localhost:${port}`);
});