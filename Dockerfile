# Use Node.js 20
FROM node:20

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy all backend files
COPY . .

# Expose backend port
EXPOSE 8080

# Start server
CMD ["node", "server.js"]
