FROM node:20-slim

WORKDIR /app

# 先复制 package.json
COPY package.json ./

# 安装所有依赖（包括 devDependencies，因为 Vite 需要）
RUN npm install

# 复制剩余源码
COPY . .

# 构建前端
RUN npm run build

# 暴露端口
EXPOSE 3000

CMD ["node", "server/index.js"]
