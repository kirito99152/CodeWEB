# --- Giai đoạn 1: Build Frontend ---
FROM node:20-slim AS builder

WORKDIR /app

# Sao chép file package.json và cài đặt tất cả dependencies
COPY package.json package-lock.json* ./
RUN npm install

# Sao chép toàn bộ source code
COPY . .

# Build ứng dụng React
RUN npm run build


# --- Giai đoạn 2: Production ---
FROM node:20-slim

WORKDIR /app

# Cài đặt g++ và các công cụ cần thiết để biên dịch C++
RUN apt-get update && apt-get install -y g++ build-essential && rm -rf /var/lib/apt/lists/*

# Sao chép dependencies từ giai đoạn builder
COPY --from=builder /app/node_modules ./node_modules
COPY package.json .
COPY server.js .

# Sao chép các file đã build của React
COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "server.js"]