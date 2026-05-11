FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY src ./src

# Create log directory
RUN mkdir -p /app/logs

EXPOSE 4680

CMD ["node", "src/index.js"]
